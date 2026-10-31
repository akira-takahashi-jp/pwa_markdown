import { createStore, del, get, set } from 'idb-keyval'
import { MD_EXT } from './fs'

/*
 * GitHub 連携。REST API をブラウザから直接呼ぶ（api.github.com は CORS 対応）。
 * 認証キー（Personal Access Token）と未コミットの下書きは IndexedDB に保存し、外部へは GitHub 以外に送らない。
 */

const store = createStore('md-editor-github', 'kv')
const API = 'https://api.github.com'

/** タブで開いている GitHub 上のファイル */
export interface GhRef {
  owner: string
  repo: string
  branch: string
  path: string
  /** 開いた時点の blob SHA（新規ファイルなら null）。コミット時の競合検出に使う */
  sha: string | null
}

export interface GhUser {
  login: string
  name: string | null
  avatar_url: string
}

export interface GhRepo {
  full_name: string
  default_branch: string
  private: boolean
  permissions?: { push?: boolean }
}

export interface GhTreeNode {
  name: string
  path: string
  kind: 'file' | 'directory'
  sha: string | null
  children?: GhTreeNode[]
}

/** ローカルに一時保存した変更（未コミット） */
export interface GhDraft {
  owner: string
  repo: string
  branch: string
  path: string
  content: string
  /** 編集元の blob SHA（新規ファイルなら null） */
  baseSha: string | null
  savedAt: number
}

export const ghKey = (r: { owner: string; repo: string; branch: string; path: string }) => `${r.owner}/${r.repo}@${r.branch}:${r.path}`
export const repoKey = (r: { owner: string; repo: string; branch: string }) => `${r.owner}/${r.repo}@${r.branch}`

export class GhError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
  }
}

/* ---------------- 認証キー ---------------- */

const TOKEN_KEY = 'token'

export const getToken = () => get<string>(TOKEN_KEY, store)
export async function setToken(token: string) {
  await set(TOKEN_KEY, token, store)
  window.dispatchEvent(new Event('gh-token-changed'))
}
export async function clearToken() {
  await del(TOKEN_KEY, store)
  window.dispatchEvent(new Event('gh-token-changed'))
}

/* ---------------- API ---------------- */

async function request<T>(token: string, path: string, init: RequestInit = {}): Promise<T> {
  let res: Response
  try {
    res = await fetch(path.startsWith('http') ? path : API + path, {
      ...init,
      cache: 'no-store',
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'X-GitHub-Api-Version': '2022-11-28',
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      },
    })
  } catch {
    throw new GhError('GitHub に接続できません（オフラインの可能性があります）', 0)
  }
  if (res.ok) return (res.status === 204 ? undefined : await res.json()) as T
  const body = (await res.json().catch(() => ({}))) as { message?: string }
  const msg = body.message ?? res.statusText
  if (res.status === 401) throw new GhError('認証キーが無効か、期限切れです', 401)
  if (res.status === 403 && res.headers.get('x-ratelimit-remaining') === '0')
    throw new GhError('GitHub API の利用回数の上限に達しました。しばらく待ってから再度お試しください', 403)
  if (res.status === 403 || res.status === 404)
    throw new GhError(`アクセスできません（認証キーの権限を確認してください）: ${msg}`, res.status)
  throw new GhError(`GitHub API エラー (${res.status}): ${msg}`, res.status)
}

const enc = encodeURIComponent
const repoPath = (owner: string, repo: string) => `/repos/${enc(owner)}/${enc(repo)}`

export const fetchUser = (token: string) => request<GhUser>(token, '/user')

/** アクセスできるリポジトリ（最近 push された順、最大 500 件） */
export async function fetchRepos(token: string): Promise<GhRepo[]> {
  const all: GhRepo[] = []
  for (let page = 1; page <= 5; page++) {
    const list = await request<GhRepo[]>(token, `/user/repos?per_page=100&sort=pushed&page=${page}`)
    all.push(...list)
    if (list.length < 100) break
  }
  return all
}

export const fetchRepo = (token: string, owner: string, repo: string) => request<GhRepo>(token, repoPath(owner, repo))

export async function fetchBranches(token: string, owner: string, repo: string): Promise<string[]> {
  const all: string[] = []
  for (let page = 1; page <= 5; page++) {
    const list = await request<{ name: string }[]>(token, `${repoPath(owner, repo)}/branches?per_page=100&page=${page}`)
    all.push(...list.map((b) => b.name))
    if (list.length < 100) break
  }
  return all
}

interface RawTreeEntry {
  path: string
  mode: string
  type: 'blob' | 'tree' | 'commit'
  sha: string
}

async function headCommit(token: string, owner: string, repo: string, branch: string) {
  const ref = await request<{ object: { sha: string } }>(token, `${repoPath(owner, repo)}/git/ref/heads/${branch.split('/').map(enc).join('/')}`)
  const commit = await request<{ sha: string; tree: { sha: string } }>(token, `${repoPath(owner, repo)}/git/commits/${ref.object.sha}`)
  return { sha: commit.sha, tree: commit.tree.sha }
}

async function fetchRawTree(token: string, owner: string, repo: string, treeSha: string) {
  const t = await request<{ tree: RawTreeEntry[]; truncated: boolean }>(token, `${repoPath(owner, repo)}/git/trees/${treeSha}?recursive=1`)
  return t
}

/** ブランチの .md ファイルのツリー（.md を含まないフォルダは省く） */
export async function fetchTree(token: string, owner: string, repo: string, branch: string) {
  const head = await headCommit(token, owner, repo, branch)
  const raw = await fetchRawTree(token, owner, repo, head.tree)
  const root: GhTreeNode[] = []
  const dirs = new Map<string, GhTreeNode[]>([['', root]])
  const dirOf = (path: string): GhTreeNode[] => {
    const hit = dirs.get(path)
    if (hit) return hit
    const i = path.lastIndexOf('/')
    const node: GhTreeNode = { name: path.slice(i + 1), path, kind: 'directory', sha: null, children: [] }
    dirOf(i < 0 ? '' : path.slice(0, i)).push(node)
    dirs.set(path, node.children!)
    return node.children!
  }
  for (const e of raw.tree) {
    if (e.type !== 'blob' || !MD_EXT.test(e.path)) continue
    const i = e.path.lastIndexOf('/')
    dirOf(i < 0 ? '' : e.path.slice(0, i)).push({ name: e.path.slice(i + 1), path: e.path, kind: 'file', sha: e.sha })
  }
  const sort = (nodes: GhTreeNode[]) => {
    nodes.sort((a, b) => (a.kind !== b.kind ? (a.kind === 'directory' ? -1 : 1) : a.name.localeCompare(b.name, 'ja', { numeric: true })))
    for (const n of nodes) if (n.children) sort(n.children)
    return nodes
  }
  return { tree: sort(root), truncated: raw.truncated }
}

function decodeBase64Utf8(b64: string): string {
  const bin = atob(b64.replace(/\s/g, ''))
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0))
  return new TextDecoder().decode(bytes)
}

export async function fetchBlob(token: string, owner: string, repo: string, sha: string): Promise<string> {
  const b = await request<{ content: string; encoding: string }>(token, `${repoPath(owner, repo)}/git/blobs/${sha}`)
  return b.encoding === 'base64' ? decodeBase64Utf8(b.content) : b.content
}

/** git と同じ方法で blob の SHA-1 を計算する（内容が元と同じかの判定用） */
export async function gitBlobSha(content: string): Promise<string> {
  const body = new TextEncoder().encode(content)
  const head = new TextEncoder().encode(`blob ${body.length}\0`)
  const buf = new Uint8Array(head.length + body.length)
  buf.set(head)
  buf.set(body, head.length)
  const digest = await crypto.subtle.digest('SHA-1', buf)
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/* ---------------- コミット ---------------- */

export interface CommitResult {
  commitSha: string
  /** パスごとの新しい blob SHA */
  shas: Record<string, string>
}

export class GhConflictError extends GhError {
  constructor(readonly paths: string[]) {
    super(`リモートで変更されたため、コミットできません: ${paths.join(', ')}`, 409)
  }
}

/**
 * 下書きを 1 つのコミットにまとめてブランチに積む。
 * 編集元より後に同じファイルがリモートで変更されていたら GhConflictError（他のファイルの変更は問題ない）。
 */
export async function commitDrafts(token: string, drafts: GhDraft[], message: string): Promise<CommitResult> {
  const { owner, repo, branch } = drafts[0]
  const rp = repoPath(owner, repo)
  for (let attempt = 0; ; attempt++) {
    const head = await headCommit(token, owner, repo, branch)
    const raw = await fetchRawTree(token, owner, repo, head.tree)
    const current = new Map(raw.tree.filter((e) => e.type === 'blob').map((e) => [e.path, e]))
    const conflicts = drafts.filter((d) => (current.get(d.path)?.sha ?? null) !== d.baseSha).map((d) => d.path)
    if (conflicts.length) throw new GhConflictError(conflicts)

    const entries = await Promise.all(
      drafts.map(async (d) => {
        const blob = await request<{ sha: string }>(token, `${rp}/git/blobs`, {
          method: 'POST',
          body: JSON.stringify({ content: d.content, encoding: 'utf-8' }),
        })
        return { path: d.path, mode: current.get(d.path)?.mode ?? '100644', type: 'blob', sha: blob.sha }
      }),
    )
    const tree = await request<{ sha: string }>(token, `${rp}/git/trees`, {
      method: 'POST',
      body: JSON.stringify({ base_tree: head.tree, tree: entries }),
    })
    const commit = await request<{ sha: string }>(token, `${rp}/git/commits`, {
      method: 'POST',
      body: JSON.stringify({ message, tree: tree.sha, parents: [head.sha] }),
    })
    try {
      await request(token, `${rp}/git/refs/heads/${branch.split('/').map(enc).join('/')}`, {
        method: 'PATCH',
        body: JSON.stringify({ sha: commit.sha, force: false }),
      })
    } catch (e) {
      // 途中で他のコミットが積まれた（fast-forward できない）なら、最新から作り直す
      if (e instanceof GhError && e.status === 422 && attempt < 2) continue
      throw e
    }
    return { commitSha: commit.sha, shas: Object.fromEntries(entries.map((e) => [e.path, e.sha])) }
  }
}

/* ---------------- 下書き（未コミットの変更） ---------------- */

const DRAFTS_KEY = 'drafts'

export async function getDrafts(): Promise<GhDraft[]> {
  return Object.values((await get<Record<string, GhDraft>>(DRAFTS_KEY, store)) ?? {})
}

export async function getDraft(ref: Omit<GhRef, 'sha'>): Promise<GhDraft | undefined> {
  return ((await get<Record<string, GhDraft>>(DRAFTS_KEY, store)) ?? {})[ghKey(ref)]
}

async function updateDrafts(fn: (all: Record<string, GhDraft>) => void) {
  const all = (await get<Record<string, GhDraft>>(DRAFTS_KEY, store)) ?? {}
  fn(all)
  await set(DRAFTS_KEY, all, store)
  window.dispatchEvent(new Event('gh-drafts-changed'))
}

/** 下書きとして保存する。元の内容と同じに戻ったら下書きを消す。戻り値は下書きが残ったか */
export async function saveDraft(ref: GhRef, content: string): Promise<boolean> {
  const unchanged = ref.sha !== null && (await gitBlobSha(content)) === ref.sha
  await updateDrafts((all) => {
    if (unchanged) delete all[ghKey(ref)]
    else all[ghKey(ref)] = { owner: ref.owner, repo: ref.repo, branch: ref.branch, path: ref.path, content, baseSha: ref.sha, savedAt: Date.now() }
  })
  return !unchanged
}

export async function removeDrafts(keys: string[]): Promise<void> {
  await updateDrafts((all) => {
    for (const k of keys) delete all[k]
  })
}
