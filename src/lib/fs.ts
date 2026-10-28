import { createStore, del, get, set } from 'idb-keyval'

const store = createStore('md-editor', 'kv')

export const supportsFSA = typeof window !== 'undefined' && 'showOpenFilePicker' in window

/** File System Access API が使えない理由と対処（使える場合は null） */
export function fsaUnsupportedReason(): string | null {
  if (supportsFSA) return null
  if (!window.isSecureContext) return 'HTTP では使えません。localhost か HTTPS で開いてください。'
  if ('brave' in navigator)
    return 'Brave では既定で無効です。brave://flags/#file-system-access-api を Enabled にしてブラウザを再起動してください。'
  return 'このブラウザは未対応です。Chrome / Edge をお使いください。'
}

const MD_TYPES: FilePickerAcceptType[] = [
  { description: 'Markdown', accept: { 'text/markdown': ['.md', '.markdown', '.mdown', '.mkd'] } },
]
export const MD_EXT = /\.(md|markdown|mdown|mkd)$/i

/**
 * ファイル名を NFC に正規化する。macOS のファイル名は NFD（濁点・半濁点が分離した形）で返るため、
 * そのまま表示すると「ガ」が「カ゛」のように崩れたり、比較・並べ替えがずれたりする
 */
export const nfc = (name: string) => name.normalize('NFC')

export interface OpenedFile {
  name: string
  content: string
  handle: FileSystemFileHandle | null
}

/* ---------------- 権限 ---------------- */

export async function ensurePermission(handle: FileSystemHandle, mode: FileSystemPermissionMode = 'readwrite'): Promise<boolean> {
  const opts = { mode }
  if ((await handle.queryPermission(opts)) === 'granted') return true
  return (await handle.requestPermission(opts)) === 'granted'
}

/* ---------------- 開く ---------------- */

export async function readHandle(handle: FileSystemFileHandle): Promise<OpenedFile> {
  const file = await handle.getFile()
  return { name: nfc(file.name), content: await file.text(), handle }
}

/** ファイルを開く（複数選択可）。FSA 非対応なら input[type=file] で読み込む */
export async function openFiles(): Promise<OpenedFile[]> {
  if (supportsFSA) {
    try {
      const handles = await window.showOpenFilePicker({ types: MD_TYPES, excludeAcceptAllOption: false, multiple: true })
      const opened = await Promise.all(handles.map(readHandle))
      for (const h of handles) await addRecent(h)
      return opened
    } catch (e) {
      if (isAbort(e)) return []
      throw e
    }
  }
  const files = await pickFilesFallback()
  return Promise.all(files.map(async (f) => ({ name: nfc(f.name), content: await f.text(), handle: null })))
}

function pickFilesFallback(): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.multiple = true
    input.accept = '.md,.markdown,.mdown,.mkd,text/markdown,text/plain'
    input.onchange = () => resolve([...(input.files ?? [])])
    input.addEventListener('cancel', () => resolve([]))
    input.click()
  })
}

/* ---------------- 保存 ---------------- */

export async function writeHandle(handle: FileSystemFileHandle, content: string): Promise<void> {
  if (!(await ensurePermission(handle))) throw new Error('書き込み権限がありません')
  const w = await handle.createWritable()
  await w.write(content)
  await w.close()
}

/** 名前を付けて保存。FSA 非対応ならダウンロードする。キャンセル時は null */
export async function saveFileAs(content: string, suggestedName: string): Promise<FileSystemFileHandle | 'downloaded' | null> {
  if (supportsFSA) {
    try {
      const handle = await window.showSaveFilePicker({ suggestedName, types: MD_TYPES })
      await writeHandle(handle, content)
      await addRecent(handle)
      return handle
    } catch (e) {
      if (isAbort(e)) return null
      throw e
    }
  }
  downloadBlob(new Blob([content], { type: 'text/markdown;charset=utf-8' }), suggestedName)
  return 'downloaded'
}

/** 任意の内容を保存する（エクスポート用） */
export async function saveBlobAs(blob: Blob, suggestedName: string, description: string, accept: Record<string, string[]>): Promise<boolean> {
  if ('showSaveFilePicker' in window) {
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName,
        types: [{ description, accept: accept as FilePickerAcceptType['accept'] }],
      })
      const w = await handle.createWritable()
      await w.write(blob)
      await w.close()
      return true
    } catch (e) {
      if (isAbort(e)) return false
      throw e
    }
  }
  downloadBlob(blob, suggestedName)
  return true
}

export function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function isAbort(e: unknown) {
  return e instanceof DOMException && e.name === 'AbortError'
}

/* ---------------- フォルダ ---------------- */

export interface TreeNode {
  name: string
  path: string
  kind: 'file' | 'directory'
  handle: FileSystemFileHandle | FileSystemDirectoryHandle
  children?: TreeNode[]
}

const SKIP_DIRS = new Set(['node_modules', '.git', '.svn', '.hg', 'dist', 'build', '.next', '.cache', '.venv', '__pycache__'])

export async function openDirectory(): Promise<FileSystemDirectoryHandle | null> {
  try {
    const dir = await window.showDirectoryPicker({ mode: 'readwrite' })
    await addRecent(dir)
    return dir
  } catch (e) {
    if (isAbort(e)) return null
    throw e
  }
}

/** .md ファイルだけを含むツリーを作る（.md を含まないフォルダは省く） */
export async function readTree(dir: FileSystemDirectoryHandle, path = '', depth = 0): Promise<TreeNode[]> {
  const nodes: TreeNode[] = []
  if (depth > 10) return nodes
  for await (const entry of dir.values()) {
    const name = nfc(entry.name)
    const p = path ? `${path}/${name}` : name
    if (entry.kind === 'directory') {
      if (name.startsWith('.') || SKIP_DIRS.has(name)) continue
      const children = await readTree(entry, p, depth + 1)
      if (children.length) nodes.push({ name, path: p, kind: 'directory', handle: entry, children })
    } else if (MD_EXT.test(name)) {
      nodes.push({ name, path: p, kind: 'file', handle: entry })
    }
  }
  return nodes.sort((a, b) =>
    a.kind !== b.kind ? (a.kind === 'directory' ? -1 : 1) : a.name.localeCompare(b.name, 'ja', { numeric: true }),
  )
}

/* ---------------- 最近使ったファイル ---------------- */

export interface RecentEntry {
  name: string
  kind: 'file' | 'directory'
  handle: FileSystemFileHandle | FileSystemDirectoryHandle
  openedAt: number
}

const RECENT_KEY = 'recent'
const RECENT_MAX = 12

export async function getRecent(): Promise<RecentEntry[]> {
  return (await get<RecentEntry[]>(RECENT_KEY, store)) ?? []
}

export async function addRecent(handle: FileSystemFileHandle | FileSystemDirectoryHandle): Promise<void> {
  const list = await getRecent()
  const rest: RecentEntry[] = []
  for (const r of list) {
    try {
      if (r.kind === handle.kind && (await r.handle.isSameEntry(handle))) continue
    } catch {
      /* 失効したハンドルは残しておく */
    }
    rest.push(r)
  }
  const next = [{ name: nfc(handle.name), kind: handle.kind, handle, openedAt: Date.now() }, ...rest].slice(0, RECENT_MAX)
  await set(RECENT_KEY, next, store)
  window.dispatchEvent(new Event('recent-changed'))
}

export async function removeRecent(entry: RecentEntry): Promise<void> {
  const list = await getRecent()
  await set(RECENT_KEY, list.filter((r) => r.openedAt !== entry.openedAt || r.name !== entry.name), store)
  window.dispatchEvent(new Event('recent-changed'))
}

export async function clearRecent(): Promise<void> {
  await set(RECENT_KEY, [], store)
  window.dispatchEvent(new Event('recent-changed'))
}

/* ---------------- 自動保存（クラッシュ復元用） ---------------- */

export interface SessionDoc {
  id: string
  name: string
  content: string
  handle: FileSystemFileHandle | null
  path: string | null
  dirty: boolean
}

/** 開いているタブすべての内容 */
export interface SessionData {
  docs: SessionDoc[]
  activeId: string
  savedAt: number
}

const SESSION_KEY = 'session'
/** タブ対応前の 1 ファイルだけの自動保存 */
const LEGACY_AUTOSAVE_KEY = 'autosave'

interface LegacyAutosave {
  content: string
  name: string
  handle: FileSystemFileHandle | null
  dirty: boolean
  savedAt: number
}

export async function writeSession(data: SessionData): Promise<void> {
  await set(SESSION_KEY, data, store)
}

export async function readSession(): Promise<SessionData | undefined> {
  const session = await get<SessionData>(SESSION_KEY, store)
  if (session?.docs?.length) return { ...session, docs: session.docs.map((d) => ({ ...d, name: nfc(d.name), path: d.path && nfc(d.path) })) }
  const legacy = await get<LegacyAutosave>(LEGACY_AUTOSAVE_KEY, store)
  if (!legacy) return undefined
  await del(LEGACY_AUTOSAVE_KEY, store)
  const doc = { id: 'restored', name: nfc(legacy.name), content: legacy.content, handle: legacy.handle, path: null, dirty: legacy.dirty }
  return { docs: [doc], activeId: doc.id, savedAt: legacy.savedAt }
}
