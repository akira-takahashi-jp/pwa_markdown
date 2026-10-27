import { useEffect, useState } from 'react'

export type ThemePref = 'system' | 'light' | 'dark'
export type Theme = 'light' | 'dark'

const KEY = 'md-editor:theme'

function readPref(): ThemePref {
  try {
    const v = localStorage.getItem(KEY)
    if (v === 'light' || v === 'dark' || v === 'system') return v
  } catch {
    /* ignore */
  }
  return 'system'
}

/** OS 設定に追従しつつ、手動でも切り替えられるテーマ */
export function useTheme() {
  const [pref, setPref] = useState<ThemePref>(readPref)
  const [systemDark, setSystemDark] = useState(() => matchMedia('(prefers-color-scheme: dark)').matches)

  useEffect(() => {
    const mq = matchMedia('(prefers-color-scheme: dark)')
    const on = () => setSystemDark(mq.matches)
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])

  const theme: Theme = pref === 'system' ? (systemDark ? 'dark' : 'light') : pref

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#0d1117' : '#1f6feb')
  }, [theme])

  const cycle = () => {
    const next: ThemePref = pref === 'system' ? 'light' : pref === 'light' ? 'dark' : 'system'
    setPref(next)
    try {
      localStorage.setItem(KEY, next)
    } catch {
      /* ignore */
    }
  }

  return { pref, theme, cycle }
}

/** localStorage に保存される小さな UI 設定 */
export function usePersistentState<T>(key: string, initial: T) {
  const [v, setV] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key)
      return raw == null ? initial : (JSON.parse(raw) as T)
    } catch {
      return initial
    }
  })
  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(v))
    } catch {
      /* ignore */
    }
  }, [key, v])
  return [v, setV] as const
}
