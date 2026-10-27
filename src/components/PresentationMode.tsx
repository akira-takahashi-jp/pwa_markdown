import { useCallback, useEffect, useRef, useState } from 'react'

interface Props {
  /** スライドプレビューのルート（div.marpit を含む） */
  source: HTMLElement
  startIndex: number
  onClose(): void
}

export function PresentationMode({ source, startIndex, onClose }: Props) {
  const overlayRef = useRef<HTMLDivElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const [count, setCount] = useState(0)
  const [index, setIndex] = useState(Math.max(0, startIndex))

  // プレビューのスライド（mermaid 描画済み）を複製して使う
  useEffect(() => {
    const marpit = source.querySelector('div.marpit')
    const stage = stageRef.current!
    stage.innerHTML = ''
    if (marpit) {
      const clone = marpit.cloneNode(true) as HTMLElement
      stage.appendChild(clone)
      setCount(clone.querySelectorAll(':scope > svg[data-marpit-svg]').length)
    }
    const el = overlayRef.current!
    el.focus()
    el.requestFullscreen?.().catch(() => undefined)
    const onFs = () => {
      if (!document.fullscreenElement) onClose()
    }
    document.addEventListener('fullscreenchange', onFs)
    return () => {
      document.removeEventListener('fullscreenchange', onFs)
      if (document.fullscreenElement) document.exitFullscreen().catch(() => undefined)
    }
  }, [source, onClose])

  useEffect(() => {
    const svgs = stageRef.current!.querySelectorAll<SVGSVGElement>('div.marpit > svg[data-marpit-svg]')
    svgs.forEach((s, i) => s.classList.toggle('is-current', i === index))
  }, [index, count])

  const go = useCallback((d: number) => setIndex((i) => Math.min(Math.max(0, i + d), Math.max(0, count - 1))), [count])

  // フォーカス位置に関係なく操作できるよう window で受ける
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      switch (e.key) {
        case 'ArrowRight':
        case 'ArrowDown':
        case 'PageDown':
        case ' ':
        case 'Enter':
          go(1)
          break
        case 'ArrowLeft':
        case 'ArrowUp':
        case 'PageUp':
        case 'Backspace':
          go(-1)
          break
        case 'Home':
          setIndex(0)
          break
        case 'End':
          setIndex(count - 1)
          break
        case 'Escape':
          onClose()
          break
        default:
          return
      }
      e.preventDefault()
      e.stopPropagation()
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [count, go, onClose])

  return (
    <div
      className="presentation"
      ref={overlayRef}
      tabIndex={0}
      onClick={(e) => go(e.clientX < window.innerWidth / 4 ? -1 : 1)}
    >
      <div className="presentation-stage" ref={stageRef} />
      <div className="presentation-counter">
        {index + 1} / {count}
      </div>
    </div>
  )
}
