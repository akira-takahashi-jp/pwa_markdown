import type { Heading } from '../lib/markdown'
import type { SlideInfo } from './SlidePreview'

interface Props {
  marp: boolean
  headings: Heading[]
  slides: SlideInfo[]
  onHeading(h: Heading): void
  onSlide(index: number): void
}

export function TocSidebar({ marp, headings, slides, onHeading, onSlide }: Props) {
  if (marp) {
    if (slides.length === 0) return <p className="empty">スライドがありません</p>
    return (
      <ol className="toc toc-slides">
        {slides.map((s) => (
          <li key={s.index}>
            <button onClick={() => onSlide(s.index)}>
              <span className="toc-num">{s.index + 1}</span>
              {s.title}
            </button>
          </li>
        ))}
      </ol>
    )
  }
  if (headings.length === 0) return <p className="empty">見出しがありません</p>
  const min = Math.min(...headings.map((h) => h.level))
  return (
    <ul className="toc">
      {headings.map((h, i) => (
        <li key={i} style={{ paddingLeft: `${(h.level - min) * 12}px` }}>
          <button onClick={() => onHeading(h)} title={h.text}>
            {h.text || '(無題)'}
          </button>
        </li>
      ))}
    </ul>
  )
}
