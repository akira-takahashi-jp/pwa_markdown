import type { Mermaid } from 'mermaid'
import { escapeHtml, hash } from './hash'
import { sanitizeSvg } from './sanitize'

export type MermaidTheme = 'default' | 'dark'

type Result = { svg: string } | { error: string }

/** hash → コード。markdown のレンダリング時に登録される */
const registry = new Map<string, string>()
/** `${theme}:${hash}` → 描画結果 */
const cache = new Map<string, Result>()
const CACHE_LIMIT = 500

const FONT_FAMILY = "system-ui, -apple-system, 'Segoe UI', 'Hiragino Sans', 'Noto Sans JP', Meiryo, sans-serif"

let mermaidPromise: Promise<Mermaid> | null = null
let currentTheme: MermaidTheme = 'default'
let initializedTheme: MermaidTheme | null = null
let queue: Promise<unknown> = Promise.resolve()
let seq = 0

export function registerMermaid(code: string): string {
  const h = hash(code)
  registry.set(h, code)
  return h
}

/** mermaid フェンスの placeholder（後で SVG に置き換える） */
export function mermaidPlaceholder(code: string): string {
  const h = registerMermaid(code)
  return `<div class="mermaid-ph" data-mermaid="${h}"><pre class="mermaid-src">${escapeHtml(code)}</pre></div>`
}

export function setMermaidTheme(theme: MermaidTheme) {
  currentTheme = theme
}

function loadMermaid(): Promise<Mermaid> {
  mermaidPromise ??= import('mermaid').then((m) => m.default)
  return mermaidPromise
}

/** 1 つずつ順番に描画する（mermaid は並列描画に弱いため） */
function enqueue<T>(fn: () => Promise<T>): Promise<T> {
  const p = queue.then(fn, fn)
  queue = p.catch(() => undefined)
  return p
}

async function render(h: string, theme: MermaidTheme): Promise<Result> {
  const key = `${theme}:${h}`
  const hit = cache.get(key)
  if (hit) return hit
  const code = registry.get(h)
  if (code == null) return { error: '図のソースが見つかりません' }

  return enqueue(async () => {
    const again = cache.get(key)
    if (again) return again
    const mermaid = await loadMermaid()
    if (initializedTheme !== theme) {
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: 'strict',
        theme,
        // 計測時と表示時でフォントが変わるとラベルが切れるため、具体的なフォントを指定する
        fontFamily: FONT_FAMILY,
      })
      initializedTheme = theme
    }
    const id = `mmd-${h}-${++seq}`
    let result: Result
    try {
      const { svg } = await mermaid.render(id, code)
      result = { svg: sanitizeSvg(svg) }
    } catch (e) {
      result = { error: e instanceof Error ? e.message : String(e) }
      // エラー時に mermaid が body に残す一時要素を掃除
      document.getElementById(id)?.remove()
      document.getElementById('d' + id)?.remove()
    }
    if (cache.size > CACHE_LIMIT) cache.clear()
    cache.set(key, result)
    return result
  })
}

function apply(el: HTMLElement, result: Result) {
  if ('svg' in result) {
    el.innerHTML = result.svg
    el.classList.remove('is-error')
  } else {
    el.innerHTML = `<div class="mermaid-error"><strong>Mermaid 構文エラー</strong><pre>${escapeHtml(result.error)}</pre></div>`
    el.classList.add('is-error')
  }
  el.dataset.state = 'done'
}

async function fill(el: HTMLElement, theme: MermaidTheme) {
  const h = el.dataset.mermaid!
  el.dataset.state = 'pending'
  const result = await render(h, theme)
  // 描画中に DOM が差し替えられていたら何もしない
  if (el.isConnected && el.dataset.mermaid === h) apply(el, result)
}

export interface Hydration {
  disconnect(): void
}

/**
 * root 内の placeholder を SVG に置き換える。
 * キャッシュ済みは即時に、それ以外は lazy なら画面に近づいたときに描画する。
 */
export function hydrateMermaid(root: HTMLElement, opts: { lazy?: boolean; scrollRoot?: Element | null } = {}): Hydration {
  const theme = currentTheme
  const els = [...root.querySelectorAll<HTMLElement>('.mermaid-ph[data-mermaid]:not([data-state])')]
  const rest: HTMLElement[] = []
  for (const el of els) {
    const hit = cache.get(`${theme}:${el.dataset.mermaid}`)
    if (hit) apply(el, hit)
    else rest.push(el)
  }
  if (rest.length === 0) return { disconnect() {} }

  if (!opts.lazy || !('IntersectionObserver' in window)) {
    rest.forEach((el) => void fill(el, theme))
    return { disconnect() {} }
  }
  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue
        io.unobserve(e.target)
        void fill(e.target as HTMLElement, theme)
      }
    },
    { root: opts.scrollRoot ?? null, rootMargin: '800px 0px' },
  )
  rest.forEach((el) => io.observe(el))
  return { disconnect: () => io.disconnect() }
}

/** エクスポート・印刷前にすべての図を描画しきる */
export async function renderAllMermaid(root: ParentNode, theme: MermaidTheme = currentTheme): Promise<void> {
  const els = [...root.querySelectorAll<HTMLElement>('.mermaid-ph[data-mermaid]')].filter(
    (el) => el.dataset.state !== 'done',
  )
  await Promise.all(els.map((el) => fill(el, theme)))
}

/** HTML 文字列中の placeholder を SVG に置き換えた文字列を返す（エクスポート用） */
export async function inlineMermaid(html: string, theme: MermaidTheme = currentTheme): Promise<string> {
  const tpl = document.createElement('template')
  tpl.innerHTML = html
  const els = [...tpl.content.querySelectorAll<HTMLElement>('.mermaid-ph[data-mermaid]')]
  for (const el of els) apply(el, await render(el.dataset.mermaid!, theme))
  return tpl.innerHTML
}
