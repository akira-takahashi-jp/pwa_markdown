import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { languages } from '@codemirror/language-data'
import { bracketMatching, defaultHighlightStyle, indentOnInput, syntaxHighlighting } from '@codemirror/language'
import { highlightSelectionMatches, search, searchKeymap } from '@codemirror/search'
import { Compartment, EditorState } from '@codemirror/state'
import { oneDark } from '@codemirror/theme-one-dark'
import {
  crosshairCursor,
  drawSelection,
  dropCursor,
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
  rectangularSelection,
} from '@codemirror/view'
import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'

export interface EditorHandle {
  /** id の文書に切り替える（初めての id なら text で作成）。文書ごとに undo 履歴・カーソル・スクロール位置を保つ */
  open(id: string, text: string): void
  /** id の文書の状態を破棄する */
  close(id: string): void
  getDoc(): string
  /** 画面上端に表示されている行（小数部は行内の位置） */
  getTopLine(): number
  scrollToLine(line: number, atBottom?: boolean): void
  revealLine(line: number): void
  isAtBottom(): boolean
  focus(): void
}

interface Props {
  initialId: string
  initialDoc: string
  dark: boolean
  onChange(doc: string): void
  onScroll(): void
  onUserInteract(): void
}

const themeCompartment = new Compartment()

/** スクロール領域の先頭から文書先頭までの距離 */
function docOffset(view: EditorView): number {
  return view.documentTop - view.scrollDOM.getBoundingClientRect().top + view.scrollDOM.scrollTop
}

const baseTheme = EditorView.theme({
  '&': { height: '100%', fontSize: '14px' },
  '.cm-scroller': {
    fontFamily: 'var(--font-mono)',
    lineHeight: '1.6',
  },
  '.cm-content': { padding: '12px 0 40vh' },
  '.cm-gutters': { borderRight: '1px solid var(--border)' },
})

export const Editor = forwardRef<EditorHandle, Props>(function Editor(props, ref) {
  const hostRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const propsRef = useRef(props)
  propsRef.current = props

  /** 非アクティブな文書の状態（id → EditorState とスクロール位置） */
  const statesRef = useRef(new Map<string, { state: EditorState; scrollTop: number }>())
  const activeIdRef = useRef(props.initialId)

  const createState = (doc: string) =>
    EditorState.create({
      doc,
      extensions: [
        lineNumbers(),
        highlightActiveLineGutter(),
        history(),
        drawSelection(),
        dropCursor(),
        indentOnInput(),
        bracketMatching(),
        rectangularSelection(),
        crosshairCursor(),
        highlightActiveLine(),
        highlightSelectionMatches(),
        search({ top: true }),
        EditorView.lineWrapping,
        EditorState.allowMultipleSelections.of(true),
        markdown({ base: markdownLanguage, codeLanguages: languages, addKeymap: true }),
        syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
        keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap, indentWithTab]),
        baseTheme,
        themeCompartment.of(propsRef.current.dark ? oneDark : []),
        EditorView.updateListener.of((u) => {
          if (u.docChanged) propsRef.current.onChange(u.state.doc.toString())
        }),
      ],
    })

  useEffect(() => {
    const view = new EditorView({ parent: hostRef.current!, state: createState(props.initialDoc) })
    viewRef.current = view
    // スクロール同期用（どちらのペインをユーザーが操作しているか）
    const scroller = view.scrollDOM
    const interact = () => propsRef.current.onUserInteract()
    const onScroll = () => propsRef.current.onScroll()
    const events = ['wheel', 'pointerdown', 'keydown', 'touchstart'] as const
    events.forEach((ev) => scroller.addEventListener(ev, interact, { passive: true }))
    scroller.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      events.forEach((ev) => scroller.removeEventListener(ev, interact))
      scroller.removeEventListener('scroll', onScroll)
      view.destroy()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    viewRef.current?.dispatch({ effects: themeCompartment.reconfigure(props.dark ? oneDark : []) })
  }, [props.dark])

  useImperativeHandle(
    ref,
    () => ({
      open(id, text) {
        const view = viewRef.current!
        if (id === activeIdRef.current) return
        statesRef.current.set(activeIdRef.current, { state: view.state, scrollTop: view.scrollDOM.scrollTop })
        const saved = statesRef.current.get(id)
        statesRef.current.delete(id)
        activeIdRef.current = id
        // setState は updateListener を呼ばないので onChange（未保存扱い）は発生しない
        view.setState(saved?.state ?? createState(text))
        // 保存していた状態は作成時のテーマのままなので合わせ直す
        view.dispatch({ effects: themeCompartment.reconfigure(propsRef.current.dark ? oneDark : []) })
        const top = saved?.scrollTop ?? 0
        view.requestMeasure({ read: () => null, write: (_, v) => void (v.scrollDOM.scrollTop = top) })
      },
      close(id) {
        statesRef.current.delete(id)
      },
      getDoc() {
        return viewRef.current!.state.doc.toString()
      },
      getTopLine() {
        const view = viewRef.current!
        const top = view.scrollDOM.scrollTop - docOffset(view)
        const block = view.lineBlockAtHeight(top)
        const line = view.state.doc.lineAt(block.from).number
        return line + Math.min(1, Math.max(0, (top - block.top) / Math.max(1, block.height)))
      },
      scrollToLine(line, atBottom) {
        const view = viewRef.current!
        const s = view.scrollDOM
        if (atBottom) {
          s.scrollTop = s.scrollHeight
          return
        }
        const doc = view.state.doc
        const n = Math.min(doc.lines, Math.max(1, Math.floor(line)))
        const pos = doc.line(n).from
        // 画面外の行の高さは推定値なので、まず CodeMirror にスクロールさせてから実測値で微調整する
        view.dispatch({ effects: EditorView.scrollIntoView(pos, { y: 'start', yMargin: 0 }) })
        view.requestMeasure({
          read: (v) => ({ block: v.lineBlockAt(pos), offset: docOffset(v) }),
          write: ({ block, offset }, v) => {
            v.scrollDOM.scrollTop = offset + block.top + (line - n) * block.height
          },
        })
      },
      revealLine(line) {
        const view = viewRef.current!
        const doc = view.state.doc
        const pos = doc.line(Math.min(doc.lines, Math.max(1, line))).from
        view.dispatch({ selection: { anchor: pos }, effects: EditorView.scrollIntoView(pos, { y: 'start', yMargin: 8 }) })
        view.focus()
      },
      isAtBottom() {
        const s = viewRef.current!.scrollDOM
        return s.scrollTop + s.clientHeight >= s.scrollHeight - 4
      },
      focus() {
        viewRef.current?.focus()
      },
    }),
    [],
  )

  return <div className="editor-host" ref={hostRef} />
})
