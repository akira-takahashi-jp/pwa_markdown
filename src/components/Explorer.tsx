import { useEffect, useState } from 'react'
import { fsaUnsupportedReason, nfc, sameProject, type Project, type RecentEntry, type TreeNode } from '../lib/fs'
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
  onCloseProject(): void
  onOpenFile(): void
  onOpenFolder(): void
  onOpenGitHub(): void
  onOpenRecent(entry: RecentEntry): void
  onRemoveRecent(entry: RecentEntry): void
}

const ICON: Record<Project['kind'], string> = { file: '📄', directory: '📁', github: '🐙' }
const KIND_LABEL: Record<Project['kind'], string> = { file: 'ファイル', directory: 'フォルダ', github: 'GitHub リポジトリ' }

function Node({ node, currentPath, onOpenFile }: { node: TreeNode; currentPath: string | null; onOpenFile(n: TreeNode): void }) {
  // .md を含まないフォルダは閉じた状態で薄く表示する
  const hasMd = node.kind === 'directory' && (node.mdCount ?? 0) > 0
  const [open, setOpen] = useState(hasMd)
  if (node.kind === 'directory') {
    const empty = !node.children?.length
    return (
      <li>
        <button
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
      <button className={`tree-file${node.path === currentPath ? ' is-active' : ''}`} onClick={() => onOpenFile(node)} title={node.path}>
        📄 {node.name}
      </button>
    </li>
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
                <button className="icon-btn" onClick={props.onRefresh} title="再読み込み">
                  ⟳
                </button>
              )}
              <button className="icon-btn" onClick={props.onCloseProject} title="プロジェクトを閉じる">
                ✕
              </button>
            </span>
          )}
        </header>
        {project && (
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
        ) : props.tree.length ? (
          <ul className="tree">
            {props.tree.map((n) => <Node key={n.path} node={n} currentPath={props.currentPath} onOpenFile={props.onOpenTreeFile} />)}
          </ul>
        ) : (
          <p className="empty">.md ファイルがありません</p>
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
