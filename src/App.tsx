import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRegisterSW } from 'virtual:pwa-register/react'
import { Editor, type EditorHandle } from './components/Editor'
import { Explorer } from './components/Explorer'
import { GitHubKeyDialog, GitHubOpenDialog } from './components/GitHub'
import { HelpDialog } from './components/HelpDialog'
import { PresentationMode } from './components/PresentationMode'
import { Preview } from './components/Preview'
import { SlidePreview, type SlideInfo } from './components/SlidePreview'
import { TabBar, type DocMeta } from './components/TabBar'
import { Toasts, type ToastItem } from './components/Toast'
import { TocSidebar } from './components/TocSidebar'
import { Toolbar, type ViewMode } from './components/Toolbar'
import { exportHtml, exportMarp, printDocument } from './lib/export'
import { isMarp } from './lib/frontmatter'
import {
  addRecent,
  ensurePermission,
  getCurrentProject,
  getRecent,
  githubProject,
  handleProject,
  nfc,
  openDirectory,
  openFiles,
  readHandle,
  readTree,
  removeRecent,
  saveFileAs,
  fsaUnsupportedReason,
  supportsFSA,
  readSession,
  setCurrentProject,
  writeHandle,
  writeSession,
  type OpenedFile,
  type Project,
  type RecentEntry,
  type TreeNode,
} from './lib/fs'
import { ghKey, saveDraft, type CommitResult, type GhDraft, type GhRef } from './lib/github'
import { debounce } from './lib/hash'
import type { Heading } from './lib/markdown'
import { slideStartLines } from './lib/marp'
import { setMermaidTheme } from './lib/mermaid'
import type { PreviewHandle } from './lib/scrollSync'
import { usePersistentState, useTheme } from './lib/theme'

const WELCOME = `# ようこそ 👋

Mermaid・Marp 対応の Markdown エディターです。

- 左で編集すると右のプレビューに反映されます
- **Ctrl+O** で開く、**Ctrl+S** で保存、**F1** でショートカット一覧
- front-matter に \`marp: true\` を書くとスライドモードになります

\`\`\`mermaid
flowchart LR
  A[Markdown を書く] --> B{marp: true?}
  B -- はい --> C[スライド]
  B -- いいえ --> D[ドキュメント]
\`\`\`

数式も書けます: $e^{i\\pi} + 1 = 0$
`

const WELCOME_ID = 'welcome'

let idSeq = 0
const newId = () => `doc-${Date.now().toString(36)}-${++idSeq}`

/** 既存のタブと重ならない untitled 名 */
function untitledName(docs: DocMeta[]): string {
  const names = new Set(docs.map((d) => d.name))
  if (!names.has('untitled.md')) return 'untitled.md'
  let n = 2
  while (names.has(`untitled-${n}.md`)) n++
  return `untitled-${n}.md`
}

export default function App() {
  const { pref: themePref, theme, cycle: cycleTheme } = useTheme()
  setMermaidTheme(theme === 'dark' ? 'dark' : 'default')

  const editorRef = useRef<EditorHandle>(null)
  const previewRef = useRef<PreviewHandle>(null)
  const mainRef = useRef<HTMLDivElement>(null)

  /* タブ（文書）。本文は入力のたびに変わるので state ではなく ref に持つ */
  const [docs, setDocsState] = useState<DocMeta[]>([
    { id: WELCOME_ID, name: 'untitled.md', handle: null, path: null, dirty: false },
  ])
  const docsRef = useRef(docs)
  const contentsRef = useRef(new Map<string, string>([[WELCOME_ID, WELCOME]]))
  /** 最後に保存した（開いた）ときの内容。これと一致すれば未保存扱いにしない */
  const savedRef = useRef(new Map<string, string>([[WELCOME_ID, WELCOME]]))
  const [activeId, setActiveIdState] = useState(WELCOME_ID)
  const activeIdRef = useRef(activeId)
  const [previewSrc, setPreviewSrc] = useState(WELCOME)

  const activeDoc = docs.find((d) => d.id === activeId) ?? docs[0]
  const fileName = activeDoc.name
  const activeContent = () => contentsRef.current.get(activeIdRef.current) ?? ''

  /** エクスプローラで開いているプロジェクト（ファイル・フォルダ・GitHub リポジトリ） */
  const [project, setProjectState] = useState<Project | null>(null)
  const projectRef = useRef(project)
  const [needsPermission, setNeedsPermission] = useState(false)
  const [tree, setTree] = useState<TreeNode[]>([])
  const [recent, setRecent] = useState<RecentEntry[]>([])

  const [viewMode, setViewMode] = usePersistentState<ViewMode>('md-editor:view', 'split')
  const [sidebarOpen, setSidebarOpen] = usePersistentState('md-editor:sidebar', true)
  const [explorerOpen, setExplorerOpen] = usePersistentState('md-editor:explorer-open', true)
  const [outlineOpen, setOutlineOpen] = usePersistentState('md-editor:outline-open', true)
  /** サイドバーの上下の比率（エクスプローラの割合） */
  const [sideSplit, setSideSplit] = usePersistentState('md-editor:side-split', 0.6)
  const [ratio, setRatio] = usePersistentState('md-editor:ratio', 0.5)

  const [headings, setHeadings] = useState<Heading[]>([])
  const [slides, setSlides] = useState<SlideInfo[]>([])
  const [toasts, setToasts] = useState<ToastItem[]>([])
  const [helpOpen, setHelpOpen] = useState(false)
  const [ghDialogOpen, setGhDialogOpen] = useState(false)
  const [ghKeyDialogOpen, setGhKeyDialogOpen] = useState(false)
  const [presenting, setPresenting] = useState<number | null>(null)
  const [dragOver, setDragOver] = useState(false)

  const marp = useMemo(() => isMarp(previewSrc), [previewSrc])

  /* ---------------- トースト ---------------- */

  const toast = useCallback((t: Omit<ToastItem, 'id'>) => {
    const id = Date.now() + Math.random()
    setToasts((ts) => [...ts, { ...t, id }])
    if (!t.sticky) setTimeout(() => setToasts((ts) => ts.filter((x) => x.id !== id)), t.kind === 'error' ? 6000 : 3000)
  }, [])
  const dismissToast = useCallback((id: number) => setToasts((ts) => ts.filter((x) => x.id !== id)), [])
  const reportError = useCallback(
    (e: unknown) => {
      console.error(e)
      toast({ kind: 'error', message: e instanceof Error ? e.message : String(e) })
    },
    [toast],
  )

  /* ---------------- PWA 更新通知 ---------------- */

  const {
    needRefresh: [needRefresh],
    offlineReady: [offlineReady, setOfflineReady],
    updateServiceWorker,
  } = useRegisterSW({ immediate: true })

  useEffect(() => {
    if (needRefresh)
      toast({
        message: '更新があります',
        sticky: true,
        action: { label: '再読み込み', onClick: () => void updateServiceWorker(true) },
      })
  }, [needRefresh, toast, updateServiceWorker])

  useEffect(() => {
    if (offlineReady) {
      toast({ kind: 'success', message: 'オフラインで使えるようになりました' })
      setOfflineReady(false)
    }
  }, [offlineReady, setOfflineReady, toast])

  /* ---------------- タブ（文書）の管理 ---------------- */

  /** スクロール同期の元になるペイン（ユーザーが最後に操作した側） */
  const activePaneRef = useRef<'editor' | 'preview' | null>(null)

  const setDocs = useCallback((next: DocMeta[]) => {
    docsRef.current = next
    setDocsState(next)
  }, [])

  const patchDoc = useCallback(
    (id: string, patch: Partial<DocMeta>) => setDocs(docsRef.current.map((d) => (d.id === id ? { ...d, ...patch } : d))),
    [setDocs],
  )

  /** 全タブの内容を IndexedDB に退避（クラッシュ・リロード時の復元用） */
  const autosave = useMemo(
    () =>
      debounce(() => {
        void writeSession({
          docs: docsRef.current.map((d) => ({ ...d, content: contentsRef.current.get(d.id) ?? '' })),
          activeId: activeIdRef.current,
          savedAt: Date.now(),
        }).catch(() => undefined)
      }, 1000),
    [],
  )
  const updatePreview = useMemo(() => debounce((s: string) => setPreviewSrc(s), 300), [])

  const onChange = useCallback(
    (text: string) => {
      const id = activeIdRef.current
      contentsRef.current.set(id, text)
      const dirty = text !== savedRef.current.get(id)
      if (docsRef.current.find((d) => d.id === id)?.dirty !== dirty) patchDoc(id, { dirty })
      updatePreview(text)
      autosave()
    },
    [autosave, patchDoc, updatePreview],
  )

  const activate = useCallback(
    (id: string) => {
      const text = contentsRef.current.get(id) ?? ''
      editorRef.current?.open(id, text)
      activeIdRef.current = id
      setActiveIdState(id)
      updatePreview.cancel()
      setPreviewSrc(text)
      // 描画後にプレビューをエディターのスクロール位置へ合わせる
      activePaneRef.current = 'editor'
      autosave()
    },
    [autosave, updatePreview],
  )

  /** 何も書いていない untitled タブ（新しく開いた文書で置き換える） */
  const isPristine = (d: DocMeta) => {
    const text = contentsRef.current.get(d.id) ?? ''
    return !d.handle && !d.gh && !d.dirty && (text === '' || text === WELCOME)
  }

  /** 文書をタブで開く。同じファイルがすでに開いていればそのタブに切り替える */
  const openDocument = useCallback(
    async (rawName: string, content: string, handle: FileSystemFileHandle | null, opts: { path?: string | null; gh?: GhRef } = {}) => {
      const name = nfc(rawName)
      if (opts.gh) {
        const key = ghKey(opts.gh)
        const same = docsRef.current.find((d) => d.gh && ghKey(d.gh) === key)
        if (same) return activate(same.id)
      } else if (handle) {
        for (const d of docsRef.current) {
          if (d.handle && (await d.handle.isSameEntry(handle).catch(() => false))) {
            if (opts.path && !d.path) patchDoc(d.id, { path: opts.path })
            activate(d.id)
            return
          }
        }
      } else {
        // ハンドルのないファイル（ドロップ・非対応ブラウザ）は名前と内容が同じなら同一とみなす
        const same = docsRef.current.find((d) => !d.handle && !d.gh && d.name === name && contentsRef.current.get(d.id) === content)
        if (same) return activate(same.id)
      }
      const current = docsRef.current.find((d) => d.id === activeIdRef.current)
      const replace = current && isPristine(current) ? current.id : null
      const id = newId()
      contentsRef.current.set(id, content)
      savedRef.current.set(id, content)
      const doc: DocMeta = { id, name, handle, path: opts.path ?? null, dirty: false, gh: opts.gh ?? null }
      const list = [...docsRef.current]
      const at = list.findIndex((d) => d.id === activeIdRef.current)
      list.splice(at + 1, 0, doc)
      setDocs(list)
      activate(id)
      if (replace) {
        contentsRef.current.delete(replace)
        savedRef.current.delete(replace)
        editorRef.current?.close(replace)
        setDocs(docsRef.current.filter((d) => d.id !== replace))
      }
    },
    [activate, patchDoc, setDocs],
  )

  const closeDoc = useCallback(
    (id: string, force = false) => {
      const doc = docsRef.current.find((d) => d.id === id)
      if (!doc) return
      if (doc.dirty && !force && !window.confirm(`「${doc.name}」の変更を保存せずに閉じますか？`)) return
      const index = docsRef.current.indexOf(doc)
      let rest = docsRef.current.filter((d) => d.id !== id)
      if (rest.length === 0) {
        // 最後のタブを閉じたら空の文書を 1 つ残す
        const blank: DocMeta = { id: newId(), name: 'untitled.md', handle: null, path: null, dirty: false }
        contentsRef.current.set(blank.id, '')
        savedRef.current.set(blank.id, '')
        rest = [blank]
      }
      setDocs(rest)
      if (id === activeIdRef.current) activate(rest[Math.min(index, rest.length - 1)].id)
      contentsRef.current.delete(id)
      savedRef.current.delete(id)
      editorRef.current?.close(id)
      autosave()
    },
    [activate, autosave, setDocs],
  )

  const cycleTab = useCallback(
    (delta: number) => {
      const list = docsRef.current
      const i = list.findIndex((d) => d.id === activeIdRef.current)
      activate(list[(i + delta + list.length) % list.length].id)
    },
    [activate],
  )

  /* ---------------- ファイル操作 ---------------- */

  const refreshRecent = useCallback(() => void getRecent().then(setRecent), [])

  const doNew = useCallback(() => {
    const id = newId()
    contentsRef.current.set(id, '')
    savedRef.current.set(id, '')
    setDocs([...docsRef.current, { id, name: untitledName(docsRef.current), handle: null, path: null, dirty: false }])
    activate(id)
    editorRef.current?.focus()
  }, [activate, setDocs])

  const doSaveAs = useCallback(async () => {
    const id = activeIdRef.current
    const doc = docsRef.current.find((d) => d.id === id)!
    try {
      const text = contentsRef.current.get(id) ?? ''
      const r = await saveFileAs(text, doc.name)
      if (!r) return false
      savedRef.current.set(id, text)
      patchDoc(id, r === 'downloaded' ? { dirty: false } : { dirty: false, handle: r, name: nfc(r.name), path: null, gh: null })
      autosave()
      toast({ kind: 'success', message: r === 'downloaded' ? 'ダウンロードしました' : `${nfc(r.name)} を保存しました` })
      return true
    } catch (e) {
      reportError(e)
      return false
    }
  }, [autosave, patchDoc, reportError, toast])

  /** GitHub のファイルはローカルに下書きとして一時保存する（コミットは別操作） */
  const saveGhDraft = useCallback(
    async (id: string, gh: GhRef) => {
      const text = contentsRef.current.get(id) ?? ''
      const kept = await saveDraft(gh, text)
      savedRef.current.set(id, text)
      patchDoc(id, { dirty: false })
      autosave()
      return kept
    },
    [autosave, patchDoc],
  )

  const doSave = useCallback(async () => {
    const id = activeIdRef.current
    const doc = docsRef.current.find((d) => d.id === id)
    if (doc?.gh) {
      try {
        const kept = await saveGhDraft(id, doc.gh)
        toast({ kind: 'success', message: kept ? `${doc.name} を一時保存しました（未コミット）` : `${doc.name} は元の内容と同じです` })
        return true
      } catch (e) {
        reportError(e)
        return false
      }
    }
    const h = doc?.handle
    if (!h) return doSaveAs()
    try {
      const text = contentsRef.current.get(id) ?? ''
      await writeHandle(h, text)
      savedRef.current.set(id, text)
      patchDoc(id, { dirty: false })
      autosave()
      toast({ kind: 'success', message: `${nfc(h.name)} を保存しました` })
      return true
    } catch (e) {
      reportError(e)
      return false
    }
  }, [autosave, doSaveAs, patchDoc, reportError, saveGhDraft, toast])

  const loadTree = useCallback(
    async (dir: FileSystemDirectoryHandle) => {
      try {
        setTree(await readTree(dir))
      } catch (e) {
        reportError(e)
      }
    },
    [reportError],
  )

  /* ---------------- プロジェクト ---------------- */

  /** プロジェクトを開く（null で閉じる）。最近のプロジェクトに加え、次回起動時にも開き直す */
  const openProject = useCallback(
    async (p: Project | null) => {
      projectRef.current = p
      setProjectState(p)
      setTree([])
      setNeedsPermission(false)
      void setCurrentProject(p).catch(() => undefined)
      if (!p) return
      setSidebarOpen(true)
      setExplorerOpen(true)
      await addRecent(p)
      if (p.kind === 'directory') await loadTree(p.handle)
    },
    [loadTree, setExplorerOpen, setSidebarOpen],
  )

  /**
   * ローカルのファイルをタブで開く。開いているフォルダ内のファイルならフォルダはそのまま、
   * それ以外はそのファイルを現在のプロジェクトにする
   */
  const openLocalFile = useCallback(
    async (f: OpenedFile) => {
      const cur = projectRef.current
      if (f.handle && cur?.kind === 'directory') {
        const parts = await cur.handle.resolve(f.handle).catch(() => null)
        if (parts) return openDocument(f.name, f.content, f.handle, { path: parts.map(nfc).join('/') })
      }
      await openDocument(f.name, f.content, f.handle)
      if (f.handle) await openProject(handleProject(f.handle))
    },
    [openDocument, openProject],
  )

  const doOpen = useCallback(async () => {
    try {
      for (const f of await openFiles()) await openLocalFile(f)
    } catch (e) {
      reportError(e)
    }
  }, [openLocalFile, reportError])

  const doOpenFolder = useCallback(async () => {
    if (!supportsFSA) return toast({ kind: 'error', message: `フォルダを開けません: ${fsaUnsupportedReason()}` })
    try {
      const dir = await openDirectory()
      if (dir) await openProject(handleProject(dir))
    } catch (e) {
      reportError(e)
    }
  }, [openProject, reportError, toast])

  const doOpenGitHub = useCallback(() => setGhDialogOpen(true), [])

  const openTreeFile = useCallback(
    async (node: TreeNode) => {
      if (node.kind !== 'file') return
      try {
        const f = await readHandle(node.handle as FileSystemFileHandle)
        await openDocument(f.name, f.content, f.handle, { path: node.path })
      } catch (e) {
        reportError(e)
      }
    },
    [openDocument, reportError],
  )

  /** 単一ファイルのプロジェクトを開き直す（タブがあればそのタブに切り替わる） */
  const openProjectFile = useCallback(async () => {
    const p = projectRef.current
    if (p?.kind !== 'file') return
    try {
      if (!(await ensurePermission(p.handle))) return toast({ kind: 'error', message: 'アクセスが許可されませんでした' })
      const f = await readHandle(p.handle)
      await openDocument(f.name, f.content, f.handle)
    } catch (e) {
      reportError(new Error(`${p.name} を開けませんでした（移動・削除された可能性があります）`))
      console.error(e)
    }
  }, [openDocument, reportError, toast])

  /** 起動後に開き直したフォルダへのアクセスを再度許可してもらう */
  const grantPermission = useCallback(async () => {
    const p = projectRef.current
    if (p?.kind !== 'directory') return
    if (!(await ensurePermission(p.handle))) return toast({ kind: 'error', message: 'アクセスが許可されませんでした' })
    setNeedsPermission(false)
    await loadTree(p.handle)
  }, [loadTree, toast])

  const openRecent = useCallback(
    async (r: RecentEntry) => {
      try {
        if (r.kind === 'github') return await openProject(githubProject(r.owner, r.repo, r.branch))
        // 権限は起動ごとに再要求が必要
        if (!(await ensurePermission(r.handle))) return toast({ kind: 'error', message: 'アクセスが許可されませんでした' })
        if (r.kind === 'directory') await openProject(handleProject(r.handle))
        else await openLocalFile(await readHandle(r.handle))
      } catch (e) {
        reportError(new Error(`${r.name} を開けませんでした（移動・削除された可能性があります）`))
        console.error(e)
      }
    },
    [openLocalFile, openProject, reportError, toast],
  )

  const openDropped = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault()
      setDragOver(false)
      // DataTransfer はイベント処理中しか読めないので、先に全項目の取り出しを始めておく
      const items = [...e.dataTransfer.items]
        .filter((i) => i.kind === 'file')
        .map((i) => ({
          handle: 'getAsFileSystemHandle' in i ? i.getAsFileSystemHandle().catch(() => null) : Promise.resolve(null),
          file: i.getAsFile(),
        }))
      for (const item of items) {
        try {
          const handle = await item.handle
          if (handle?.kind === 'directory') await openProject(handleProject(handle as FileSystemDirectoryHandle))
          else if (handle?.kind === 'file') await openLocalFile(await readHandle(handle as FileSystemFileHandle))
          else if (item.file) await openDocument(item.file.name, await item.file.text(), null)
        } catch (err) {
          reportError(err)
        }
      }
    },
    [openDocument, openLocalFile, openProject, reportError],
  )

  /* ---------------- GitHub ---------------- */

  const openGhFile = useCallback(
    async (name: string, content: string, gh: GhRef) => openDocument(name, content, null, { gh }),
    [openDocument],
  )

  const flushGhDrafts = useCallback(async () => {
    for (const d of docsRef.current) if (d.gh && d.dirty) await saveGhDraft(d.id, d.gh)
  }, [saveGhDraft])

  const onGhCommitted = useCallback(
    (drafts: GhDraft[], result: CommitResult) => {
      const committed = new Map(drafts.map((d) => [ghKey(d), d]))
      for (const doc of docsRef.current) {
        const draft = doc.gh && committed.get(ghKey(doc.gh))
        if (!draft || !doc.gh) continue
        savedRef.current.set(doc.id, draft.content)
        patchDoc(doc.id, { gh: { ...doc.gh, sha: result.shas[draft.path] }, dirty: contentsRef.current.get(doc.id) !== draft.content })
      }
      autosave()
    },
    [autosave, patchDoc],
  )

  const onGhDiscarded = useCallback(
    (keys: string[]) => {
      // 破棄した下書きを開いているタブは閉じる（開き直すとリモートの内容になる）
      for (const d of [...docsRef.current]) if (d.gh && keys.includes(ghKey(d.gh))) closeDoc(d.id, true)
    },
    [closeDoc],
  )

  /* ---------------- エクスポート ---------------- */

  const doExportHtml = useCallback(async () => {
    try {
      if (marp) {
        if (await exportMarp({ src: activeContent(), fileName })) toast({ kind: 'success', message: 'スライドを HTML に書き出しました' })
        return
      }
      const root = previewRef.current?.getRoot()
      if (!root) return
      if (await exportHtml({ previewEl: root, src: activeContent(), fileName, theme }))
        toast({ kind: 'success', message: 'HTML に書き出しました' })
    } catch (e) {
      reportError(e)
    }
  }, [fileName, marp, reportError, theme, toast])

  const doExportMarp = useCallback(async () => {
    try {
      if (await exportMarp({ src: activeContent(), fileName })) toast({ kind: 'success', message: 'スライドを HTML に書き出しました' })
    } catch (e) {
      reportError(e)
    }
  }, [fileName, reportError, toast])

  const doPrint = useCallback(async () => {
    // 入力直後でもプレビューを最新にしてから印刷する
    updatePreview.cancel()
    setPreviewSrc(activeContent())
    await new Promise((r) => setTimeout(r, 400))
    const root = previewRef.current?.getRoot()
    if (root) await printDocument({ root, marp: isMarp(activeContent()), fileName }).catch(reportError)
  }, [fileName, reportError, updatePreview])

  const closePresentation = useCallback(() => setPresenting(null), [])

  const startPresentation = useCallback(
    (index = 0) => {
      if (marp) setPresenting(Math.max(0, index))
    },
    [marp],
  )

  /* ---------------- スクロール同期 ---------------- */

  const syncFrame = useRef(0)

  const syncFrom = useCallback(
    (from: 'editor' | 'preview') => {
      if (viewMode !== 'split' || activePaneRef.current !== from) return
      cancelAnimationFrame(syncFrame.current)
      syncFrame.current = requestAnimationFrame(() => {
        const e = editorRef.current
        const p = previewRef.current
        if (!e || !p) return
        if (from === 'editor') p.scrollToLine(e.getTopLine(), e.isAtBottom())
        else e.scrollToLine(p.getTopLine(), p.isAtBottom())
      })
    },
    [viewMode],
  )

  const onPreviewRendered = useCallback(() => {
    // 再描画後もエディターの位置に合わせ直す
    if (activePaneRef.current === 'editor') syncFrom('editor')
  }, [syncFrom])

  const jumpToHeading = useCallback((h: Heading) => {
    activePaneRef.current = null
    previewRef.current?.jumpTo(h.id)
    editorRef.current?.revealLine(h.line)
  }, [])

  const jumpToSlide = useCallback((i: number) => {
    activePaneRef.current = null
    previewRef.current?.jumpTo(i)
    const line = slideStartLines(activeContent())[i]
    if (line) editorRef.current?.revealLine(line)
  }, [])

  /* ---------------- 起動時処理 ---------------- */

  const startedRef = useRef(false)
  useEffect(() => {
    refreshRecent()
    window.addEventListener('recent-changed', refreshRecent)
    if (startedRef.current) return () => window.removeEventListener('recent-changed', refreshRecent)
    startedRef.current = true

    void (async () => {
      // 前回開いていたタブを復元（未保存の変更も含む）
      try {
        const session = await readSession()
        if (session) {
          for (const d of session.docs) {
            contentsRef.current.set(d.id, d.content)
            // 未保存だった文書は保存時の内容が分からないので、どの内容とも一致しない扱いにする
            if (!d.dirty) savedRef.current.set(d.id, d.content)
          }
          setDocs(session.docs.map(({ id, name, handle, path, dirty, gh }) => ({ id, name, handle, path, dirty, gh: gh ?? null })))
          const active = session.docs.some((d) => d.id === session.activeId) ? session.activeId : session.docs[0].id
          activate(active)
          contentsRef.current.delete(WELCOME_ID)
          savedRef.current.delete(WELCOME_ID)
          editorRef.current?.close(WELCOME_ID)
          const unsaved = session.docs.filter((d) => d.dirty).length
          if (unsaved) toast({ message: `前回の未保存の変更（${unsaved} 件）を復元しました` })
        }
      } catch (e) {
        console.error('[session] restore failed', e)
      }
      // 前回のプロジェクトを開き直す（フォルダの権限は起動ごとにユーザー操作での再要求が必要）
      try {
        let saved = await getCurrentProject()
        // GitHub タブ時代の選択（localStorage）を引き継ぐ
        const legacyRepo = localStorage.getItem('md-editor:gh-repo')
        if (legacyRepo) {
          const [owner, repo] = (JSON.parse(legacyRepo) as string).split('/')
          const branch = JSON.parse(localStorage.getItem('md-editor:gh-branch') ?? '""') as string
          localStorage.removeItem('md-editor:gh-repo')
          localStorage.removeItem('md-editor:gh-branch')
          localStorage.removeItem('md-editor:sidebar-tab')
          if (!saved && owner && repo && branch) {
            saved = githubProject(owner, repo, branch)
            await setCurrentProject(saved)
            await addRecent(saved)
          }
        }
        if (saved && !projectRef.current) {
          projectRef.current = saved
          setProjectState(saved)
          if (saved.kind === 'directory') {
            if ((await saved.handle.queryPermission({ mode: 'readwrite' })) === 'granted') await loadTree(saved.handle)
            else setNeedsPermission(true)
          }
        }
      } catch (e) {
        console.error('[project] restore failed', e)
      }
      // OS から .md ファイルを開いたとき（file_handlers）。復元の後にタブとして追加する
      window.launchQueue?.setConsumer(async (params) => {
        for (const h of params.files) {
          if (h.kind !== 'file') continue
          try {
            await openLocalFile(await readHandle(h as FileSystemFileHandle))
          } catch (e) {
            reportError(e)
          }
        }
      })
    })()
    return () => window.removeEventListener('recent-changed', refreshRecent)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 未保存の変更があれば閉じる前に確認
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (!docsRef.current.some((d) => d.dirty)) return
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [])

  useEffect(() => {
    document.title = `${activeDoc.dirty ? '● ' : ''}${fileName} - Markdown Editor`
  }, [activeDoc.dirty, fileName])

  /* ---------------- キーボードショートカット ---------------- */

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (presenting !== null) return
      const mod = e.ctrlKey || e.metaKey
      const k = e.key.toLowerCase()
      let handled = true
      if (mod && e.altKey && k === 'n') doNew()
      else if (mod && e.altKey && k === 'w') closeDoc(activeIdRef.current)
      else if (mod && e.altKey && (e.key === 'ArrowRight' || e.key === 'PageDown')) cycleTab(1)
      else if (mod && e.altKey && (e.key === 'ArrowLeft' || e.key === 'PageUp')) cycleTab(-1)
      else if (mod && e.altKey && k === 'o') void doOpenFolder()
      else if (mod && e.altKey && k === 'g') doOpenGitHub()
      else if (mod && e.altKey && k === 't') cycleTheme()
      else if (mod && e.shiftKey && k === 's') void doSaveAs()
      else if (mod && !e.shiftKey && k === 's') void doSave()
      else if (mod && !e.shiftKey && !e.altKey && k === 'o') void doOpen()
      else if (mod && !e.shiftKey && k === 'p') void doPrint()
      else if (mod && e.shiftKey && k === 'e') void doExportHtml()
      else if (mod && !e.shiftKey && k === 'b') setSidebarOpen((v) => !v)
      else if ((mod && k === '/') || e.key === 'F1') setHelpOpen(true)
      else if (e.key === 'F5' && marp) startPresentation(0)
      else if (e.altKey && !mod && ['1', '2', '3'].includes(e.key))
        setViewMode((['editor', 'split', 'preview'] as const)[Number(e.key) - 1])
      else handled = false
      if (handled) {
        e.preventDefault()
        e.stopPropagation()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [
    closeDoc,
    cycleTab,
    cycleTheme,
    doExportHtml,
    doNew,
    doOpen,
    doOpenFolder,
    doOpenGitHub,
    doPrint,
    doSave,
    doSaveAs,
    marp,
    presenting,
    setSidebarOpen,
    setViewMode,
    startPresentation,
  ])

  /* ---------------- 分割バー ---------------- */

  const onSplitterDown = (e: React.PointerEvent) => {
    e.preventDefault()
    const main = mainRef.current!
    const rect = main.getBoundingClientRect()
    document.body.classList.add('is-resizing')
    const move = (ev: PointerEvent) => setRatio(Math.min(0.85, Math.max(0.15, (ev.clientX - rect.left) / rect.width)))
    const up = () => {
      document.body.classList.remove('is-resizing')
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  const sidebarRef = useRef<HTMLElement>(null)
  const onSideSplitterDown = (e: React.PointerEvent) => {
    e.preventDefault()
    const rect = sidebarRef.current!.getBoundingClientRect()
    document.body.classList.add('is-resizing-v')
    const move = (ev: PointerEvent) => setSideSplit(Math.min(0.9, Math.max(0.1, (ev.clientY - rect.top) / rect.height)))
    const up = () => {
      document.body.classList.remove('is-resizing-v')
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  /* ---------------- 描画 ---------------- */

  const previewProps = {
    src: previewSrc,
    themeKey: theme,
    onScroll: () => syncFrom('preview'),
    onUserInteract: () => (activePaneRef.current = 'preview'),
  }

  return (
    <div
      className={`app view-${viewMode}${dragOver ? ' is-dragover' : ''}`}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('Files')) {
          e.preventDefault()
          setDragOver(true)
        }
      }}
      onDragLeave={(e) => e.currentTarget === e.target && setDragOver(false)}
      onDrop={openDropped}
    >
      <Toolbar
        title={fileName}
        dirty={activeDoc.dirty}
        marp={marp}
        viewMode={viewMode}
        themePref={themePref}
        sidebarOpen={sidebarOpen}
        onNew={doNew}
        onOpen={doOpen}
        onOpenFolder={doOpenFolder}
        onOpenGitHub={doOpenGitHub}
        onGitHubKey={() => setGhKeyDialogOpen(true)}
        onSave={doSave}
        onSaveAs={doSaveAs}
        onExportHtml={doExportHtml}
        onExportMarp={doExportMarp}
        onPrint={doPrint}
        onViewMode={setViewMode}
        onToggleSidebar={() => setSidebarOpen((v) => !v)}
        onCycleTheme={cycleTheme}
        onPresent={() => startPresentation(0)}
        onHelp={() => setHelpOpen(true)}
      />

      <TabBar docs={docs} activeId={activeId} onSelect={activate} onClose={closeDoc} onNew={doNew} />

      <div className="workspace">
        {sidebarOpen && (
          <aside className="sidebar" ref={sidebarRef}>
            <SidebarSection
              title="エクスプローラ"
              open={explorerOpen}
              grow={outlineOpen ? sideSplit : 1}
              onToggle={() => setExplorerOpen((v) => !v)}
            >
              <Explorer
                project={project}
                needsPermission={needsPermission}
                tree={tree}
                currentPath={activeDoc.path}
                currentGh={activeDoc.gh ?? null}
                currentIsProjectFile={project?.kind === 'file' && !!activeDoc.handle && activeDoc.name === project.name}
                recent={recent}
                supported={supportsFSA}
                github={{
                  onBranch: (branch) => project?.kind === 'github' && void openProject({ ...project, branch }),
                  onOpen: openGhFile,
                  onBeforeCommit: flushGhDrafts,
                  onCommitted: onGhCommitted,
                  onDiscarded: onGhDiscarded,
                  onRequestToken: doOpenGitHub,
                  onError: reportError,
                  onToast: (message) => toast({ kind: 'success', message }),
                }}
                onOpenTreeFile={openTreeFile}
                onOpenProjectFile={openProjectFile}
                onGrantPermission={grantPermission}
                onRefresh={() => project?.kind === 'directory' && void loadTree(project.handle)}
                onCloseProject={() => void openProject(null)}
                onOpenFile={doOpen}
                onOpenFolder={doOpenFolder}
                onOpenGitHub={doOpenGitHub}
                onOpenRecent={openRecent}
                onRemoveRecent={(r) => void removeRecent(r)}
              />
            </SidebarSection>
            {explorerOpen && outlineOpen && (
              <div className="side-splitter" onPointerDown={onSideSplitterDown} onDoubleClick={() => setSideSplit(0.6)} title="ドラッグで高さを変更" />
            )}
            <SidebarSection
              title={marp ? 'スライド' : 'アウトライン'}
              open={outlineOpen}
              grow={explorerOpen ? 1 - sideSplit : 1}
              onToggle={() => setOutlineOpen((v) => !v)}
            >
              <TocSidebar marp={marp} headings={headings} slides={slides} onHeading={jumpToHeading} onSlide={jumpToSlide} />
            </SidebarSection>
          </aside>
        )}

        <main className="main" ref={mainRef} style={{ ['--ratio' as string]: ratio }}>
          <section className="pane pane-editor">
            <Editor
              ref={editorRef}
              initialId={WELCOME_ID}
              initialDoc={WELCOME}
              dark={theme === 'dark'}
              onChange={onChange}
              onScroll={() => syncFrom('editor')}
              onUserInteract={() => (activePaneRef.current = 'editor')}
            />
          </section>
          <div className="splitter" onPointerDown={onSplitterDown} onDoubleClick={() => setRatio(0.5)} title="ドラッグで幅を変更（ダブルクリックで等分）" />
          <section className="pane pane-preview">
            {marp ? (
              <SlidePreview ref={previewRef} {...previewProps} onSlides={setSlides} onPresent={startPresentation} />
            ) : (
              <Preview ref={previewRef} {...previewProps} onHeadings={setHeadings} onRendered={onPreviewRendered} />
            )}
          </section>
        </main>
      </div>

      {presenting !== null && previewRef.current?.getRoot() && (
        <PresentationMode source={previewRef.current.getRoot()!} startIndex={presenting} onClose={closePresentation} />
      )}
      {helpOpen && <HelpDialog onClose={() => setHelpOpen(false)} />}
      {ghKeyDialogOpen && (
        <GitHubKeyDialog
          onClose={() => setGhKeyDialogOpen(false)}
          onError={reportError}
          onToast={(message) => toast({ kind: 'success', message })}
        />
      )}
      {ghDialogOpen && (
        <GitHubOpenDialog
          initialRepo={project?.kind === 'github' ? project.name : ''}
          onClose={() => setGhDialogOpen(false)}
          onError={reportError}
          onOpen={(owner, repo, branch) => {
            setGhDialogOpen(false)
            void openProject(githubProject(owner, repo, branch))
          }}
        />
      )}
      <Toasts items={toasts} onDismiss={dismissToast} />
      {dragOver && <div className="drop-hint">ここにドロップして開く（.md ファイル / フォルダ）</div>}
      {!supportsFSA && <FallbackNotice />}
    </div>
  )
}

/** サイドバーの折りたたみできる区画 */
function SidebarSection(props: { title: string; open: boolean; grow: number; onToggle(): void; children: React.ReactNode }) {
  return (
    <section className={`side-section${props.open ? ' is-open' : ''}`} style={props.open ? { flexGrow: props.grow } : undefined}>
      <button className="side-head" onClick={props.onToggle} aria-expanded={props.open}>
        <span className="tree-caret">{props.open ? '▾' : '▸'}</span>
        {props.title}
      </button>
      {props.open && <div className="side-body">{props.children}</div>}
    </section>
  )
}

function FallbackNotice() {
  const [hidden, setHidden] = useState(false)
  if (hidden) return null
  return (
    <div className="fallback-notice">
      <span>
        File System Access API が使えないため、読み込みはファイル選択、保存はダウンロードになります。
        <br />
        {fsaUnsupportedReason()}
      </span>
      <button className="icon-btn" onClick={() => setHidden(true)}>
        ✕
      </button>
    </div>
  )
}
