// marp-core は MathJax を同梱しているが、このアプリでは KaTeX のみを使うため空のモジュールに差し替える（約 2MB 削減）
const unavailable = () => {
  throw new Error('MathJax は無効化されています（math: katex を使用してください）')
}
export const liteAdaptor = unavailable
export const RegisterHTMLHandler = unavailable
export const TeX = unavailable
export const SVG = unavailable
export const AllPackages: string[] = []
export const mathjax = { document: unavailable }
export default {}
