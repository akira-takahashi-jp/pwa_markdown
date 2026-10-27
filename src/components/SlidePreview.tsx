import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { loadMarpBrowser, renderMarp, slideStartLines } from '../lib/marp'
import { renderAllMermaid } from '../lib/mermaid'
import type { PreviewHandle } from '../lib/scrollSync'

export interface SlideInfo {
  index: number
  title: string
}

interface Props {
  src: string
  themeKey: string
  onSlides(slides: SlideInfo[]): void
  onScroll(): void
  onUserInteract(): void
  onPresent(index: number): void
}

export const SlidePreview = forwardRef<PreviewHandle, Props>(function SlidePreview(props, ref) {
  const scrollerRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const startsRef = useRef<number[]>([1])
  const seqRef = useRef(0)
  const propsRef = useRef(props)
  propsRef.current = props
  const [css, setCss] = useState('')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const seq = ++seqRef.current
    let cleanupBrowser: (() => void) | undefined
    ;(async () => {
      try {
        const [r, { browser }] = await Promise.all([renderMarp(props.src), loadMarpBrowser()])
        const content = contentRef.current
        if (seq !== seqRef.current || !content) return
        setCss(r.css)
        setError(null)
        content.innerHTML = r.html
        startsRef.current = slideStartLines(props.src)
        // marp-core のカスタム要素（自動スケーリング等）を適用
        cleanupBrowser = browser(content)
        // スライドは背景色がテーマで決まるため、図はアプリのテーマに関係なくライト配色で描く
        await renderAllMermaid(content, 'default')
        if (seq !== seqRef.current || !content.isConnected) return
        const slides = [...content.querySelectorAll('section')].filter((s) => s.parentElement?.tagName.toLowerCase() === 'foreignobject')
        propsRef.current.onSlides(
          slides.map((s, i) => ({
            index: i,
            title: s.querySelector('h1,h2,h3,h4,h5,h6')?.textContent?.trim() || `スライド ${i + 1}`,
          })),
        )
      } catch (e) {
        console.error('[marp] render failed', e)
        if (seq === seqRef.current) setError(e instanceof Error ? e.message : String(e))
      }
    })()
    return () => {
      // 次の描画・アンマウントで古い結果を捨てる
      seqRef.current++
      cleanupBrowser?.()
    }
  }, [props.src, props.themeKey])

  const slideEls = () => [...contentRef.current!.querySelectorAll<SVGSVGElement>(':scope > div.marpit > svg[data-marpit-svg]')]

  const slideTop = (el: Element) =>
    el.getBoundingClientRect().top - scrollerRef.current!.getBoundingClientRect().top + scrollerRef.current!.scrollTop

  useImperativeHandle(
    ref,
    () => ({
      getTopLine() {
        const s = scrollerRef.current!
        const els = slideEls()
        const starts = startsRef.current
        let i = 0
        while (i + 1 < els.length && slideTop(els[i + 1]) <= s.scrollTop) i++
        if (!els[i]) return 1
        const t0 = slideTop(els[i])
        const t1 = els[i + 1] ? slideTop(els[i + 1]) : s.scrollHeight
        const l0 = starts[i] ?? 1
        const l1 = starts[i + 1] ?? l0 + 1
        return l0 + ((s.scrollTop - t0) / Math.max(1, t1 - t0)) * (l1 - l0)
      },
      scrollToLine(line, atBottom) {
        const s = scrollerRef.current!
        if (atBottom) {
          s.scrollTop = s.scrollHeight
          return
        }
        const els = slideEls()
        const starts = startsRef.current
        let i = 0
        while (i + 1 < starts.length && starts[i + 1] <= line) i++
        if (!els[i]) return
        const t0 = slideTop(els[i])
        const t1 = els[i + 1] ? slideTop(els[i + 1]) : t0 + els[i].getBoundingClientRect().height
        const l0 = starts[i]
        const l1 = starts[i + 1] ?? l0 + 1
        s.scrollTop = t0 + Math.min(1, (line - l0) / Math.max(1, l1 - l0)) * (t1 - t0)
      },
      isAtBottom() {
        const s = scrollerRef.current!
        return s.scrollTop + s.clientHeight >= s.scrollHeight - 4
      },
      jumpTo(target) {
        if (typeof target === 'number') slideEls()[target]?.scrollIntoView({ block: 'start' })
      },
      getRoot() {
        return contentRef.current
      },
    }),
    [],
  )

  const onDoubleClick = (e: React.MouseEvent) => {
    const svg = (e.target as Element).closest('svg[data-marpit-svg]')
    if (svg) propsRef.current.onPresent(slideEls().indexOf(svg as SVGSVGElement))
  }

  const interact = () => propsRef.current.onUserInteract()

  return (
    <div
      className="preview-scroller slides-scroller"
      ref={scrollerRef}
      onScroll={() => propsRef.current.onScroll()}
      onWheel={interact}
      onMouseDown={interact}
      onTouchStart={interact}
      tabIndex={-1}
    >
      <style>{css}</style>
      {error && <div className="slides-error">Marp の描画に失敗しました: {error}</div>}
      <div className="slides" ref={contentRef} onDoubleClick={onDoubleClick} title="ダブルクリックでこのスライドから発表" />
    </div>
  )
})
