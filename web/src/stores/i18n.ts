import { defineStore } from 'pinia'
import { ref, computed, watch, onMounted } from 'vue'
import type { LocaleSetting, SupportedLocale } from '../api/types'
import { messages, supportedLocales, type MessageKey } from '../i18n/messages'

const STORAGE_KEY = 'uptimer-locale-setting-v1'

type TranslateValues = Record<string, string | number>

function localeFromTag(tag: string): SupportedLocale | null {
  const lower = tag.toLowerCase()
  if (lower.startsWith('zh-tw') || lower.startsWith('zh-hk') || lower.startsWith('zh-mo')) {
    return 'zh-TW'
  }
  if (lower.startsWith('zh')) return 'zh-CN'
  if (lower.startsWith('en')) return 'en'
  return null
}

function normalizeLocaleSetting(value: unknown): LocaleSetting | null {
  if (typeof value !== 'string') return null
  if (value === 'auto') return 'auto'
  return supportedLocales.includes(value as SupportedLocale) ? (value as SupportedLocale) : null
}

function normalizeSupportedLocale(value: unknown): SupportedLocale | null {
  if (typeof value !== 'string') return null
  return supportedLocales.includes(value as SupportedLocale) ? (value as SupportedLocale) : null
}

function detectBrowserLocale(): SupportedLocale {
  if (typeof navigator === 'undefined') return 'en'
  const languages = [...(navigator.languages ?? []), navigator.language].filter(
    (lang): lang is string => typeof lang === 'string' && lang.length > 0,
  )
  for (const lang of languages) {
    const candidate = localeFromTag(lang)
    if (candidate) return candidate
  }
  return 'en'
}

function readStoredLocaleSetting(): LocaleSetting {
  if (typeof window === 'undefined') return 'auto'
  const raw = window.localStorage.getItem(STORAGE_KEY)
  return normalizeLocaleSetting(raw) ?? 'auto'
}

function interpolate(template: string, values?: TranslateValues): string {
  if (!values) return template
  return template.replace(/\{([a-zA-Z0-9_]+)\}/g, (_all, key: string) => {
    const value = values[key]
    return value === undefined ? '' : String(value)
  })
}

function resolveEffectiveLocale(
  setting: LocaleSetting,
  browserLocale: SupportedLocale,
): SupportedLocale {
  const normalizedSetting = normalizeLocaleSetting(setting) ?? 'auto'
  const normalizedBrowser = normalizeSupportedLocale(browserLocale) ?? 'en'
  return normalizedSetting === 'auto' ? normalizedBrowser : normalizedSetting
}

export const useI18nStore = defineStore('i18n', () => {
  const localeSetting = ref<LocaleSetting>(readStoredLocaleSetting())
  const browserLocale = ref<SupportedLocale>(detectBrowserLocale())

  const locale = computed(() => resolveEffectiveLocale(localeSetting.value, browserLocale.value))

  function setLocaleSetting(next: LocaleSetting) {
    const normalized = normalizeLocaleSetting(next) ?? 'auto'
    if (localeSetting.value !== normalized) {
      localeSetting.value = normalized
    }
  }

  function applyServerLocaleSetting(next: LocaleSetting | null | undefined) {
    const normalized = normalizeLocaleSetting(next)
    if (!normalized) return
    if (localeSetting.value !== normalized) {
      localeSetting.value = normalized
    }
  }

  function t(key: MessageKey, values?: TranslateValues): string {
    const localeMessages = messages[locale.value] ?? messages.en
    const translated = localeMessages[key] ?? messages.en[key] ?? key
    return interpolate(translated, values)
  }

  watch(localeSetting, (val) => {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(STORAGE_KEY, val)
    }
  })

  watch(locale, (val) => {
    if (typeof document !== 'undefined') {
      document.documentElement.lang = val
    }
  })

  onMounted(() => {
    if (typeof window !== 'undefined') {
      const onLanguageChange = () => {
        browserLocale.value = detectBrowserLocale()
      }
      window.addEventListener('languagechange', onLanguageChange)
    }
  })

  return {
    locale,
    localeSetting,
    browserLocale,
    setLocaleSetting,
    applyServerLocaleSetting,
    t,
  }
})

export type { MessageKey }
