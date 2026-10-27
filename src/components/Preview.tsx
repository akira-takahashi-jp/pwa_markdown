import { forwardRef, useCallback, useEffect, useImperativeHandle, useReducer, useRef, useState } from 'react'
import { patchBlocks } from '../lib/blocks'
import { renderMarkdown, type Heading } from '../lib/markdown'
import { hydrateMermaid, type Hydration } from '../lib/mermaid'
import { DiagramTools, MermaidViewer, useInlineDiagramZoom, zoomableDiagram } from './MermaidZoom'
import { collectAnchors, lineToTop, topToLine, type Anchor, type PreviewHandle } from '../lib/scrollSync'

interface Props {
  src: string
  /** テーマが変わったら mermaid を描き直す */
  themeKey: string
  onHeadings(headings: Heading[]): void
  onScroll(): void
  onUserInteract(): void
  onRendered?(): void
}

export const Preview = forwardRef<PreviewHandle, Props>(function Preview(props, ref) {
  const scrollerRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const anchorsRef = useRef<Anchor[] | null>(null)
  const hydrationRef = useRef<Hydration | null>(null)
  const seqRef = useRef(0)
  const themeRef = useRef(props.themeKey)
  const propsRef = useRef(props)
  propsRef.current = props
  /** マウスが乗っている mermaid の図（拡大縮小ボタンを出す） */
  const [hovered, setHovered] = useState<HTMLElement | null>(null)
  const [viewerSource, setViewerSource] = useState<HTMLElement | null>(null)
  const [, rerender] = useReducer((n: number) => n + 1, 0)
  const onZoomChange = useCallback(() => {
    anchorsRef.current = null
    rerender()
  }, [])
  useInlineDiagramZoom(contentRef, onZoomChange)

  useEffect(() => {
    const seq = ++seqRef.current
    let cancelled = false
    renderMarkdown(props.src)
      .then((r) => {
        const content = contentRef.current
        // アンマウント後（スライドモードへの切り替え時など）に解決した描画は捨てる
        if (cancelled || seq !== seqRef.current || !content) return
        hydrationRef.current?.disconnect()
        // テーマが変わったら図を描き直すため、ブロックを作り直す
        if (themeRef.current !== props.themeKey) {
          content.replaceChildren()
          themeRef.current = props.themeKey
        }
        patchBlocks(content, r.blocks)
        anchorsRef.current = null
        // mermaid はキャッシュ済みなら即時、それ以外は画面に近づいたときに描画する
        hydrationRef.current = hydrateMermaid(content, { lazy: true, scrollRoot: scrollerRef.current })
        propsRef.current.onHeadings(r.headings)
        propsRef.current.onRendered?.()
      })
      .catch((e) => console.error('[preview] render failed', e))
    return () => {
      cancelled = true
    }
  }, [props.src, props.themeKey])

  useEffect(() => () => hydrationRef.current?.disconnect(), [])

  // 図の描画や画像読み込みで高さが変わったら対応表を作り直す
  useEffect(() => {
    const ro = new ResizeObserver(() => (anchorsRef.current = null))
    ro.observe(contentRef.current!)
    return () => ro.disconnect()
  }, [])

  const anchors = () => (anchorsRef.current ??= collectAnchors(scrollerRef.current!, contentRef.current!))

  useImperativeHandle(
    ref,
    () => ({
      getTopLine() {
        return topToLine(anchors(), scrollerRef.current!.scrollTop)
      },
      scrollToLine(line, atBottom) {
        const s = scrollerRef.current!
        s.scrollTop = atBottom ? s.scrollHeight : lineToTop(anchors(), line, s.scrollHeight)
      },
      isAtBottom() {
        const s = scrollerRef.current!
        return s.scrollTop + s.clientHeight >= s.scrollHeight - 4
      },
      jumpTo(target) {
        const el = typeof target === 'string' ? contentRef.current!.querySelector(`[id="${CSS.escape(target)}"]`) : null
        el?.scrollIntoView({ block: 'start' })
      },
      getRoot() {
        return contentRef.current
      },
    }),
    [],
  )

  const onClick = (e: React.MouseEvent) => {
    const a = (e.target as HTMLElement).closest('a')
    const href = a?.getAttribute('href')
    if (a && href?.startsWith('#')) {
      e.preventDefault()
      const id = decodeURIComponent(href.slice(1))
      contentRef.current!.querySelector(`[id="${CSS.escape(id)}"]`)?.scrollIntoView({ block: 'start' })
    }
  }

  const interact = () => propsRef.current.onUserInteract()

  const onMouseOver = (e: React.MouseEvent) => {
    if ((e.target as Element).closest('.diagram-tools')) return
    const ph = zoomableDiagram(e.target)
    if (ph !== hovered) setHovered(ph)
  }

  return (
    <div
      className="preview-scroller"
      ref={scrollerRef}
      onScroll={() => propsRef.current.onScroll()}
      onWheel={interact}
      onMouseDown={interact}
      onTouchStart={interact}
      onKeyDown={interact}
      tabIndex={-1}
      onMouseOver={onMouseOver}
      onMouseLeave={() => setHovered(null)}
    >
      <article
        className="markdown-body"
        ref={contentRef}
        onClick={onClick}
        onDoubleClick={(e) => {
          const ph = zoomableDiagram(e.target)
          if (ph) setViewerSource(ph)
        }}
      />
      {hovered?.isConnected && scrollerRef.current && (
        <DiagramTools
          target={hovered}
          scroller={scrollerRef.current}
          onChange={onZoomChange}
          onFullscreen={() => setViewerSource(hovered)}
        />
      )}
      {viewerSource && <MermaidViewer source={viewerSource} onClose={() => setViewerSource(null)} />}
    </div>
  )
})
