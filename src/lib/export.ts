import previewCss from '../styles/preview.css?inline'
import { saveBlobAs } from './fs'
import { containsMath, katexCssText } from './markdown'
import { exportMarpHtml } from './marp'
import { renderAllMermaid } from './mermaid'

function baseName(name: string) {
  return name.replace(/\.(md|markdown|mdown|mkd)$/i, '') || 'untitled'
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(r.result as string)
    r.onerror = () => reject(r.error)
    r.readAsDataURL(blob)
  })
}

/** KaTeX の CSS を、woff2 フォントを data URI で埋め込んだ単体 CSS にする */
async function inlinedKatexCss(): Promise<string> {
  let css = await katexCssText()
  // woff / ttf のフォールバックは落とし、woff2 だけ残す
  css = css.replace(/,\s*url\([^)]+\.(?:woff|ttf)\)\s*format\(["'](?:woff|truetype)["']\)/g, '')
  const urls = [...new Set([...css.matchAll(/url\(["']?([^)"']+\.woff2)["']?\)/g)].map((m) => m[1]))]
  const map = new Map<string, string>()
  await Promise.all(
    urls.map(async (u) => {
      try {
        const res = await fetch(new URL(u, location.href))
        map.set(u, await blobToDataUrl(await res.blob()))
      } catch {
        /* 取得できなければ元の URL のまま */
      }
    }),
  )
  return css.replace(/url\(["']?([^)"']+\.woff2)["']?\)/g, (all, u: string) => (map.has(u) ? `url(${map.get(u)})` : all))
}

/** プレビューの内容をスタイル込みの単一 HTML として保存する */
export async function exportHtml(opts: { previewEl: HTMLElement; src: string; fileName: string; theme: 'light' | 'dark' }) {
  await renderAllMermaid(opts.previewEl)
  const clone = opts.previewEl.cloneNode(true) as HTMLElement
  // プレビューで拡大中の図は等倍に戻して書き出す
  clone.querySelectorAll<HTMLElement>('.mermaid-ph.is-zoomed').forEach((ph) => {
    ph.classList.remove('is-zoomed')
    ph.removeAttribute('data-zoom')
    ph.removeAttribute('data-fitw')
    const svg = ph.querySelector<SVGSVGElement>(':scope > svg')
    svg?.style.removeProperty('width')
    svg?.style.removeProperty('max-width')
  })
  clone.querySelectorAll('.md-block').forEach((el) => {
    el.removeAttribute('data-source-line')
    el.removeAttribute('data-h')
  })
  const math = containsMath(opts.src) ? await inlinedKatexCss() : ''
  const title = baseName(opts.fileName)
  const html = `<!DOCTYPE html>
<html lang="ja" data-theme="${opts.theme}">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title.replace(/</g, '&lt;')}</title>
<style>${math}</style>
<style>${previewCss}</style>
<style>
body { margin: 0; background: var(--md-bg); }
.markdown-body { max-width: 900px; margin: 0 auto; padding: 32px 24px 64px; }
</style>
</head>
<body>
<article class="markdown-body">
${clone.innerHTML}
</article>
</body>
</html>`
  return saveBlobAs(new Blob([html], { type: 'text/html;charset=utf-8' }), `${title}.html`, 'HTML', {
    'text/html': ['.html'],
  })
}

/** Marp スライドを marp-core の出力そのままの単一 HTML として保存する */
export async function exportMarp(opts: { src: string; fileName: string }) {
  const title = baseName(opts.fileName)
  const html = await exportMarpHtml(opts.src, title)
  return saveBlobAs(new Blob([html], { type: 'text/html;charset=utf-8' }), `${title}.slides.html`, 'HTML', {
    'text/html': ['.html'],
  })
}

/**
 * window.print で PDF 出力する。Marp モードでは 1 スライド 1 ページになるよう
 * スライドサイズに合わせた @page を一時的に差し込む。
 */
export async function printDocument(opts: { root: HTMLElement; marp: boolean; fileName: string }) {
  await renderAllMermaid(opts.root)
  const style = document.createElement('style')
  if (opts.marp) {
    const svg = opts.root.querySelector<SVGSVGElement>('svg[data-marpit-svg]')
    const vb = svg?.viewBox.baseVal
    const w = vb?.width || 1280
    const h = vb?.height || 720
    style.textContent = `@page { size: ${w}px ${h}px; margin: 0; }`
  } else {
    style.textContent = '@page { size: A4; margin: 16mm 14mm; }'
  }
  document.head.appendChild(style)
  document.documentElement.classList.add(opts.marp ? 'printing-marp' : 'printing-md')
  const prevTitle = document.title
  document.title = baseName(opts.fileName)
  const cleanup = () => {
    style.remove()
    document.documentElement.classList.remove('printing-marp', 'printing-md')
    document.title = prevTitle
  }
  window.addEventListener('afterprint', cleanup, { once: true })
  // レイアウト確定を待ってから印刷
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
  window.print()
}
