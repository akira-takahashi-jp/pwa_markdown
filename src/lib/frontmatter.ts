const FRONT_MATTER = /^---[ \t]*\r?\n([\s\S]*?)\r?\n(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/

export interface FrontMatter {
  /** front-matter の生テキスト（区切り線を除く） */
  raw: string
  /** front-matter 全体（区切り線を含む）の文字数 */
  length: number
  /** front-matter が占める行数 */
  lines: number
}

export function parseFrontMatter(src: string): FrontMatter | null {
  const m = FRONT_MATTER.exec(src)
  if (!m) return null
  return { raw: m[1], length: m[0].length, lines: m[0].split('\n').length - (m[0].endsWith('\n') ? 1 : 0) }
}

/** front-matter に `marp: true` があるか */
export function isMarp(src: string): boolean {
  const fm = parseFrontMatter(src)
  return !!fm && /^marp\s*:\s*true\s*$/m.test(fm.raw)
}

/** 行番号を保ったまま front-matter を空行に置き換える */
export function blankFrontMatter(src: string): string {
  const fm = parseFrontMatter(src)
  if (!fm) return src
  return '\n'.repeat(fm.lines) + src.slice(fm.length)
}
