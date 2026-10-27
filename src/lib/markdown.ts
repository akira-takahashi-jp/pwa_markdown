import MarkdownIt, { type MarkdownIt as MD, type Token } from 'markdown-it'
import anchor from 'markdown-it-anchor'
import footnote from 'markdown-it-footnote'
import taskLists from 'markdown-it-task-lists'
import { blankFrontMatter } from './frontmatter'
import { ensureLanguages, highlightCode } from './highlight'
import { mermaidPlaceholder } from './mermaid'

export interface Heading {
  level: number
  text: string
  id: string
  /** 1 始まりのソース行 */
  line: number
}

export interface Block {
  html: string
  /** 1 始まりのソース行（スクロール同期用） */
  line: number
}

export interface RenderResult {
  /** トップレベルのブロックごとの HTML（差分更新用） */
  blocks: Block[]
  headings: Heading[]
  hasMermaid: boolean
}

export function slugify(s: string): string {
  return (
    s
      .trim()
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s_-]/gu, '')
      .replace(/\s+/g, '-') || 'section'
  )
}

/** 数式記法らしきものがあるか（KaTeX を読み込むかの判定） */
const MATH_RE = /\$\$[\s\S]+?\$\$|(^|[^\\$])\$[^\s$](?:[^$\n]*[^\s$])?\$/
const FENCE_LANG_RE = /^[ \t]*(?:```|~~~)[ \t]*([\w#+.-]+)/gm

let katexLoaded: Promise<void> | null = null
let mdBase: MD | null = null
let mdMath: MD | null = null
let katexEngine: unknown = null

function fencePlugin(md: MD) {
  md.renderer.rules.fence = (tokens, idx) => {
    const t = tokens[idx]
    const lang = t.info.trim().split(/\s+/)[0] ?? ''
    if (lang === 'mermaid') return mermaidPlaceholder(t.content)
    return `<div class="code-block">${highlightCode(t.content, lang)}</div>`
  }
}

function linkPlugin(md: MD) {
  // 外部リンクは新しいタブで開く
  const orig = md.renderer.rules.link_open ?? ((tokens, idx, opts, _env, self) => self.renderToken(tokens, idx, opts))
  md.renderer.rules.link_open = (tokens, idx, opts, env, self) => {
    const href = String(tokens[idx].attrGet('href') ?? '')
    if (/^https?:/i.test(href)) {
      tokens[idx].attrSet('target', '_blank')
      tokens[idx].attrSet('rel', 'noopener noreferrer')
    }
    return orig(tokens, idx, opts, env, self)
  }
}

function create(): MD {
  const md = new MarkdownIt({ html: true, linkify: true, typographer: false, breaks: false })
  md.use(anchor, { slugify, tabIndex: false })
  md.use(taskLists, { enabled: false, label: true })
  md.use(footnote)
  fencePlugin(md)
  linkPlugin(md)
  return md
}

async function loadMath(): Promise<void> {
  katexLoaded ??= (async () => {
    const [katex, texmath] = await Promise.all([
      import('katex'),
      import('markdown-it-texmath'),
      import('katex/dist/katex.min.css'),
    ])
    katexEngine = katex.default
    mdMath = create()
    mdMath.use(texmath.default, {
      engine: katexEngine,
      delimiters: 'dollars',
      katexOptions: { throwOnError: false, output: 'htmlAndMathml' },
    })
  })()
  return katexLoaded
}

function getBase(): MD {
  mdBase ??= create()
  return mdBase
}

export function containsMath(src: string): boolean {
  return MATH_RE.test(src)
}

export function fenceLanguages(src: string): Set<string> {
  const langs = new Set<string>()
  for (const m of src.matchAll(FENCE_LANG_RE)) langs.add(m[1])
  return langs
}

/** 必要なライブラリ（KaTeX・Shiki 言語）を読み込む */
export async function prepareMarkdown(src: string): Promise<void> {
  const tasks: Promise<unknown>[] = [ensureLanguages(fenceLanguages(src))]
  if (containsMath(src)) tasks.push(loadMath())
  await Promise.all(tasks)
}

function inlineText(t: Token | undefined): string {
  if (!t?.children) return t?.content ?? ''
  return t.children
    .filter((c) => c.type === 'text' || c.type === 'code_inline' || c.type === 'math_inline')
    .map((c) => c.content)
    .join('')
}

/** 同期レンダリング（prepareMarkdown 済みを前提に、未ロードの機能は素通しで描画） */
export function renderMarkdownSync(src: string): RenderResult {
  const md = mdMath && containsMath(src) ? mdMath : getBase()
  const env = {}
  const tokens = md.parse(blankFrontMatter(src), env)
  const headings: Heading[] = []
  let hasMermaid = false
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]
    if (t.type === 'heading_open' && t.map) {
      headings.push({
        level: Number(t.tag.slice(1)),
        text: inlineText(tokens[i + 1]),
        id: String(t.attrGet('id') ?? ''),
        line: t.map[0] + 1,
      })
    } else if (t.type === 'fence' && t.info.trim().startsWith('mermaid')) {
      hasMermaid = true
    }
  }
  // トップレベルのブロック単位に分けて描画する（変更のないブロックは DOM を使い回せる）
  const blocks: Block[] = []
  let begin = 0
  let depth = 0
  for (let i = 0; i < tokens.length; i++) {
    depth += tokens[i].nesting
    if (depth !== 0) continue
    const group = tokens.slice(begin, i + 1)
    const first = group.find((g) => g.map)
    blocks.push({ html: md.renderer.render(group, md.options, env), line: first?.map ? first.map[0] + 1 : 1 })
    begin = i + 1
  }
  return { blocks, headings, hasMermaid }
}

export async function renderMarkdown(src: string): Promise<RenderResult> {
  await prepareMarkdown(src)
  return renderMarkdownSync(src)
}

/** エクスポート用に KaTeX の CSS 文字列を取得する（数式がある場合のみ） */
export async function katexCssText(): Promise<string> {
  const css = await import('katex/dist/katex.min.css?inline')
  return css.default
}
