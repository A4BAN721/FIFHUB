'use client'

import * as React from 'react'

type Theme = 'light' | 'dark'

type ThemeProviderProps = React.PropsWithChildren<{
  attribute?: string
  defaultTheme?: Theme
  enableColorScheme?: boolean
  enableSystem?: boolean
  disableTransitionOnChange?: boolean
}>

type ThemeContextValue = {
  theme: Theme
  resolvedTheme: Theme
  setTheme: (theme: Theme) => void
}

const ThemeContext = React.createContext<ThemeContextValue | null>(null)
const storageKey = 'fithub-theme'
const themeChangeEvent = 'fithub-theme-change'

function applyTheme(theme: Theme) {
  document.documentElement.classList.toggle('dark', theme === 'dark')
  document.documentElement.classList.toggle('light', theme === 'light')
  document.documentElement.style.colorScheme = theme
}

function getStoredTheme(defaultTheme: Theme): Theme {
  if (typeof window === 'undefined') return defaultTheme
  const storedTheme = window.localStorage.getItem(storageKey)
  return storedTheme === 'light' || storedTheme === 'dark' ? storedTheme : defaultTheme
}

function subscribeToThemeChanges(callback: () => void) {
  window.addEventListener('storage', callback)
  window.addEventListener(themeChangeEvent, callback)

  return () => {
    window.removeEventListener('storage', callback)
    window.removeEventListener(themeChangeEvent, callback)
  }
}

export function ThemeProvider({
  children,
  defaultTheme = 'dark',
}: ThemeProviderProps) {
  const theme = React.useSyncExternalStore(
    subscribeToThemeChanges,
    () => getStoredTheme(defaultTheme),
    () => defaultTheme,
  )

  const setTheme = React.useCallback((nextTheme: Theme) => {
    window.localStorage.setItem(storageKey, nextTheme)
    window.dispatchEvent(new Event(themeChangeEvent))
  }, [])

  React.useEffect(() => {
    applyTheme(theme)
  }, [theme])

  const value = React.useMemo(
    () => ({
      theme,
      resolvedTheme: theme,
      setTheme,
    }),
    [setTheme, theme],
  )

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useAppTheme() {
  const context = React.useContext(ThemeContext)
  if (!context) {
    throw new Error('useAppTheme must be used within ThemeProvider')
  }
  return context
}
