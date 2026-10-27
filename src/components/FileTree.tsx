import { useState } from 'react'
import { fsaUnsupportedReason, type RecentEntry, type TreeNode } from '../lib/fs'

interface Props {
  rootName: string | null
  tree: TreeNode[]
  currentPath: string | null
  recent: RecentEntry[]
  supported: boolean
  onOpenFile(node: TreeNode): void
  onOpenFolder(): void
  onRefresh(): void
  onOpenRecent(entry: RecentEntry): void
  onRemoveRecent(entry: RecentEntry): void
}

function Node({ node, currentPath, onOpenFile }: { node: TreeNode; currentPath: string | null; onOpenFile(n: TreeNode): void }) {
  const [open, setOpen] = useState(true)
  if (node.kind === 'directory') {
    return (
      <li>
        <button className="tree-dir" onClick={() => setOpen(!open)}>
          <span className="tree-caret">{open ? '▾' : '▸'}</span>📁 {node.name}
        </button>
        {open && (
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

export function FileTree(props: Props) {
  return (
    <div className="file-panel">
      <section>
        <header className="panel-head">
          <span title={props.rootName ?? ''}>{props.rootName ?? 'フォルダ'}</span>
          <span>
            {props.rootName && (
              <button className="icon-btn" onClick={props.onRefresh} title="再読み込み">
                ⟳
              </button>
            )}
            <button className="icon-btn" onClick={props.onOpenFolder} title="フォルダを開く (Ctrl+Alt+O)" disabled={!props.supported}>
              📂
            </button>
          </span>
        </header>
        {!props.supported ? (
          <p className="empty">フォルダを開く機能が使えません。{fsaUnsupportedReason()}</p>
        ) : props.rootName ? (
          props.tree.length ? (
            <ul className="tree">
              {props.tree.map((n) => <Node key={n.path} node={n} currentPath={props.currentPath} onOpenFile={props.onOpenFile} />)}
            </ul>
          ) : (
            <p className="empty">.md ファイルがありません</p>
          )
        ) : (
          <p className="empty">
            <button className="btn" onClick={props.onOpenFolder}>
              フォルダを開く
            </button>
          </p>
        )}
      </section>
      {props.supported && (
        <section>
          <header className="panel-head">
            <span>最近使ったファイル</span>
          </header>
          {props.recent.length === 0 ? (
            <p className="empty">履歴はありません</p>
          ) : (
            <ul className="recent">
              {props.recent.map((r) => (
                <li key={r.openedAt + r.name}>
                  <button onClick={() => props.onOpenRecent(r)} title={new Date(r.openedAt).toLocaleString()}>
                    {r.kind === 'directory' ? '📁' : '📄'} {r.name}
                  </button>
                  <button className="icon-btn" onClick={() => props.onRemoveRecent(r)} title="履歴から削除">
                    ✕
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  )
}
