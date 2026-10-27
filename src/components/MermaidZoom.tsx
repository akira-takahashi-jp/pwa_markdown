import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'

const MIN = 0.25
const MAX = 8
const STEP = 1.25
const clamp = (v: number) => Math.min(MAX, Math.max(MIN, v))

/* ---------------- プレビュー内での拡大縮小 ---------------- */

export function getInlineZoom(ph: HTMLElement): number {
  return Number(ph.dataset.zoom ?? 1)
}

/**
 * 図をプレビュー内で拡大縮小する。拡大中は図の枠内でスクロール（ドラッグで移動）できる。
 * anchor を渡すとその点（枠内の座標）を固定したまま拡大する。
 */
export function setInlineZoom(ph: HTMLElement, next: number, anchor?: { x: number; y: number }) {
  const svg = ph.querySelector<SVGSVGElement>(':scope > svg')
  if (!svg) return
  const prev = getInlineZoom(ph)
  const scale = Math.abs(clamp(next) - 1) < 0.01 ? 1 : clamp(next)
  if (scale === prev) return
  // 等倍（枠に収まる幅）を基準にする
  if (!ph.dataset.fitw) ph.dataset.fitw = String(svg.getBoundingClientRect().width / prev)
  const fitW = Number(ph.dataset.fitw)
  const ax = anchor?.x ?? ph.clientWidth / 2
  const ay = anchor?.y ?? ph.clientHeight / 2
  const sx = ph.scrollLeft + ax
  const sy = ph.scrollTop + ay
  if (scale === 1) {
    svg.style.removeProperty('width')
    svg.style.removeProperty('max-width')
    ph.classList.remove('is-zoomed')
    delete ph.dataset.zoom
    delete ph.dataset.fitw
    return
  }
  svg.style.width = `${fitW * scale}px`
  svg.style.maxWidth = 'none'
  ph.classList.add('is-zoomed')
  ph.dataset.zoom = String(scale)
  const r = scale / prev
  ph.scrollLeft = sx * r - ax
  ph.scrollTop = sy * r - ay
}

/** 描画済み（エラーでない）mermaid の図 */
export function zoomableDiagram(target: EventTarget | null): HTMLElement | null {
  const ph = (target as Element | null)?.closest?.<HTMLElement>('.mermaid-ph')
  return ph && ph.dataset.state === 'done' && !ph.classList.contains('is-error') && ph.querySelector(':scope > svg') ? ph : null
}

/**
 * プレビュー内の図に、Ctrl(⌘)+ホイール / トラックパッドのピンチでの拡大縮小と、
 * 拡大中のドラッグ移動を付ける。
 */
export function useInlineDiagramZoom(content: React.RefObject<HTMLElement | null>, onChange: () => void) {
  useEffect(() => {
    const root = content.current!
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return
      const ph = zoomableDiagram(e.target)
      if (!ph) return
      e.preventDefault()
      const rect = ph.getBoundingClientRect()
      const factor = Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.002))
      setInlineZoom(ph, getInlineZoom(ph) * factor, { x: e.clientX - rect.left, y: e.clientY - rect.top })
      onChange()
    }
    let drag: { ph: HTMLElement; x: number; y: number; left: number; top: number } | null = null
    const onDown = (e: PointerEvent) => {
      const ph = zoomableDiagram(e.target)
      if (!ph?.classList.contains('is-zoomed') || e.button !== 0) return
      drag = { ph, x: e.clientX, y: e.clientY, left: ph.scrollLeft, top: ph.scrollTop }
      ph.setPointerCapture(e.pointerId)
      ph.classList.add('is-dragging')
      e.preventDefault()
    }
    const onMove = (e: PointerEvent) => {
      if (!drag) return
      drag.ph.scrollLeft = drag.left - (e.clientX - drag.x)
      drag.ph.scrollTop = drag.top - (e.clientY - drag.y)
    }
    const onUp = () => {
      drag?.ph.classList.remove('is-dragging')
      drag = null
    }
    root.addEventListener('wheel', onWheel, { passive: false })
    root.addEventListener('pointerdown', onDown)
    root.addEventListener('pointermove', onMove)
    root.addEventListener('pointerup', onUp)
    root.addEventListener('pointercancel', onUp)
    return () => {
      root.removeEventListener('wheel', onWheel)
      root.removeEventListener('pointerdown', onDown)
      root.removeEventListener('pointermove', onMove)
      root.removeEventListener('pointerup', onUp)
      root.removeEventListener('pointercancel', onUp)
    }
  }, [content, onChange])
}

/** 図にマウスを乗せたときに右上に出す操作ボタン */
export function DiagramTools(props: { target: HTMLElement; scroller: HTMLElement; onChange(): void; onFullscreen(): void }) {
  const { target, scroller } = props
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)
  const zoom = getInlineZoom(target)

  useLayoutEffect(() => {
    const r = target.getBoundingClientRect()
    const s = scroller.getBoundingClientRect()
    setPos({ top: r.top - s.top + scroller.scrollTop + 6, left: r.right - s.left + scroller.scrollLeft - 6 })
  }, [target, scroller, zoom])

  if (!pos || !target.isConnected) return null
  const zoomBy = (f: number) => {
    setInlineZoom(target, zoom * f)
    props.onChange()
  }
  return (
    <div className="diagram-tools" style={{ top: pos.top, left: pos.left }} onMouseDown={(e) => e.stopPropagation()}>
      <button onClick={() => zoomBy(1 / STEP)} title="縮小（Ctrl+ホイール）" aria-label="縮小">
        −
      </button>
      <button
        className="diagram-tools-pct"
        onClick={() => {
          setInlineZoom(target, 1)
          props.onChange()
        }}
        title="等倍に戻す"
      >
        {Math.round(zoom * 100)}%
      </button>
      <button onClick={() => zoomBy(STEP)} title="拡大（Ctrl+ホイール）" aria-label="拡大">
        ＋
      </button>
      <button onClick={props.onFullscreen} title="全画面で表示（ダブルクリックでも可）" aria-label="全画面で表示">
        ⤢
      </button>
    </div>
  )
}

/* ---------------- 全画面ビューアー ---------------- */

export function MermaidViewer({ source, onClose }: { source: HTMLElement; onClose(): void }) {
  const stageRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLDivElement>(null)
  const sizeRef = useRef({ w: 0, h: 0 })
  const [view, setView] = useState({ s: 1, x: 0, y: 0 })
  const viewRef = useRef(view)
  viewRef.current = view

  const fit = useCallback(() => {
    const stage = stageRef.current!.getBoundingClientRect()
    const { w, h } = sizeRef.current
    const s = clamp(Math.min(stage.width / w, stage.height / h) * 0.92)
    setView({ s, x: (stage.width - w * s) / 2, y: (stage.height - h * s) / 2 })
  }, [])

  /** ステージ上の点 (cx, cy) を固定したまま拡大率を変える */
  const zoomAt = useCallback((factor: number, cx?: number, cy?: number) => {
    const stage = stageRef.current!.getBoundingClientRect()
    const px = cx ?? stage.width / 2
    const py = cy ?? stage.height / 2
    setView((v) => {
      const s = clamp(v.s * factor)
      const r = s / v.s
      return { s, x: px - (px - v.x) * r, y: py - (py - v.y) * r }
    })
  }, [])

  // 元の図（描画済みの SVG）を複製して、元の大きさ（viewBox）で配置する
  useLayoutEffect(() => {
    const svg = source.querySelector(':scope > svg')!.cloneNode(true) as SVGSVGElement
    const vb = svg.viewBox.baseVal
    const rect = source.querySelector(':scope > svg')!.getBoundingClientRect()
    const w = vb?.width || rect.width
    const h = vb?.height || rect.height
    sizeRef.current = { w, h }
    svg.removeAttribute('width')
    svg.removeAttribute('height')
    svg.style.cssText = `width:${w}px;height:${h}px;max-width:none;display:block`
    canvasRef.current!.replaceChildren(svg)
    fit()
  }, [source, fit])

  useEffect(() => {
    const stage = stageRef.current!
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const r = stage.getBoundingClientRect()
      const factor = Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : e.ctrlKey ? 0.01 : 0.002))
      zoomAt(factor, e.clientX - r.left, e.clientY - r.top)
    }
    stage.addEventListener('wheel', onWheel, { passive: false })
    const onKey = (e: KeyboardEvent) => {
      const k = e.key
      if (k === 'Escape') onClose()
      else if (k === '+' || k === '=' || k === ';') zoomAt(STEP)
      else if (k === '-') zoomAt(1 / STEP)
      else if (k === '0') fit()
      else if (k.startsWith('Arrow')) {
        const d = 60
        setView((v) => ({
          ...v,
          x: v.x + (k === 'ArrowLeft' ? d : k === 'ArrowRight' ? -d : 0),
          y: v.y + (k === 'ArrowUp' ? d : k === 'ArrowDown' ? -d : 0),
        }))
      } else return
      e.preventDefault()
      e.stopPropagation()
    }
    window.addEventListener('keydown', onKey, true)
    window.addEventListener('resize', fit)
    return () => {
      stage.removeEventListener('wheel', onWheel)
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('resize', fit)
    }
  }, [fit, onClose, zoomAt])

  const dragRef = useRef<{ x: number; y: number; vx: number; vy: number } | null>(null)

  return (
    <div className="mermaid-viewer" role="dialog" aria-label="図の拡大表示">
      <div className="mermaid-viewer-bar">
        <span className="mermaid-viewer-hint">ホイールで拡大縮小・ドラッグで移動・0 で全体表示・Esc で閉じる</span>
        <button className="btn" onClick={() => zoomAt(1 / STEP)} aria-label="縮小">
          −
        </button>
        <button className="btn mermaid-viewer-pct" onClick={() => setView((v) => ({ ...v, s: 1 }))} title="100% にする">
          {Math.round(view.s * 100)}%
        </button>
        <button className="btn" onClick={() => zoomAt(STEP)} aria-label="拡大">
          ＋
        </button>
        <button className="btn" onClick={fit} title="全体を表示 (0)">
          全体
        </button>
        <button className="btn" onClick={onClose} title="閉じる (Esc)">
          ✕ 閉じる
        </button>
      </div>
      <div
        className="mermaid-viewer-stage"
        ref={stageRef}
        onPointerDown={(e) => {
          if (e.button !== 0) return
          dragRef.current = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y }
          e.currentTarget.setPointerCapture(e.pointerId)
          e.currentTarget.classList.add('is-dragging')
        }}
        onPointerMove={(e) => {
          const d = dragRef.current
          if (d) setView((v) => ({ ...v, x: d.vx + e.clientX - d.x, y: d.vy + e.clientY - d.y }))
        }}
        onPointerUp={(e) => {
          dragRef.current = null
          e.currentTarget.classList.remove('is-dragging')
        }}
        onDoubleClick={fit}
      >
        <div
          className="mermaid-viewer-canvas"
          ref={canvasRef}
          style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.s})` }}
        />
      </div>
    </div>
  )
}
