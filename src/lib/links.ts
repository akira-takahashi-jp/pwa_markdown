import { slugify } from './markdown'

const EXTERNAL_RE = /^[a-z][a-z\d+.-]*:|^\/\//i

const decode = (v: string) => {
  try {
    return decodeURIComponent(v)
  } catch {
    return v
  }
}

/** 文書内の見出しなどへ移動する（id が見つからなければ見出しの書き方から作った id でも探す） */
export function scrollToFragment(root: HTMLElement, fragment: string): boolean {
  const id = decode(fragment)
  if (!id) return false
  const el = root.querySelector(`[id="${CSS.escape(id)}"]`) ?? root.querySelector(`[id="${CSS.escape(slugify(id))}"]`)
  el?.scrollIntoView({ block: 'start' })
  return !!el
}

/**
 * プレビュー内のリンクのクリックを処理する。
 * 外部リンク（https: や mailto: など）以外はブラウザに任せるとアプリ自体の URL へ遷移して
 * 読み込み直し（画面が先頭に戻る）になるため、すべてここで止める。
 * - #見出し → その見出しへ移動
 * - 相対パス（a.md、a.md#見出し）→ onOpenLink に渡す
 */
export function handlePreviewLinkClick(e: React.MouseEvent, root: HTMLElement, onOpenLink?: (href: string) => void) {
  const a = (e.target as HTMLElement).closest('a')
  if (!a || !root.contains(a) || !a.hasAttribute('href')) return
  const href = (a.getAttribute('href') ?? '').trim()
  if (EXTERNAL_RE.test(href)) return
  e.preventDefault()
  const hashAt = href.indexOf('#')
  const path = (hashAt < 0 ? href : href.slice(0, hashAt)).replace(/\?.*$/, '')
  if (path) onOpenLink?.(href)
  else if (hashAt >= 0) scrollToFragment(root, href.slice(hashAt + 1))
}
