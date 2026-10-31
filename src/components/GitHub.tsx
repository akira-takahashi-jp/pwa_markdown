import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  clearToken,
  commitDrafts,
  fetchBlob,
  fetchBranches,
  fetchRepo,
  fetchRepos,
  fetchTree,
  fetchUser,
  getDraft,
  getDrafts,
  getToken,
  ghKey,
  GhConflictError,
  removeDrafts,
  repoKey,
  saveDraft,
  setToken,
  type CommitResult,
  type GhDraft,
  type GhRef,
  type GhRepo,
  type GhTreeNode,
  type GhUser,
} from '../lib/github'
import { nfc } from '../lib/fs'

const TOKEN_URL = 'https://github.com/settings/personal-access-tokens/new'

/** 保存された認証キー（未読み込みは undefined、未登録は null）。登録・削除に追従する */
export function useGhToken() {
  const [token, setTokenState] = useState<string | null | undefined>(undefined)
  useEffect(() => {
    const load = () => void getToken().then((t) => setTokenState(t ?? null))
    load()
    window.addEventListener('gh-token-changed', load)
    return () => window.removeEventListener('gh-token-changed', load)
  }, [])
  return token
}

/** 未コミットの下書きの一覧。保存・破棄に追従する */
export function useGhDrafts() {
  const [drafts, setDrafts] = useState<GhDraft[]>([])
  useEffect(() => {
    const load = () => void getDrafts().then(setDrafts)
    load()
    window.addEventListener('gh-drafts-changed', load)
    return () => window.removeEventListener('gh-drafts-changed', load)
  }, [])
  return drafts
}

interface ProjectProps {
  owner: string
  repo: string
  branch: string
  /** アクティブなタブの GitHub ファイル（ツリーのハイライト用） */
  current: GhRef | null
  onBranch(branch: string): void
  onOpen(name: string, content: string, ref: GhRef): Promise<void>
  /** コミット前に、編集中（未保存）の GitHub のタブを下書きに保存する */
  onBeforeCommit(): Promise<void>
  onCommitted(drafts: GhDraft[], result: CommitResult): void
  onDiscarded(keys: string[]): void
  onRequestToken(): void
  onError(e: unknown): void
  onToast(message: string): void
}

/** エクスプローラに表示する GitHub リポジトリ（ブランチ・ツリー・未コミットの変更） */
export function GitHubProject(props: ProjectProps) {
  const { owner, repo, branch } = props
  const token = useGhToken()
  const drafts = useGhDrafts()
  const [branches, setBranches] = useState<string[] | null>(null)
  const [tree, setTree] = useState<GhTreeNode[] | null>(null)
  const [truncated, setTruncated] = useState(false)
  const [loading, setLoading] = useState(false)
  const [committing, setCommitting] = useState(false)
  const propsRef = useRef(props)
  propsRef.current = props
  const selected = useMemo(() => ({ owner, repo, branch }), [owner, repo, branch])
  const branchOk = !!branches?.includes(branch)

  /* ブランチ一覧 */
  useEffect(() => {
    if (!token) return
    let cancelled = false
    setBranches(null)
    fetchBranches(token, owner, repo)
      .then(async (list) => {
        if (cancelled) return
        setBranches(list)
        // ブランチが消えていたらデフォルトブランチに切り替える
        if (!list.includes(propsRef.current.branch) && list.length) {
          const info = await fetchRepo(token, owner, repo)
          if (!cancelled) propsRef.current.onBranch(list.includes(info.default_branch) ? info.default_branch : list[0])
        }
      })
      .catch((e) => !cancelled && propsRef.current.onError(e))
    return () => {
      cancelled = true
    }
  }, [token, owner, repo])

  const loadTree = useCallback(async () => {
    if (!token || !branchOk) return setTree(null)
    setLoading(true)
    try {
      const t = await fetchTree(token, owner, repo, branch)
      setTree(t.tree)
      setTruncated(t.truncated)
    } catch (e) {
      setTree(null)
      propsRef.current.onError(e)
    } finally {
      setLoading(false)
    }
  }, [token, owner, repo, branch, branchOk])

  useEffect(() => {
    void loadTree()
  }, [loadTree])

  /* ファイルを開く（下書きがあれば下書きを開く） */
  const openFile = async (path: string, sha: string | null) => {
    if (!token) return
    try {
      const at = { ...selected, path }
      const draft = await getDraft(at)
      // 表示名だけ NFC にする（API に渡すパスはリポジトリのまま）
      const name = nfc(path.slice(path.lastIndexOf('/') + 1))
      if (draft) await props.onOpen(name, draft.content, { ...at, sha: draft.baseSha })
      else await props.onOpen(name, await fetchBlob(token, owner, repo, sha!), { ...at, sha })
    } catch (e) {
      props.onError(e)
    }
  }

  const newFile = async () => {
    const path = window.prompt('作成するファイルのパス（リポジトリのルートから）', 'docs/new.md')?.trim().replace(/^\/+/, '')
    if (!path) return
    if (!/\.(md|markdown|mdown|mkd)$/i.test(path)) return props.onError(new Error('拡張子は .md にしてください'))
    if (findNode(tree ?? [], path)) return props.onError(new Error(`${path} はすでにあります`))
    const ref: GhRef = { ...selected, path, sha: null }
    const content = `# ${path.replace(/^.*\//, '').replace(/\.\w+$/, '')}\n`
    try {
      await saveDraft(ref, content)
      await props.onOpen(nfc(path.slice(path.lastIndexOf('/') + 1)), content, ref)
    } catch (e) {
      props.onError(e)
    }
  }

  const repoDrafts = drafts.filter((d) => d.owner === owner && d.repo === repo)
  const currentDrafts = repoDrafts.filter((d) => d.branch === branch)
  const otherBranchDrafts = repoDrafts.filter((d) => d.branch !== branch)
  const draftPaths = new Set(currentDrafts.map((d) => d.path))
  const currentPath = props.current && repoKey(props.current) === repoKey(selected) ? props.current.path : null

  if (token === undefined) return null
  if (!token)
    return (
      <p className="empty">
        認証キーが登録されていません。
        <br />
        <button className="btn" onClick={props.onRequestToken}>
          認証キーを登録
        </button>
      </p>
    )

  return (
    <div className="gh-project">
      <div className="gh-branch">
        <select value={branchOk ? branch : ''} onChange={(e) => props.onBranch(e.target.value)} aria-label="ブランチ" disabled={!branches?.length}>
          {!branchOk && <option value="">{branches ? branch : '読み込み中…'}</option>}
          {branches?.map((b) => (
            <option key={b} value={b}>
              {b}
            </option>
          ))}
        </select>
        <button className="icon-btn" onClick={() => void newFile()} title="新しいファイル" disabled={!tree}>
          ＋
        </button>
        <button className="icon-btn" onClick={() => void loadTree()} title="再読み込み" disabled={loading}>
          ⟳
        </button>
      </div>
      {loading && !tree ? (
        <p className="empty">読み込み中…</p>
      ) : tree?.length || currentDrafts.some((d) => d.baseSha === null) ? (
        <ul className="tree">
          {tree?.map((n) => <GhNode key={n.path} node={n} currentPath={currentPath} draftPaths={draftPaths} onOpen={openFile} />)}
          {currentDrafts
            .filter((d) => d.baseSha === null)
            .map((d) => (
              <li key={d.path}>
                <button className={`tree-file${d.path === currentPath ? ' is-active' : ''}`} onClick={() => void openFile(d.path, null)} title={d.path}>
                  📄 {nfc(d.path)} <span className="gh-badge">新規</span>
                </button>
              </li>
            ))}
        </ul>
      ) : tree ? (
        <p className="empty">.md ファイルがありません</p>
      ) : null}
      {truncated && <p className="empty">ファイルが多すぎるため、一部しか表示できていません。</p>}

      {repoDrafts.length > 0 && (
        <>
          <header className="panel-head panel-subhead">
            <span>未コミットの変更</span>
            {currentDrafts.length > 0 && (
              <button
                className="btn btn-primary gh-commit-btn"
                onClick={async () => {
                  await props.onBeforeCommit()
                  setCommitting(true)
                }}
              >
                コミット ({currentDrafts.length})
              </button>
            )}
          </header>
          <ul className="recent">
            {currentDrafts.map((d) => (
              <DraftItem key={ghKey(d)} draft={d} label={nfc(d.path)} onOpen={() => void openFile(d.path, d.baseSha)} onDiscard={props.onDiscarded} />
            ))}
            {otherBranchDrafts.map((d) => (
              <DraftItem key={ghKey(d)} draft={d} label={`@${d.branch}: ${nfc(d.path)}`} onOpen={() => props.onBranch(d.branch)} onDiscard={props.onDiscarded} />
            ))}
          </ul>
        </>
      )}

      {committing && (
        <CommitDialog
          drafts={currentDrafts}
          target={`${owner}/${repo}@${branch}`}
          onClose={() => setCommitting(false)}
          onCommit={async (list, message) => {
            const result = await commitDrafts(token, list, message)
            await removeDrafts(list.map(ghKey))
            props.onCommitted(list, result)
            props.onToast(`${list.length} 件の変更をコミットしました (${result.commitSha.slice(0, 7)})`)
            setCommitting(false)
            void loadTree()
          }}
        />
      )}
    </div>
  )
}

/** 「GitHub リポジトリを開く」ダイアログ。認証キーが未登録なら先に登録する */
export function GitHubOpenDialog(props: {
  initialRepo?: string
  onOpen(owner: string, repo: string, branch: string): void
  onClose(): void
  onError(e: unknown): void
}) {
  const ref = useRef<HTMLDialogElement>(null)
  const token = useGhToken()
  const [changingKey, setChangingKey] = useState(false)
  const [user, setUser] = useState<GhUser | null>(null)
  const [repos, setRepos] = useState<GhRepo[]>([])
  const [repoName, setRepoName] = useState(props.initialRepo ?? '')
  const [branches, setBranches] = useState<string[]>([])
  const [branch, setBranch] = useState('')
  const [busy, setBusy] = useState(false)
  const [owner, repo] = repoName.trim().split('/')
  const valid = !!owner && !!repo

  useEffect(() => {
    ref.current?.showModal()
  }, [])

  useEffect(() => {
    if (!token) return
    let cancelled = false
    fetchUser(token)
      .then((u) => !cancelled && setUser(u))
      .catch((e) => !cancelled && props.onError(e))
    fetchRepos(token)
      .then((r) => !cancelled && setRepos(r))
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token])

  // リポジトリが決まったらブランチを読み、デフォルトブランチを選ぶ
  useEffect(() => {
    setBranches([])
    setBranch('')
    if (!token || !valid) return
    let cancelled = false
    const t = setTimeout(() => {
      Promise.all([fetchBranches(token, owner, repo), fetchRepo(token, owner, repo)])
        .then(([list, info]) => {
          if (cancelled) return
          setBranches(list)
          setBranch(list.includes(info.default_branch) ? info.default_branch : (list[0] ?? ''))
        })
        .catch(() => undefined)
    }, 300)
    return () => {
      cancelled = true
      clearTimeout(t)
    }
  }, [token, owner, repo, valid])

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!valid || !branch) return
    setBusy(true)
    props.onOpen(owner, repo, branch)
  }

  const removeKey = async () => {
    if (!window.confirm('認証キーをこのブラウザから削除しますか？（未コミットの下書きは残ります）')) return
    await clearToken()
    setUser(null)
    setRepos([])
  }

  return (
    <dialog ref={ref} className="dialog gh-open" onClose={props.onClose}>
      <header>
        <h2>GitHub リポジトリを開く</h2>
        <button type="button" className="icon-btn" onClick={props.onClose} aria-label="閉じる">
          ✕
        </button>
      </header>
      {token === undefined ? null : !token || changingKey ? (
        <TokenForm
          onSaved={() => setChangingKey(false)}
          onCancel={changingKey ? () => setChangingKey(false) : undefined}
          onError={props.onError}
        />
      ) : (
        <form onSubmit={submit}>
          <div className="gh-open-body">
            <p className="gh-account">
              {user ? `${user.login} として接続中` : '接続中'}
              <button type="button" className="link-btn" onClick={() => setChangingKey(true)}>
                キーを変更
              </button>
              <button type="button" className="link-btn" onClick={() => void removeKey()}>
                キーを削除
              </button>
            </p>
            <label>
              リポジトリ
              <input
                list="gh-repos"
                placeholder="owner/repo"
                value={repoName}
                onChange={(e) => setRepoName(e.target.value)}
                autoComplete="off"
                spellCheck={false}
                autoFocus
              />
              <datalist id="gh-repos">
                {repos.map((r) => (
                  <option key={r.full_name} value={r.full_name} />
                ))}
              </datalist>
            </label>
            <label>
              ブランチ
              <select value={branch} onChange={(e) => setBranch(e.target.value)} disabled={!branches.length}>
                {!branches.length && <option value="">{valid ? '読み込み中…' : '―'}</option>}
                {branches.map((b) => (
                  <option key={b} value={b}>
                    {b}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <footer>
            <button type="button" className="btn" onClick={props.onClose}>
              キャンセル
            </button>
            <button className="btn btn-primary" disabled={busy || !valid || !branch}>
              開く
            </button>
          </footer>
        </form>
      )}
    </dialog>
  )
}

function findNode(nodes: GhTreeNode[], path: string): GhTreeNode | null {
  for (const n of nodes) {
    if (n.path === path) return n
    const hit = n.children && findNode(n.children, path)
    if (hit) return hit
  }
  return null
}

function GhNode(p: { node: GhTreeNode; currentPath: string | null; draftPaths: Set<string>; onOpen(path: string, sha: string | null): void }) {
  const { node } = p
  const [open, setOpen] = useState(() => node.path.split('/').length < 2)
  if (node.kind === 'directory') {
    return (
      <li>
        <button className="tree-dir" onClick={() => setOpen(!open)}>
          <span className="tree-caret">{open ? '▾' : '▸'}</span>📁 {nfc(node.name)}
        </button>
        {open && (
          <ul>
            {node.children?.map((c) => <GhNode key={c.path} {...p} node={c} />)}
          </ul>
        )}
      </li>
    )
  }
  const changed = p.draftPaths.has(node.path)
  return (
    <li>
      <button
        className={`tree-file${node.path === p.currentPath ? ' is-active' : ''}${changed ? ' is-changed' : ''}`}
        onClick={() => p.onOpen(node.path, node.sha)}
        title={changed ? `${node.path}（未コミットの変更あり）` : node.path}
      >
        📄 {nfc(node.name)}
      </button>
    </li>
  )
}

function DraftItem({ draft, label, onOpen, onDiscard }: { draft: GhDraft; label: string; onOpen(): void; onDiscard(keys: string[]): void }) {
  return (
    <li>
      <button onClick={onOpen} title={`${label}\n一時保存: ${new Date(draft.savedAt).toLocaleString()}`}>
        {draft.baseSha === null ? '＋' : '✎'} {label}
      </button>
      <button
        className="icon-btn"
        title="変更を破棄"
        onClick={async () => {
          if (!window.confirm(`「${draft.path}」の未コミットの変更を破棄しますか？`)) return
          await removeDrafts([ghKey(draft)])
          onDiscard([ghKey(draft)])
        }}
      >
        ✕
      </button>
    </li>
  )
}

/** 設定メニューの「GitHub の認証キー」。登録・変更・削除をする */
export function GitHubKeyDialog(props: { onClose(): void; onError(e: unknown): void; onToast(message: string): void }) {
  const ref = useRef<HTMLDialogElement>(null)
  const token = useGhToken()
  const [changing, setChanging] = useState(false)
  const [user, setUser] = useState<GhUser | null>(null)
  const [status, setStatus] = useState<'checking' | 'ok' | 'invalid'>('checking')

  useEffect(() => {
    ref.current?.showModal()
  }, [])

  // 登録済みのキーがまだ使えるか確かめる
  useEffect(() => {
    if (!token) return
    let cancelled = false
    setStatus('checking')
    fetchUser(token)
      .then((u) => {
        if (cancelled) return
        setUser(u)
        setStatus('ok')
      })
      .catch(() => !cancelled && setStatus('invalid'))
    return () => {
      cancelled = true
    }
  }, [token])

  const removeKey = async () => {
    if (!window.confirm('認証キーをこのブラウザから削除しますか？（未コミットの下書きは残ります）')) return
    await clearToken()
    setUser(null)
    props.onToast('認証キーを削除しました')
  }

  return (
    <dialog ref={ref} className="dialog gh-open" onClose={props.onClose}>
      <header>
        <h2>GitHub の認証キー</h2>
        <button type="button" className="icon-btn" onClick={props.onClose} aria-label="閉じる">
          ✕
        </button>
      </header>
      {token === undefined ? null : !token || changing ? (
        <TokenForm
          onSaved={() => {
            setChanging(false)
            props.onToast('認証キーを保存しました')
          }}
          onCancel={changing ? () => setChanging(false) : undefined}
          onError={props.onError}
        />
      ) : (
        <>
          <div className="gh-open-body">
            <dl className="gh-key-info">
              <dt>状態</dt>
              <dd>
                {status === 'checking'
                  ? '確認中…'
                  : status === 'ok'
                    ? `${user?.login} として接続できます`
                    : 'このキーは使えません（期限切れ・削除された可能性があります）'}
              </dd>
              <dt>キー</dt>
              <dd>
                <code>{maskToken(token)}</code>
              </dd>
            </dl>
            <p className="gh-note">キーはこのブラウザ（IndexedDB）にだけ保存され、GitHub 以外には送信しません。</p>
          </div>
          <footer>
            <button type="button" className="btn" onClick={() => void removeKey()}>
              キーを削除
            </button>
            <button type="button" className="btn btn-primary" onClick={() => setChanging(true)}>
              キーを変更
            </button>
          </footer>
        </>
      )}
    </dialog>
  )
}

/** キーの先頭と末尾だけを見せる */
function maskToken(token: string) {
  return token.length <= 12 ? '•'.repeat(token.length) : `${token.slice(0, 11)}…${token.slice(-4)}`
}

function TokenForm({ onSaved, onCancel, onError }: { onSaved(): void; onCancel?(): void; onError(e: unknown): void }) {
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)
  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    const t = value.trim()
    if (!t) return
    setBusy(true)
    try {
      await fetchUser(t)
      await setToken(t)
      onSaved()
    } catch (err) {
      onError(err)
    } finally {
      setBusy(false)
    }
  }
  return (
    <form className="gh-token" onSubmit={submit}>
      <p>GitHub のリポジトリを開いて編集・コミットするには、認証キー（Personal Access Token）を登録します。</p>
      <ol>
        <li>
          <a href={TOKEN_URL} target="_blank" rel="noreferrer">
            GitHub の設定画面
          </a>
          で Fine-grained token を発行します。
        </li>
        <li>
          Repository access で対象のリポジトリを選び、Permissions の <b>Contents</b> を <b>Read and write</b> にします。
        </li>
        <li>発行されたキーを下に貼り付けます。</li>
      </ol>
      <input
        type="password"
        placeholder="github_pat_…"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        autoComplete="off"
        spellCheck={false}
        aria-label="認証キー"
        autoFocus
      />
      <div className="gh-token-actions">
        {onCancel && (
          <button type="button" className="btn" onClick={onCancel}>
            キャンセル
          </button>
        )}
        <button className="btn btn-primary" disabled={busy || !value.trim()}>
          {busy ? '確認中…' : '保存して接続'}
        </button>
      </div>
      <p className="gh-note">キーはこのブラウザ（IndexedDB）にだけ保存され、GitHub 以外には送信しません。</p>
    </form>
  )
}

function CommitDialog(props: {
  drafts: GhDraft[]
  target: string
  onClose(): void
  onCommit(drafts: GhDraft[], message: string): Promise<void>
}) {
  const ref = useRef<HTMLDialogElement>(null)
  const [checked, setChecked] = useState(() => new Set(props.drafts.map(ghKey)))
  const selected = props.drafts.filter((d) => checked.has(ghKey(d)))
  const defaultMessage =
    selected.length === 1 ? `${selected[0].baseSha ? 'Update' : 'Create'} ${selected[0].path}` : `Update ${selected.length} files`
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    ref.current?.showModal()
    // showModal は先頭のボタンにフォーカスするので、メッセージ欄へ移す
    ref.current?.querySelector('textarea')?.focus()
  }, [])

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!selected.length) return
    setBusy(true)
    setError(null)
    try {
      await props.onCommit(selected, message.trim() || defaultMessage)
    } catch (err) {
      setError(
        err instanceof GhConflictError
          ? `${err.message}\n変更を退避（コピー）してから破棄し、最新の内容を開き直して反映してください。`
          : err instanceof Error
            ? err.message
            : String(err),
      )
      setBusy(false)
    }
  }

  return (
    <dialog ref={ref} className="dialog gh-commit" onClose={props.onClose}>
      <form onSubmit={submit}>
        <header>
          <h2>コミット: {props.target}</h2>
          <button type="button" className="icon-btn" onClick={props.onClose} aria-label="閉じる">
            ✕
          </button>
        </header>
        <div className="gh-commit-body">
          <ul>
            {props.drafts.map((d) => (
              <li key={ghKey(d)}>
                <label>
                  <input
                    type="checkbox"
                    checked={checked.has(ghKey(d))}
                    onChange={(e) => {
                      const next = new Set(checked)
                      if (e.target.checked) next.add(ghKey(d))
                      else next.delete(ghKey(d))
                      setChecked(next)
                    }}
                  />
                  {d.baseSha === null && <span className="gh-badge">新規</span>} {d.path}
                </label>
              </li>
            ))}
          </ul>
          <textarea value={message} onChange={(e) => setMessage(e.target.value)} placeholder={defaultMessage} rows={3} aria-label="コミットメッセージ" />
          {error && <p className="gh-error">{error}</p>}
        </div>
        <footer>
          <button type="button" className="btn" onClick={props.onClose}>
            キャンセル
          </button>
          <button className="btn btn-primary" disabled={busy || !selected.length}>
            {busy ? 'コミット中…' : `${selected.length} 件をコミット`}
          </button>
        </footer>
      </form>
    </dialog>
  )
}
