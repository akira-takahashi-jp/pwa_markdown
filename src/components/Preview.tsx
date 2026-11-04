import { forwardRef, useCallback, useEffect, useImperativeHandle, useReducer, useRef, useState } from 'react'
import { patchBlocks } from '../lib/blocks'
import { renderMarkdown, type Heading } from '../lib/markdown'
import { hydrateMermaid, type Hydration } from '../lib/mermaid'
import { DiagramTools, MermaidViewer, useInlineDiagramZoom, zoomableDiagram } from './MermaidZoom'
import { isRelativeUrl } from '../lib/fs'
import { handlePreviewLinkClick } from '../lib/links'
import { collectAnchors, lineToTop, topToLine, type Anchor, type PreviewHandle } from '../lib/scrollSync'

interface Props {
  src: string
  /** テーマが変わったら mermaid を描き直す */
  themeKey: string
  onHeadings(headings: Heading[]): void
  onScroll(): void
  onUserInteract(): void
  onRendered?(): void
  /** 文書内の相対リンク（別の .md など）がクリックされた */
  onOpenLink?(href: string): void
  /** 相対パスの画像を読み込んで表示用の URL にする（読めなければ null） */
  resolveImage?(src: string): Promise<string | null>
  /** 相対パスの基準（文書の場所）。変わったら画像を読み直す */
  assetBase?: string
}

/**
 * 相対パスの画像を、開いているフォルダや GitHub から読み込んだものに差し替える。
 * 差し替えた画像は元のパスと基準を data 属性に残し、基準が変わったときだけ読み直す
 */
function resolveImages(root: HTMLElement, base: string, resolve: (src: string) => Promise<string | null>) {
  for (const img of root.querySelectorAll<HTMLImageElement>('img')) {
    const src = img.dataset.src ?? img.getAttribute('src') ?? ''
    if (!isRelativeUrl(src) || img.dataset.base === base) continue
    img.dataset.src = src
    img.dataset.base = base
    img.removeAttribute('src')
    void resolve(src)
      .then((url) => {
        if (url && img.dataset.base === base) img.src = url
      })
      .catch((e) => console.error('[preview] image load failed', src, e))
  }
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
        const { resolveImage, assetBase } = propsRef.current
        if (resolveImage) resolveImages(content, assetBase ?? '', resolveImage)
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

  // 文書の場所だけが変わった（同じ内容の別ファイルなど）ときも画像を読み直す
  useEffect(() => {
    const { resolveImage } = propsRef.current
    if (resolveImage && contentRef.current) resolveImages(contentRef.current, props.assetBase ?? '', resolveImage)
  }, [props.assetBase])

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

  const onClick = (e: React.MouseEvent) => handlePreviewLinkClick(e, contentRef.current!, propsRef.current.onOpenLink)

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
