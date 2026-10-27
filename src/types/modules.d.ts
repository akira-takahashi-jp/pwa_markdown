declare module 'markdown-it-task-lists' {
  import type { MarkdownIt } from 'markdown-it'
  const taskLists: (md: MarkdownIt, opts?: { enabled?: boolean; label?: boolean; labelAfter?: boolean }) => void
  export default taskLists
}

declare module 'markdown-it-footnote' {
  import type { MarkdownIt } from 'markdown-it'
  const footnote: (md: MarkdownIt) => void
  export default footnote
}

declare module 'markdown-it-texmath' {
  import type { MarkdownIt } from 'markdown-it'
  const texmath: (
    md: MarkdownIt,
    opts?: { engine?: unknown; delimiters?: string | string[]; katexOptions?: Record<string, unknown> },
  ) => void
  export default texmath
}

interface LaunchParams {
  readonly files: readonly FileSystemHandle[]
}
interface LaunchQueue {
  setConsumer(consumer: (params: LaunchParams) => void): void
}
interface Window {
  launchQueue?: LaunchQueue
}
