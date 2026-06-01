import { defineStore } from 'pinia'
import { ref, computed, watch, onMounted } from 'vue'

type Theme = 'light' | 'dark' | 'system'

const STORAGE_KEY = 'uptimer-theme'

function getSystemTheme(): 'light' | 'dark' {
  if (typeof window === 'undefined') return 'light'
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

function getStoredTheme(): Theme {
  if (typeof window === 'undefined') return 'system'
  const stored = localStorage.getItem(STORAGE_KEY)
  if (stored === 'light' || stored === 'dark' || stored === 'system') {
    return stored
  }
  return 'system'
}

export const useThemeStore = defineStore('theme', () => {
  const theme = ref<Theme>(getStoredTheme())
  const resolvedTheme = ref<'light' | 'dark'>(theme.value === 'system' ? getSystemTheme() : theme.value)

  const isDark = computed(() => resolvedTheme.value === 'dark')

  function setTheme(newTheme: Theme) {
    theme.value = newTheme
    localStorage.setItem(STORAGE_KEY, newTheme)
  }

  function applyTheme() {
    const resolved = theme.value === 'system' ? getSystemTheme() : theme.value
    resolvedTheme.value = resolved

    const root = document.documentElement
    if (resolved === 'dark') {
      root.classList.add('dark')
    } else {
      root.classList.remove('dark')
    }
  }

  watch(theme, applyTheme)

  onMounted(() => {
    applyTheme()

    if (theme.value === 'system') {
      const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
      const handleChange = (e: MediaQueryListEvent) => {
        if (theme.value === 'system') {
          resolvedTheme.value = e.matches ? 'dark' : 'light'
          const root = document.documentElement
          if (e.matches) {
            root.classList.add('dark')
          } else {
            root.classList.remove('dark')
          }
        }
      }
      mediaQuery.addEventListener('change', handleChange)
    }
  })

  return {
    theme,
    resolvedTheme,
    isDark,
    setTheme,
  }
})
