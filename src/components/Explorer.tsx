import { createContext, useContext, useEffect, useState, type DragEvent, type ReactNode } from 'react'
import { fsaUnsupportedReason, isAncestor, nfc, sameProject, type Project, type RecentEntry, type TreeNode } from '../lib/fs'
import type { GhRef } from '../lib/github'
import { GitHubProject, useGhDrafts } from './GitHub'

type GitHubHandlers = Omit<Parameters<typeof GitHubProject>[0], 'owner' | 'repo' | 'branch' | 'current'>

interface Props {
  project: Project | null
  /** フォルダのアクセス許可が必要（再起動後はユーザー操作で再要求する） */
  needsPermission: boolean
  tree: TreeNode[]
  /** アクティブなタブ（ハイライト用） */
  currentPath: string | null
  currentGh: GhRef | null
  currentIsProjectFile: boolean
  recent: RecentEntry[]
  supported: boolean
  github: GitHubHandlers
  onOpenTreeFile(node: TreeNode): void
  onOpenProjectFile(): void
  onGrantPermission(): void
  onRefresh(): void
  onNewFolder(): void
  /** ツリーの項目（from）をフォルダ（toDir。空文字ならルート）へ移動する */
  onMove(from: string, toDir: string): void
  onCloseProject(): void
  onOpenFile(): void
  onOpenFolder(): void
  onOpenGitHub(): void
  onOpenRecent(entry: RecentEntry): void
  onRemoveRecent(entry: RecentEntry): void
}

const ICON: Record<Project['kind'], string> = { file: '📄', directory: '📁', github: '🐙' }
const KIND_LABEL: Record<Project['kind'], string> = { file: 'ファイル', directory: 'フォルダ', github: 'GitHub リポジトリ' }

/** ツリー内のドラッグで運ぶデータの種類（外部からのファイルのドロップと区別する） */
const TREE_MIME = 'application/x-md-editor-tree-path'

/** ツリーのドラッグ＆ドロップによる移動 */
interface TreeDnd {
  /** ドロップ先として強調しているフォルダのパス（ルートは空文字） */
  target: string | null
  setTarget(path: string | null): void
  onMove(from: string, toDir: string): void
}
const DndContext = createContext<TreeDnd | null>(null)

/** dir をドロップ先にするためのイベントハンドラ */
function useDropTarget(dir: string) {
  const dnd = useContext(DndContext)
  if (!dnd) return {}
  return {
    onDragOver(e: DragEvent) {
      if (!e.dataTransfer.types.includes(TREE_MIME)) return
      e.preventDefault()
      e.stopPropagation()
      e.dataTransfer.dropEffect = 'move'
      if (dnd.target !== dir) dnd.setTarget(dir)
    },
    onDrop(e: DragEvent) {
      const from = e.dataTransfer.getData(TREE_MIME)
      if (!from) return
      e.preventDefault()
      e.stopPropagation()
      dnd.setTarget(null)
      dnd.onMove(from, dir)
    },
  }
}

function useDragSource(path: string) {
  const dnd = useContext(DndContext)
  if (!dnd) return {}
  return {
    draggable: true,
    onDragStart(e: DragEvent) {
      e.dataTransfer.setData(TREE_MIME, path)
      e.dataTransfer.effectAllowed = 'move'
    },
    onDragEnd: () => dnd.setTarget(null),
  }
}

function Node({ node, currentPath, onOpenFile }: { node: TreeNode; currentPath: string | null; onOpenFile(n: TreeNode): void }) {
  // .md を含まないフォルダは閉じた状態で薄く表示する
  const hasMd = node.kind === 'directory' && (node.mdCount ?? 0) > 0
  // フォルダは閉じた状態で表示し、開いている文書を含むフォルダだけ開く
  const [open, setOpen] = useState(() => isAncestor(node.path, currentPath))
  useEffect(() => {
    if (isAncestor(node.path, currentPath)) setOpen(true)
  }, [node.path, currentPath])
  const dnd = useContext(DndContext)
  const drag = useDragSource(node.path)
  const drop = useDropTarget(node.path)
  if (node.kind === 'directory') {
    const empty = !node.children?.length
    // フォルダの上か、その中の項目の上にドロップするとこのフォルダへ移動する
    return (
      <li {...drop} className={dnd?.target === node.path ? 'is-drop-target' : undefined}>
        <button
          {...drag}
          className={`tree-dir${hasMd ? '' : ' is-empty'}`}
          onClick={() => setOpen(!open)}
          title={hasMd ? node.path : `${node.path}（.md ファイルなし）`}
        >
          <span className="tree-caret">{empty ? '' : open ? '▾' : '▸'}</span>📁 {node.name}
        </button>
        {open && !empty && (
          <ul>
            {node.children?.map((c) => <Node key={c.path} node={c} currentPath={currentPath} onOpenFile={onOpenFile} />)}
          </ul>
        )}
      </li>
    )
  }
  return (
    <li>
      <button
        {...drag}
        className={`tree-file${node.path === currentPath ? ' is-active' : ''}`}
        onClick={() => onOpenFile(node)}
        title={node.path}
      >
        📄 {node.name}
      </button>
    </li>
  )
}

/** ローカルフォルダのツリー。ドラッグ＆ドロップでファイル・フォルダを移動できる */
function LocalTree({ name, tree, currentPath, onOpenFile, onMove }: {
  name: string
  tree: TreeNode[]
  currentPath: string | null
  onOpenFile(n: TreeNode): void
  onMove(from: string, toDir: string): void
}) {
  const [target, setTarget] = useState<string | null>(null)
  return (
    <DndContext.Provider value={{ target, setTarget, onMove }}>
      <RootDrop name={name}>
        {tree.length ? (
          <ul className="tree">
            {tree.map((n) => <Node key={n.path} node={n} currentPath={currentPath} onOpenFile={onOpenFile} />)}
          </ul>
        ) : (
          <p className="empty">.md ファイルがありません</p>
        )}
      </RootDrop>
    </DndContext.Provider>
  )
}

/** プロジェクト名とツリー全体。フォルダ以外の場所へのドロップはルートへの移動になる */
function RootDrop({ name, children }: { name: string; children: ReactNode }) {
  const dnd = useContext(DndContext)!
  const drop = useDropTarget('')
  return (
    <div
      {...drop}
      className={`tree-root${dnd.target === '' ? ' is-drop-target' : ''}`}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Element | null)) dnd.setTarget(null)
      }}
    >
      <div className="project-title" title={`${KIND_LABEL.directory}: ${name}`}>
        {ICON.directory} {nfc(name)}
      </div>
      {children}
    </div>
  )
}

/** 現在のプロジェクトと最近のプロジェクト */
export function Explorer(props: Props) {
  const { project } = props
  const drafts = useGhDrafts()
  const [others, setOthers] = useState<RecentEntry[]>(props.recent)

  // 最近のプロジェクトから現在のプロジェクトを除く
  useEffect(() => {
    let cancelled = false
    void (async () => {
      const list: RecentEntry[] = []
      for (const r of props.recent) if (!project || !(await sameProject(r, project))) list.push(r)
      if (!cancelled) setOthers(list)
    })()
    return () => {
      cancelled = true
    }
  }, [props.recent, project])

  const draftCount = (owner: string, repo: string) => drafts.filter((d) => d.owner === owner && d.repo === repo).length

  return (
    <div className="explorer">
      <section>
        <header className="panel-head">
          <span>現在のプロジェクト</span>
          {project && (
            <span>
              {project.kind === 'directory' && !props.needsPermission && (
                <>
                  <button className="icon-btn" onClick={props.onNewFolder} title="新しいフォルダ">
                    ＋📁
                  </button>
                  <button className="icon-btn" onClick={props.onRefresh} title="再読み込み">
                    ⟳
                  </button>
                </>
              )}
              <button className="icon-btn" onClick={props.onCloseProject} title="プロジェクトを閉じる">
                ✕
              </button>
            </span>
          )}
        </header>
        {project && !(project.kind === 'directory' && !props.needsPermission) && (
          <div className="project-title" title={`${KIND_LABEL[project.kind]}: ${project.name}`}>
            {ICON[project.kind]} {nfc(project.name)}
          </div>
        )}
        {!project ? (
          <div className="explorer-empty">
            <p>ファイル・フォルダ・GitHub リポジトリを開くと、ここに表示されます。</p>
            <button className="btn" onClick={props.onOpenFolder} disabled={!props.supported} title={fsaUnsupportedReason() ?? 'Ctrl+Alt+O'}>
              📁 フォルダを開く
            </button>
            <button className="btn" onClick={props.onOpenGitHub} title="Ctrl+Alt+G">
              🐙 GitHub リポジトリを開く
            </button>
            <button className="btn" onClick={props.onOpenFile} title="Ctrl+O">
              📄 ファイルを開く
            </button>
          </div>
        ) : project.kind === 'github' ? (
          <GitHubProject {...props.github} owner={project.owner} repo={project.repo} branch={project.branch} current={props.currentGh} />
        ) : project.kind === 'file' ? (
          <ul className="tree">
            <li>
              <button className={`tree-file${props.currentIsProjectFile ? ' is-active' : ''}`} onClick={props.onOpenProjectFile}>
                📄 {nfc(project.name)}
              </button>
            </li>
          </ul>
        ) : props.needsPermission ? (
          <p className="empty">
            フォルダへのアクセスを再度許可してください。
            <br />
            <button className="btn" onClick={props.onGrantPermission}>
              アクセスを許可
            </button>
          </p>
        ) : (
          <LocalTree name={project.name} tree={props.tree} currentPath={props.currentPath} onOpenFile={props.onOpenTreeFile} onMove={props.onMove} />
        )}
      </section>
      <section>
        <header className="panel-head">
          <span>最近のプロジェクト</span>
        </header>
        {others.length === 0 ? (
          <p className="empty">履歴はありません</p>
        ) : (
          <ul className="recent">
            {others.map((r) => {
              const n = r.kind === 'github' ? draftCount(r.owner, r.repo) : 0
              return (
                <li key={r.openedAt + r.name}>
                  <button
                    onClick={() => props.onOpenRecent(r)}
                    title={`${KIND_LABEL[r.kind]}: ${r.kind === 'github' ? `${r.name}@${r.branch}` : r.name}\n${new Date(r.openedAt).toLocaleString()}`}
                  >
                    {ICON[r.kind]} {nfc(r.name)}
                    {n > 0 && <span className="recent-badge" title={`未コミットの変更 ${n} 件`}>● {n}</span>}
                  </button>
                  <button className="icon-btn" onClick={() => props.onRemoveRecent(r)} title="履歴から削除">
                    ✕
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </section>
    </div>
  )
}
