import { hash } from './hash'
import type { Block } from './markdown'
import { sanitizePreview } from './sanitize'

const sanitized = new Map<string, string>()
const CACHE_LIMIT = 5000

function clean(html: string, key: string): string {
  let v = sanitized.get(key)
  if (v === undefined) {
    v = sanitizePreview(html)
    if (sanitized.size > CACHE_LIMIT) sanitized.clear()
    sanitized.set(key, v)
  }
  return v
}

/**
 * トップレベルのブロック単位で DOM を差分更新する。
 * 内容（HTML のハッシュ）が同じブロックは要素ごと使い回すため、
 * 大きな文書でも再サニタイズ・再レイアウトは変更箇所だけで済み、描画済みの mermaid 図も保たれる。
 */
export function patchBlocks(container: HTMLElement, blocks: Block[]): void {
  const pool = new Map<string, HTMLElement[]>()
  for (const el of [...container.children] as HTMLElement[]) {
    const k = el.dataset.h
    if (!k) {
      el.remove()
      continue
    }
    const list = pool.get(k)
    if (list) list.push(el)
    else pool.set(k, [el])
  }

  let cursor = container.firstElementChild as HTMLElement | null
  for (const b of blocks) {
    const k = hash(b.html)
    let el = pool.get(k)?.shift()
    if (!el) {
      el = document.createElement('div')
      el.className = 'md-block'
      el.dataset.h = k
      el.innerHTML = clean(b.html, k)
    }
    if (el.dataset.sourceLine !== String(b.line)) el.dataset.sourceLine = String(b.line)
    if (el !== cursor) container.insertBefore(el, cursor)
    else cursor = cursor.nextElementSibling as HTMLElement | null
  }
  for (const list of pool.values()) list.forEach((el) => el.remove())
}
