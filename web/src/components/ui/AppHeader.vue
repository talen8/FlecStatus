<script setup lang="ts">
import { computed } from 'vue'
import { useThemeStore } from '../../stores/theme'
import { useI18nStore } from '../../stores/i18n'
import { supportedLocales, localeLabels } from '../../i18n/messages'

interface NavLink {
  to: string
  label: string
  iconPath?: string
}

interface ExternalLink {
  label: string
  url: string
}

interface Props {
  maxWidth?: string
  backTo?: string
  title?: string
  subtitle?: string
  titleIsHeading?: boolean
  navLinks?: NavLink[]
  externalLinks?: ExternalLink[]
}

withDefaults(defineProps<Props>(), {
  maxWidth: '64rem',
})

// ─── Theme Toggle (inlined from ThemeToggle.vue) ───
const themeStore = useThemeStore()
const i18n = useI18nStore()
const { t } = i18n

const theme = computed(() => themeStore.theme)
const localeOptions = computed(() => [
  { value: 'auto' as const, label: t('common.language_auto') },
  ...supportedLocales.map(loc => ({ value: loc, label: localeLabels[loc] })),
])

function cycleTheme() {
  if (theme.value === 'system') themeStore.setTheme('light')
  else if (theme.value === 'light') themeStore.setTheme('dark')
  else themeStore.setTheme('system')
}

const themeTitle = computed(() => {
  const themeLabel = t(`theme.${theme.value}` as 'theme.light' | 'theme.dark' | 'theme.system')
  return t('theme.title', { value: themeLabel })
})
</script>

<template>
  <header class="app-header">
    <div class="app-header__inner" :style="{ maxWidth }">
      <div class="app-header__left">
        <slot name="left">
          <router-link v-if="backTo" :to="backTo" class="app-header__back">
            <svg width="20" height="20" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7" />
            </svg>
          </router-link>
          <h1 v-if="titleIsHeading" class="app-header__title">
            {{ title }}
            <span v-if="subtitle" class="app-header__subtitle">{{ subtitle }}</span>
          </h1>
          <span v-else-if="title" class="app-header__title">
            {{ title }}
            <span v-if="subtitle" class="app-header__subtitle">{{ subtitle }}</span>
          </span>
        </slot>
        <slot name="after-title" />
      </div>

      <div class="app-header__right">
        <slot name="right">
          <template v-if="navLinks && navLinks.length > 0">
            <router-link
              v-for="link in navLinks"
              :key="link.to"
              :to="link.to"
              class="app-header__nav-link"
            >
              <svg
                v-if="link.iconPath"
                class="app-header__nav-icon"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  :d="link.iconPath"
                />
              </svg>
              <span class="app-header__nav-label">{{ link.label }}</span>
            </router-link>
          </template>
          <template v-if="externalLinks && externalLinks.length > 0">
            <a
              v-for="link in externalLinks"
              :key="link.url"
              :href="link.url"
              target="_blank"
              rel="noopener noreferrer"
              class="app-header__nav-link"
            >
              <span class="app-header__nav-label">{{ link.label }}</span>
            </a>
          </template>
        </slot>
        <div class="locale-switcher">
          <button
            class="locale-toggle"
            :aria-label="t('common.language')"
            :title="t('common.language')"
          >
            <svg class="locale-toggle__icon" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z" />
            </svg>
          </button>
          <div class="locale-dropdown">
            <button
              v-for="loc in localeOptions"
              :key="loc.value"
              class="locale-dropdown__item"
              :class="{ 'locale-dropdown__item--active': i18n.localeSetting === loc.value }"
              @click="i18n.setLocaleSetting(loc.value)"
            >
              {{ loc.label }}
            </button>
          </div>
        </div>
        <button
          class="theme-toggle"
          :title="themeTitle"
          :aria-label="themeTitle"
          @click="cycleTheme"
        >
          <svg v-if="theme === 'light'" class="theme-toggle__icon" fill="none" viewBox="0 0 24 24" stroke="currentColor" :stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
          </svg>
          <svg v-else-if="theme === 'dark'" class="theme-toggle__icon" fill="none" viewBox="0 0 24 24" stroke="currentColor" :stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
          </svg>
          <svg v-else class="theme-toggle__icon" fill="none" viewBox="0 0 24 24" stroke="currentColor" :stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
          </svg>
        </button>
      </div>
    </div>
  </header>
</template>

<style scoped lang="scss">
.app-header {
  position: sticky;
  top: 0;
  z-index: 20;
  border-bottom: 1px solid var(--color-border);
  background-color: var(--color-card);
  backdrop-filter: blur(12px);
}

.app-header__inner {
  margin: 0 auto;
  padding: 0.5rem 1rem;
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.5rem;

  @media (min-width: 640px) {
    padding: 0.625rem 1.5rem;
  }

  @media (min-width: 1024px) {
    padding: 0.625rem 2rem;
  }
}

.app-header__left {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  min-width: 0;
  flex: 1;
  overflow: hidden;
}

.app-header__right {
  display: flex;
  align-items: center;
  gap: 0.25rem;
  flex-shrink: 0;
}

.app-header__back {
  display: flex;
  align-items: center;
  text-decoration: none;
  color: var(--color-text-secondary);
  transition: color 0.15s ease;
  flex-shrink: 0;

  &:hover {
    color: var(--color-text-primary);
  }
}

.app-header__title {
  font-size: 1.125rem;
  font-weight: 600;
  color: var(--color-text-primary);
  display: flex;
  align-items: baseline;
  gap: 0.75rem;
  min-width: 0;
  flex-shrink: 0;

  @media (min-width: 640px) {
    font-size: 1.25rem;
  }
}

h1.app-header__title {
  font-size: 1.25rem;

  @media (min-width: 640px) {
    font-size: 1.5rem;
  }
}

.app-header__subtitle {
  font-size: 0.875rem;
  font-weight: 400;
  color: var(--color-text-muted);
}

.app-header__nav-link {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 2.5rem;
  border-radius: 0.5rem;
  padding: 0 0.75rem;
  font-size: 0.875rem;
  color: var(--color-text-muted);
  text-decoration: none;
  transition: background-color 0.15s ease, color 0.15s ease;

  &:hover {
    background-color: var(--color-bg);
    color: var(--color-text-primary);
  }
}

.app-header__nav-icon {
  width: 1.25rem;
  height: 1.25rem;
  flex-shrink: 0;
}

.app-header__nav-label {
  display: none;

  @media (min-width: 640px) {
    display: inline;
  }
}

// ─── Locale Switcher ───
.locale-switcher {
  position: relative;

  &::after {
    content: '';
    position: absolute;
    top: 100%;
    left: 0;
    right: 0;
    height: 0.25rem;
  }

  &:hover .locale-dropdown {
    display: block;
  }
}

.locale-toggle {
  display: flex;
  height: 2.5rem;
  width: 2.5rem;
  align-items: center;
  justify-content: center;
  border-radius: 0.5rem;
  color: var(--color-text-muted);
  transition: background-color 0.15s ease, color 0.15s ease;
  cursor: pointer;

  &:hover {
    background-color: var(--color-bg-secondary);
    color: var(--color-text-primary);
  }
}

.locale-toggle__icon {
  height: 1rem;
  width: 1rem;
}

.locale-dropdown {
  display: none;
  position: absolute;
  top: 100%;
  left: 50%;
  transform: translateX(-50%);
  margin-top: 0.25rem;
  min-width: 8rem;
  background-color: var(--color-card);
  border: 1px solid var(--color-border);
  border-radius: 0.5rem;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  z-index: 30;
  overflow: hidden;
}

.locale-dropdown__item {
  display: block;
  width: 100%;
  padding: 0.5rem 0.75rem;
  font-size: 0.875rem;
  color: var(--color-text-primary);
  background: none;
  border: none;
  text-align: center;
  cursor: pointer;
  transition: background-color 0.15s ease;

  &:hover {
    background-color: var(--color-bg-secondary);
  }
}

.locale-dropdown__item--active {
  font-weight: 600;
  color: var(--color-accent);
}

// ─── Theme Toggle (inlined from ThemeToggle.vue) ───
.theme-toggle {
  display: flex;
  height: 2.5rem;
  width: 2.5rem;
  align-items: center;
  justify-content: center;
  border-radius: 0.5rem;
  color: var(--color-text-muted);
  transition: background-color 0.15s ease, color 0.15s ease;
  cursor: pointer;

  &:hover {
    background-color: var(--color-bg-secondary);
    color: var(--color-text-primary);
  }
}

.theme-toggle__icon {
  height: 1rem;
  width: 1rem;
}
</style>
