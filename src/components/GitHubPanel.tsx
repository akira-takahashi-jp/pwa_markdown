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
import { usePersistentState } from '../lib/theme'

const TOKEN_URL = 'https://github.com/settings/personal-access-tokens/new'

interface Props {
  /** アクティブなタブの GitHub ファイル（ツリーのハイライト用） */
  current: GhRef | null
  onOpen(name: string, content: string, ref: GhRef): Promise<void>
  /** コミット前に、編集中（未保存）の GitHub のタブを下書きに保存する */
  onBeforeCommit(): Promise<void>
  onCommitted(drafts: GhDraft[], result: CommitResult): void
  onDiscarded(keys: string[]): void
  onError(e: unknown): void
  onToast(message: string): void
}

export function GitHubPanel(props: Props) {
  const [token, setTokenState] = useState<string | null | undefined>(undefined)
  const [user, setUser] = useState<GhUser | null>(null)
  const [repos, setRepos] = useState<GhRepo[]>([])
  const [repoName, setRepoName] = usePersistentState('md-editor:gh-repo', '')
  const [branch, setBranch] = usePersistentState('md-editor:gh-branch', '')
  const [branches, setBranches] = useState<string[]>([])
  const [tree, setTree] = useState<GhTreeNode[] | null>(null)
  const [truncated, setTruncated] = useState(false)
  const [loading, setLoading] = useState(false)
  const [drafts, setDrafts] = useState<GhDraft[]>([])
  const [committing, setCommitting] = useState(false)
  const propsRef = useRef(props)
  propsRef.current = props

  const [owner, repo] = repoName.split('/')
  const selected = owner && repo && branch ? { owner, repo, branch } : null

  /* 認証キーとユーザー */
  useEffect(() => {
    void getToken().then((t) => setTokenState(t ?? null))
  }, [])

  useEffect(() => {
    if (!token) return
    let cancelled = false
    fetchUser(token)
      .then((u) => !cancelled && setUser(u))
      .catch((e) => !cancelled && propsRef.current.onError(e))
    fetchRepos(token)
      .then((r) => !cancelled && setRepos(r))
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [token])

  /* 下書き */
  const refreshDrafts = useCallback(() => void getDrafts().then(setDrafts), [])
  useEffect(() => {
    refreshDrafts()
    window.addEventListener('gh-drafts-changed', refreshDrafts)
    return () => window.removeEventListener('gh-drafts-changed', refreshDrafts)
  }, [refreshDrafts])

  /* リポジトリを選んだらブランチ一覧を読む */
  useEffect(() => {
    if (!token || !owner || !repo) return setBranches([])
    let cancelled = false
    fetchBranches(token, owner, repo)
      .then(async (list) => {
        if (cancelled) return
        setBranches(list)
        if (!list.includes(branch)) {
          const info = repos.find((r) => r.full_name === repoName) ?? (await fetchRepo(token, owner, repo))
          if (!cancelled) setBranch(list.includes(info.default_branch) ? info.default_branch : (list[0] ?? ''))
        }
      })
      .catch((e) => {
        if (cancelled) return
        setBranches([])
        propsRef.current.onError(e)
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, owner, repo])

  const loadTree = useCallback(async () => {
    if (!token || !selected || !branches.includes(selected.branch)) return setTree(null)
    setLoading(true)
    try {
      const t = await fetchTree(token, selected.owner, selected.repo, selected.branch)
      setTree(t.tree)
      setTruncated(t.truncated)
    } catch (e) {
      setTree(null)
      propsRef.current.onError(e)
    } finally {
      setLoading(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, owner, repo, branch, branches])

  useEffect(() => {
    void loadTree()
  }, [loadTree])

  /* ファイルを開く（下書きがあれば下書きを開く） */
  const openFile = async (path: string, sha: string | null) => {
    if (!token || !selected) return
    try {
      const at = { ...selected, path }
      const draft = await getDraft(at)
      // 表示名だけ NFC にする（API に渡すパスはリポジトリのまま）
      const name = nfc(path.slice(path.lastIndexOf('/') + 1))
      if (draft) await props.onOpen(name, draft.content, { ...at, sha: draft.baseSha })
      else await props.onOpen(name, await fetchBlob(token, selected.owner, selected.repo, sha!), { ...at, sha })
    } catch (e) {
      props.onError(e)
    }
  }

  const newFile = async () => {
    if (!selected) return
    const path = window.prompt('作成するファイルのパス（リポジトリのルートから）', 'docs/new.md')?.trim().replace(/^\/+/, '')
    if (!path) return
    if (!/\.(md|markdown|mdown|mkd)$/i.test(path)) return props.onError(new Error('拡張子は .md にしてください'))
    if (findNode(tree ?? [], path)) return props.onError(new Error(`${path} はすでにあります`))
    const ref: GhRef = { ...selected, path, sha: null }
    const content = `# ${path.replace(/^.*\//, '').replace(/\.\w+$/, '')}\n`
    try {
      await saveDraft(ref, content)
      await props.onOpen(path.slice(path.lastIndexOf('/') + 1), content, ref)
    } catch (e) {
      props.onError(e)
    }
  }

  const disconnect = async () => {
    if (!window.confirm('認証キーをこのブラウザから削除しますか？（未コミットの下書きは残ります）')) return
    await clearToken()
    setTokenState(null)
    setUser(null)
    setRepos([])
    setTree(null)
  }

  const currentDrafts = useMemo(
    () => (selected ? drafts.filter((d) => repoKey(d) === repoKey(selected)) : []),
    [drafts, selected],
  )
  const otherDrafts = drafts.filter((d) => !currentDrafts.includes(d))
  const draftPaths = useMemo(() => new Set(currentDrafts.map((d) => d.path)), [currentDrafts])
  const currentPath = props.current && selected && repoKey(props.current) === repoKey(selected) ? props.current.path : null

  if (token === undefined) return null
  if (!token) return <TokenForm onSaved={setTokenState} onError={props.onError} />

  return (
    <div className="file-panel gh-panel">
      <section>
        <header className="panel-head">
          <span>GitHub{user ? `: ${user.login}` : ''}</span>
          <button className="icon-btn" onClick={() => void disconnect()} title="認証キーを削除して切断">
            ⏏
          </button>
        </header>
        <div className="gh-select">
          <input
            list="gh-repos"
            placeholder="owner/repo"
            defaultValue={repoName}
            key={repoName}
            onBlur={(e) => setRepoName(e.currentTarget.value.trim())}
            onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
            aria-label="リポジトリ"
          />
          <datalist id="gh-repos">
            {repos.map((r) => (
              <option key={r.full_name} value={r.full_name} />
            ))}
          </datalist>
          <select value={branches.includes(branch) ? branch : ''} onChange={(e) => setBranch(e.target.value)} aria-label="ブランチ" disabled={!branches.length}>
            {!branches.includes(branch) && <option value="">ブランチ</option>}
            {branches.map((b) => (
              <option key={b} value={b}>
                {b}
              </option>
            ))}
          </select>
        </div>
      </section>

      {selected && (
        <section>
          <header className="panel-head">
            <span title={`${repoName}@${branch}`}>{repo}</span>
            <span>
              <button className="icon-btn" onClick={() => void newFile()} title="新しいファイル" disabled={!tree}>
                ＋
              </button>
              <button className="icon-btn" onClick={() => void loadTree()} title="再読み込み" disabled={loading}>
                ⟳
              </button>
            </span>
          </header>
          {loading && !tree ? (
            <p className="empty">読み込み中…</p>
          ) : tree?.length ? (
            <ul className="tree">
              {tree.map((n) => (
                <GhNode key={n.path} node={n} currentPath={currentPath} draftPaths={draftPaths} onOpen={openFile} />
              ))}
            </ul>
          ) : tree ? (
            <p className="empty">.md ファイルがありません</p>
          ) : null}
          {truncated && <p className="empty">ファイルが多すぎるため、一部しか表示できていません。</p>}
          {currentDrafts
            .filter((d) => d.baseSha === null)
            .map((d) => (
              <ul className="tree" key={d.path}>
                <li>
                  <button className={`tree-file${d.path === currentPath ? ' is-active' : ''}`} onClick={() => void openFile(d.path, null)} title={d.path}>
                    📄 {d.path} <span className="gh-badge">新規</span>
                  </button>
                </li>
              </ul>
            ))}
        </section>
      )}

      <section>
        <header className="panel-head">
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
        {drafts.length === 0 ? (
          <p className="empty">ありません。GitHub のファイルを編集して保存（Ctrl+S）すると、ここに一時保存されます。</p>
        ) : (
          <ul className="recent">
            {currentDrafts.map((d) => (
              <DraftItem key={ghKey(d)} draft={d} label={d.path} onOpen={() => void openFile(d.path, d.baseSha)} onDiscard={props.onDiscarded} />
            ))}
            {otherDrafts.map((d) => (
              <DraftItem
                key={ghKey(d)}
                draft={d}
                label={`${d.owner}/${d.repo}@${d.branch}: ${d.path}`}
                onOpen={() => {
                  setRepoName(`${d.owner}/${d.repo}`)
                  setBranch(d.branch)
                }}
                onDiscard={props.onDiscarded}
              />
            ))}
          </ul>
        )}
      </section>

      {committing && selected && (
        <CommitDialog
          drafts={currentDrafts}
          target={`${repoName}@${branch}`}
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

function TokenForm({ onSaved, onError }: { onSaved(token: string): void; onError(e: unknown): void }) {
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
      onSaved(t)
    } catch (err) {
      onError(err)
    } finally {
      setBusy(false)
    }
  }
  return (
    <form className="gh-token" onSubmit={submit}>
      <p>GitHub のリポジトリを開いて編集・コミットできます。</p>
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
      />
      <button className="btn btn-primary" disabled={busy || !value.trim()}>
        {busy ? '確認中…' : '保存して接続'}
      </button>
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
