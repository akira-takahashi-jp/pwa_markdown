import { useEffect, useRef, type ReactNode } from 'react'
import type { ThemePref } from '../lib/theme'

export type ViewMode = 'editor' | 'split' | 'preview'

interface Props {
  title: string
  dirty: boolean
  marp: boolean
  viewMode: ViewMode
  themePref: ThemePref
  sidebarOpen: boolean
  onNew(): void
  onOpen(): void
  onOpenFolder(): void
  onSave(): void
  onSaveAs(): void
  onExportHtml(): void
  onExportMarp(): void
  onPrint(): void
  onViewMode(m: ViewMode): void
  onToggleSidebar(): void
  onCycleTheme(): void
  onPresent(): void
  onHelp(): void
}

/** サイドバーの開閉アイコン（左に区切りのあるパネル） */
function SidebarIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" aria-hidden="true">
      <rect x="1.5" y="2" width="13" height="12" rx="2" />
      <line x1="6" y1="2" x2="6" y2="14" />
    </svg>
  )
}

/**
 * メニューバーのメニュー。クリックで開閉し、外側クリックで閉じる。
 * 別のメニューが開いているときはホバーだけで切り替わる（デスクトップアプリのメニューバーと同じ）
 */
function Menu({ label, title, children }: { label: ReactNode; title: string; children: ReactNode }) {
  const ref = useRef<HTMLDetailsElement>(null)
  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (ref.current?.open && !ref.current.contains(e.target as Node)) ref.current.open = false
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [])
  return (
    <details
      className="menu"
      ref={ref}
      onMouseEnter={() => {
        const opened = ref.current?.parentElement?.querySelector<HTMLDetailsElement>(':scope > details.menu[open]')
        if (opened && opened !== ref.current) {
          opened.open = false
          ref.current!.open = true
        }
      }}
    >
      <summary className="menu-trigger" title={title}>
        {label}
      </summary>
      <div className="menu-list" onClick={() => ref.current && (ref.current.open = false)}>
        {children}
      </div>
    </details>
  )
}

const THEME_LABEL: Record<ThemePref, string> = { system: '🖥 自動', light: '☀ ライト', dark: '🌙 ダーク' }

export function Toolbar(p: Props) {
  return (
    <header className="toolbar">
      <button className={`icon-btn${p.sidebarOpen ? ' is-on' : ''}`} onClick={p.onToggleSidebar} title="サイドバー (Ctrl+B)">
        <SidebarIcon />
      </button>
      <Menu label="ファイル" title="ファイル">
        <button onClick={p.onNew}>
          新規作成<kbd>Ctrl+Alt+N</kbd>
        </button>
        <button onClick={p.onOpen}>
          開く…<kbd>Ctrl+O</kbd>
        </button>
        <button onClick={p.onOpenFolder}>
          フォルダを開く…<kbd>Ctrl+Alt+O</kbd>
        </button>
        <hr />
        <button onClick={p.onSave}>
          上書き保存<kbd>Ctrl+S</kbd>
        </button>
        <button onClick={p.onSaveAs}>
          名前を付けて保存…<kbd>Ctrl+Shift+S</kbd>
        </button>
      </Menu>
      <Menu label="エクスポート" title="エクスポート">
        <button onClick={p.onExportHtml}>
          HTML（単一ファイル）<kbd>Ctrl+Shift+E</kbd>
        </button>
        <button onClick={p.onPrint}>
          PDF（印刷）<kbd>Ctrl+P</kbd>
        </button>
        <button onClick={p.onExportMarp} disabled={!p.marp}>
          Marp スライド HTML
        </button>
      </Menu>
      <div className="toolbar-title" title={p.title}>
        {p.dirty && <span className="dirty-dot">●</span>}
        {p.title}
        {p.marp && <span className="badge">Marp</span>}
      </div>
      {p.marp && (
        <button className="btn" onClick={p.onPresent} title="プレゼンテーション (F5)">
          ▶ 発表
        </button>
      )}
      <div className="segmented" role="group" aria-label="表示モード">
        {(
          [
            ['editor', '編集', 'Alt+1'],
            ['split', '分割', 'Alt+2'],
            ['preview', 'プレビュー', 'Alt+3'],
          ] as const
        ).map(([m, label, key]) => (
          <button key={m} className={p.viewMode === m ? 'is-on' : ''} onClick={() => p.onViewMode(m)} title={`${label} (${key})`}>
            {label}
          </button>
        ))}
      </div>
      <button className="btn" onClick={p.onCycleTheme} title="テーマ (Ctrl+Alt+T)">
        {THEME_LABEL[p.themePref]}
      </button>
      <button className="icon-btn" onClick={p.onHelp} title="ヘルプ (F1)">
        ?
      </button>
    </header>
  )
}
