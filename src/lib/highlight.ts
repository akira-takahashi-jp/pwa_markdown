import type { HighlighterCore, LanguageRegistration } from 'shiki/core'
import { escapeHtml, hash } from './hash'

type LangModule = { default: LanguageRegistration[] }

// バンドルとプリキャッシュを抑えるため、よく使う言語だけを遅延読み込みする
const LANGS: Record<string, () => Promise<LangModule>> = {
  javascript: () => import('@shikijs/langs/javascript'),
  typescript: () => import('@shikijs/langs/typescript'),
  jsx: () => import('@shikijs/langs/jsx'),
  tsx: () => import('@shikijs/langs/tsx'),
  json: () => import('@shikijs/langs/json'),
  jsonc: () => import('@shikijs/langs/jsonc'),
  html: () => import('@shikijs/langs/html'),
  css: () => import('@shikijs/langs/css'),
  scss: () => import('@shikijs/langs/scss'),
  vue: () => import('@shikijs/langs/vue'),
  bash: () => import('@shikijs/langs/bash'),
  powershell: () => import('@shikijs/langs/powershell'),
  python: () => import('@shikijs/langs/python'),
  go: () => import('@shikijs/langs/go'),
  rust: () => import('@shikijs/langs/rust'),
  java: () => import('@shikijs/langs/java'),
  kotlin: () => import('@shikijs/langs/kotlin'),
  swift: () => import('@shikijs/langs/swift'),
  c: () => import('@shikijs/langs/c'),
  cpp: () => import('@shikijs/langs/cpp'),
  csharp: () => import('@shikijs/langs/csharp'),
  php: () => import('@shikijs/langs/php'),
  ruby: () => import('@shikijs/langs/ruby'),
  sql: () => import('@shikijs/langs/sql'),
  yaml: () => import('@shikijs/langs/yaml'),
  toml: () => import('@shikijs/langs/toml'),
  ini: () => import('@shikijs/langs/ini'),
  xml: () => import('@shikijs/langs/xml'),
  markdown: () => import('@shikijs/langs/markdown'),
  diff: () => import('@shikijs/langs/diff'),
  docker: () => import('@shikijs/langs/docker'),
  graphql: () => import('@shikijs/langs/graphql'),
  lua: () => import('@shikijs/langs/lua'),
  dart: () => import('@shikijs/langs/dart'),
  scala: () => import('@shikijs/langs/scala'),
  r: () => import('@shikijs/langs/r'),
  nginx: () => import('@shikijs/langs/nginx'),
  makefile: () => import('@shikijs/langs/makefile'),
}

const ALIASES: Record<string, string> = {
  js: 'javascript', mjs: 'javascript', cjs: 'javascript', node: 'javascript',
  ts: 'typescript', mts: 'typescript', cts: 'typescript',
  sh: 'bash', shell: 'bash', zsh: 'bash', console: 'bash', shellscript: 'bash',
  ps: 'powershell', ps1: 'powershell', pwsh: 'powershell',
  py: 'python', rs: 'rust', golang: 'go', kt: 'kotlin', 'c++': 'cpp', cs: 'csharp', 'c#': 'csharp',
  rb: 'ruby', yml: 'yaml', md: 'markdown', dockerfile: 'docker', gql: 'graphql',
  htm: 'html', svg: 'xml', make: 'makefile', conf: 'nginx', json5: 'jsonc',
}

export function normalizeLang(lang: string): string | null {
  const l = lang.trim().toLowerCase()
  const name = ALIASES[l] ?? l
  return name in LANGS ? name : null
}

let highlighter: HighlighterCore | null = null
let highlighterPromise: Promise<HighlighterCore> | null = null
const loading = new Map<string, Promise<void>>()

function getHighlighter(): Promise<HighlighterCore> {
  highlighterPromise ??= (async () => {
    const [{ createHighlighterCore }, { createJavaScriptRegexEngine }] = await Promise.all([
      import('shiki/core'),
      import('shiki/engine/javascript'),
    ])
    highlighter = await createHighlighterCore({
      themes: [import('@shikijs/themes/github-light'), import('@shikijs/themes/github-dark')],
      langs: [],
      engine: createJavaScriptRegexEngine(),
    })
    return highlighter
  })()
  return highlighterPromise
}

/** 必要な言語を読み込む（読み込み済みなら即 resolve） */
export async function ensureLanguages(langs: Iterable<string>): Promise<boolean> {
  const names = [...new Set([...langs].map(normalizeLang).filter((x): x is string => !!x))]
  const missing = names.filter((n) => !highlighter?.getLoadedLanguages().includes(n))
  if (missing.length === 0) return false
  const hl = await getHighlighter()
  await Promise.all(
    missing.map((name) => {
      let p = loading.get(name)
      if (!p) {
        p = LANGS[name]()
          .then((m) => hl.loadLanguage(...m.default))
          .catch((e) => console.warn('[shiki] 言語の読み込みに失敗:', name, e))
        loading.set(name, p)
      }
      return p
    }),
  )
  return true
}

const cache = new Map<string, string>()
const CACHE_LIMIT = 2000

/** 同期ハイライト。言語未対応・未ロードならエスケープ済みの素の <pre> を返す */
export function highlightCode(code: string, lang: string): string {
  const name = normalizeLang(lang)
  if (highlighter && name && highlighter.getLoadedLanguages().includes(name)) {
    const key = name + ':' + hash(code)
    const hit = cache.get(key)
    if (hit) return hit
    const html = highlighter.codeToHtml(code, {
      lang: name,
      themes: { light: 'github-light', dark: 'github-dark' },
      defaultColor: false,
    })
    if (cache.size > CACHE_LIMIT) cache.clear()
    cache.set(key, html)
    return html
  }
  const cls = lang ? ` class="language-${escapeHtml(lang)}"` : ''
  return `<pre class="plain"><code${cls}>${escapeHtml(code)}</code></pre>`
}
