export interface ToastItem {
  id: number
  message: string
  kind?: 'info' | 'error' | 'success'
  action?: { label: string; onClick(): void }
  sticky?: boolean
}

export function Toasts({ items, onDismiss }: { items: ToastItem[]; onDismiss(id: number): void }) {
  return (
    <div className="toasts" role="status" aria-live="polite">
      {items.map((t) => (
        <div key={t.id} className={`toast toast-${t.kind ?? 'info'}`}>
          <span>{t.message}</span>
          {t.action && (
            <button
              className="btn btn-primary"
              onClick={() => {
                t.action!.onClick()
                onDismiss(t.id)
              }}
            >
              {t.action.label}
            </button>
          )}
          <button className="icon-btn" onClick={() => onDismiss(t.id)} aria-label="閉じる">
            ✕
          </button>
        </div>
      ))}
    </div>
  )
}
