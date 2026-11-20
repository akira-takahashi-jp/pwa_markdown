import { isRelativeUrl } from './fs'

export type ImageResolver = (src: string) => Promise<string | null>

const BG_URL = /url\(\s*(['"]?)(.*?)\1\s*\)/

/**
 * 相対パスの画像を、開いているフォルダや GitHub から読み込んだものに差し替える。
 * <img> に加え、Marp の背景画像（![bg](…) の style="background-image:url(…)"）も対象にする。
 * 差し替えた要素は元のパスと基準を data 属性に残し、基準が変わったときだけ読み直す
 */
export function resolveImages(root: HTMLElement, base: string, resolve: ImageResolver) {
  const load = (el: HTMLElement | SVGElement, src: string, apply: (url: string) => void) => {
    el.dataset.base = base
    void resolve(src)
      .then((url) => {
        if (url && el.dataset.base === base) apply(url)
      })
      .catch((e) => console.error('[preview] image load failed', src, e))
  }

  for (const img of root.querySelectorAll<HTMLImageElement>('img')) {
    const src = img.dataset.src ?? img.getAttribute('src') ?? ''
    if (!isRelativeUrl(src) || img.dataset.base === base) continue
    img.dataset.src = src
    img.removeAttribute('src')
    load(img, src, (url) => (img.src = url))
  }

  for (const el of root.querySelectorAll<HTMLElement>('[style*="url("], [data-bg-src]')) {
    const src = el.dataset.bgSrc ?? BG_URL.exec(el.style.backgroundImage)?.[2] ?? ''
    if (!isRelativeUrl(src) || el.dataset.base === base) continue
    el.dataset.bgSrc = src
    el.style.backgroundImage = 'none'
    load(el, src, (url) => (el.style.backgroundImage = `url("${url}")`))
  }
}
