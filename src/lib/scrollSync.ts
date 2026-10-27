export interface PreviewHandle {
  getTopLine(): number
  scrollToLine(line: number, atBottom?: boolean): void
  isAtBottom(): boolean
  /** 見出し・スライドへジャンプ */
  jumpTo(target: string | number): void
  /** 印刷・エクスポート対象のルート要素 */
  getRoot(): HTMLElement | null
}

export interface Anchor {
  line: number
  top: number
}

/** [data-source-line] 要素から「行 → スクロール位置」の対応表を作る */
export function collectAnchors(scroller: HTMLElement, content: HTMLElement): Anchor[] {
  const base = scroller.getBoundingClientRect().top - scroller.scrollTop
  const list: Anchor[] = [{ line: 1, top: 0 }]
  for (const el of content.querySelectorAll<HTMLElement>('[data-source-line]')) {
    const line = Number(el.dataset.sourceLine)
    // .md-block は display: contents なので最初の子要素の位置を使う
    const r = (el.firstElementChild ?? el).getBoundingClientRect()
    if (r.height === 0 && r.width === 0) continue
    list.push({ line, top: r.top - base })
  }
  list.sort((a, b) => a.line - b.line || a.top - b.top)
  // 行も位置も単調増加になるように間引く
  const out: Anchor[] = []
  for (const a of list) {
    const last = out[out.length - 1]
    if (last && (a.line <= last.line || a.top < last.top)) continue
    out.push(a)
  }
  return out
}

export function lineToTop(anchors: Anchor[], line: number, maxTop: number): number {
  let i = 0
  while (i + 1 < anchors.length && anchors[i + 1].line <= line) i++
  const a = anchors[i]
  const b = anchors[i + 1] ?? { line: Number.MAX_SAFE_INTEGER, top: maxTop }
  if (b.line === Number.MAX_SAFE_INTEGER) return a.top
  return a.top + ((line - a.line) / (b.line - a.line)) * (b.top - a.top)
}

export function topToLine(anchors: Anchor[], top: number): number {
  let i = 0
  while (i + 1 < anchors.length && anchors[i + 1].top <= top) i++
  const a = anchors[i]
  const b = anchors[i + 1]
  if (!b) return a.line
  return a.line + ((top - a.top) / Math.max(1, b.top - a.top)) * (b.line - a.line)
}
