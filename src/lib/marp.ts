import type { Marp, MarpOptions } from '@marp-team/marp-core'
import type { MarkdownIt } from 'markdown-it'
import { parseFrontMatter } from './frontmatter'
import { containsMath } from './markdown'
import { inlineMermaid, mermaidPlaceholder } from './mermaid'
import { sanitizeMarp } from './sanitize'

export interface MarpResult {
  html: string
  css: string
  slideCount: number
}

type MarpModule = typeof import('@marp-team/marp-core')
type BrowserModule = typeof import('@marp-team/marp-core/browser')

let marpModule: Promise<MarpModule> | null = null
let browserModule: Promise<BrowserModule> | null = null
let katexCss: Promise<unknown> | null = null

function loadMarp() {
  marpModule ??= import('@marp-team/marp-core')
  return marpModule
}

export function loadMarpBrowser() {
  browserModule ??= import('@marp-team/marp-core/browser')
  return browserModule
}

/** ```mermaid をプレースホルダにし、描画後に SVG へ差し替える */
function mermaidPlugin(md: MarkdownIt) {
  const orig = md.renderer.rules.fence!
  md.renderer.rules.fence = (tokens, idx, opts, env, self) => {
    const t = tokens[idx]
    if (t.info.trim().split(/\s+/)[0] === 'mermaid') return mermaidPlaceholder(t.content)
    return orig(tokens, idx, opts, env, self)
  }
}

function createMarp(mod: MarpModule, forExport: boolean): Marp {
  const opts: MarpOptions = forExport
    ? { html: true, math: 'katex' }
    : {
        html: true,
        // アプリ内はオフラインで描画できるよう、外部 CDN を参照しない設定にする
        script: false,
        math: { lib: 'katex', katexFontPath: false },
        emoji: { shortcode: true, unicode: false },
      }
  const marp = new mod.Marp(opts)
  marp.use(mermaidPlugin)
  return marp
}

let appMarp: Marp | null = null

export async function renderMarp(src: string): Promise<MarpResult> {
  const mod = await loadMarp()
  appMarp ??= createMarp(mod, false)
  if (containsMath(src)) {
    // KaTeX のフォント（@font-face）はアプリ側の katex.css から読み込む
    katexCss ??= import('katex/dist/katex.min.css')
    await katexCss
  }
  const { html, css: rawCss } = appMarp.render(src)
  // katexFontPath: false でも KaTeX の @font-face（相対パス fonts/…）が残り、アプリ側の katex.css の
  // フォント指定を上書きして 404 になるため取り除く
  const css = rawCss.replace(/@font-face\s*\{[^}]*KaTeX[^}]*\}/g, '')
  const slideCount = (html.match(/<svg[^>]*data-marpit-svg/g) ?? []).length
  return { html: sanitizeMarp(html), css, slideCount }
}

/** marp-core の出力をそのまま単一 HTML にする（mermaid は SVG を埋め込む） */
export async function exportMarpHtml(src: string, title: string): Promise<string> {
  const mod = await loadMarp()
  const marp = createMarp(mod, true)
  const { html, css } = marp.render(src)
  const body = await inlineMermaid(html, 'default')
  return `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title.replace(/</g, '&lt;')}</title>
<style>${css}</style>
<style>
html, body { margin: 0; background: #6b7280; }
div.marpit > svg[data-marpit-svg] { display: block; width: min(96vw, 1280px); height: auto; margin: 24px auto; box-shadow: 0 4px 16px rgba(0,0,0,.35); }
.mermaid-ph { display: flex; justify-content: center; }
.mermaid-ph svg { width: 100%; max-width: 100% !important; height: auto; max-height: 480px; }
.mermaid-ph { font-size: 16px; letter-spacing: normal; line-height: 1.5; text-align: initial; }
.mermaid-error { color: #b91c1c; font-size: .6em; }
.mermaid-src { display: none; }
@media print {
  html, body { background: none; }
  div.marpit > svg[data-marpit-svg] { width: 100vw; height: 100vh; margin: 0; box-shadow: none; break-after: page; }
}
</style>
</head>
<body>
${body}
</body>
</html>`
}

/**
 * スライドごとの開始行（1 始まり）。エディター ↔ スライドのスクロール同期に使う。
 * front-matter とコードフェンス内の `---` は区切りとして扱わない。
 */
export function slideStartLines(src: string): number[] {
  const lines = src.split('\n')
  const fm = parseFrontMatter(src)
  let i = fm ? fm.lines : 0
  const starts = [i + 1]
  let fence: string | null = null
  for (; i < lines.length; i++) {
    const l = lines[i]
    const fm2 = /^\s*(`{3,}|~{3,})/.exec(l)
    if (fm2) {
      if (!fence) fence = fm2[1][0]
      else if (fm2[1][0] === fence) fence = null
      continue
    }
    if (!fence && /^\s{0,3}---+\s*$/.test(l) && i > 0) starts.push(i + 2)
  }
  return starts
}
