import DOMPurify from 'dompurify'

/** Markdown プレビュー（KaTeX の MathML、Shiki のインラインスタイルを許可） */
export function sanitizePreview(html: string): string {
  return DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true, svg: true, svgFilters: true, mathMl: true },
    ADD_ATTR: ['target', 'aria-hidden', 'encoding'],
    ADD_TAGS: ['semantics', 'annotation'],
  })
}

/** mermaid の SVG（htmlLabels の foreignObject と <style> を残す） */
export function sanitizeSvg(svg: string): string {
  return DOMPurify.sanitize(svg, {
    USE_PROFILES: { svg: true, svgFilters: true, html: true },
    ADD_TAGS: ['foreignObject', 'style'],
    HTML_INTEGRATION_POINTS: { foreignobject: true },
    ADD_ATTR: ['dominant-baseline', 'text-anchor', 'marker-end', 'marker-start'],
  })
}

/** Marp の出力（inline SVG + foreignObject、marp-* カスタム要素） */
export function sanitizeMarp(html: string): string {
  return DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true, svg: true, svgFilters: true, mathMl: true },
    ADD_TAGS: ['foreignObject', 'semantics', 'annotation'],
    HTML_INTEGRATION_POINTS: { foreignobject: true },
    ADD_ATTR: ['is', 'target', 'aria-hidden', 'encoding'],
    CUSTOM_ELEMENT_HANDLING: {
      tagNameCheck: /^marp-/,
      attributeNameCheck: /^[a-z-]+$/,
      allowCustomizedBuiltInElements: true,
    },
  })
}
