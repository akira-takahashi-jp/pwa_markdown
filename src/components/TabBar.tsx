import { useEffect, useRef } from 'react'

export interface DocMeta {
  id: string
  name: string
  handle: FileSystemFileHandle | null
  /** 開いたフォルダ内の相対パス（ツリーのハイライト用） */
  path: string | null
  dirty: boolean
}

interface Props {
  docs: DocMeta[]
  activeId: string
  onSelect(id: string): void
  onClose(id: string): void
  onNew(): void
}

export function TabBar({ docs, activeId, onSelect, onClose, onNew }: Props) {
  const listRef = useRef<HTMLDivElement>(null)

  // アクティブなタブが見えるようにスクロール
  useEffect(() => {
    listRef.current?.querySelector('.doc-tab.is-active')?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [activeId, docs.length])

  return (
    <div className="tabbar">
      <div
        className="tabbar-list"
        role="tablist"
        ref={listRef}
        onWheel={(e) => {
          // 縦ホイールで横スクロール
          if (e.deltaY && listRef.current) listRef.current.scrollLeft += e.deltaY
        }}
      >
        {docs.map((d) => (
          <div
            key={d.id}
            role="tab"
            aria-selected={d.id === activeId}
            className={`doc-tab${d.id === activeId ? ' is-active' : ''}${d.dirty ? ' is-dirty' : ''}`}
            title={d.path ?? d.name}
            onMouseDown={(e) => {
              if (e.button === 0) onSelect(d.id)
            }}
            onAuxClick={(e) => {
              // 中クリックで閉じる
              if (e.button === 1) {
                e.preventDefault()
                onClose(d.id)
              }
            }}
          >
            <span className="doc-tab-name">{d.name}</span>
            <button
              className="doc-tab-close"
              onMouseDown={(e) => e.stopPropagation()}
              onClick={() => onClose(d.id)}
              aria-label={`${d.name} を閉じる`}
              title="閉じる (Ctrl+Alt+W)"
            >
              <span className="dot">●</span>
              <span className="x">✕</span>
            </button>
          </div>
        ))}
      </div>
      <button className="icon-btn tabbar-new" onClick={onNew} title="新規作成 (Ctrl+Alt+N)" aria-label="新規作成">
        ＋
      </button>
    </div>
  )
}
