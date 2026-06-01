import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { verifyAccessSession } from '../api/client'
import { useQueryClient } from '@tanstack/vue-query'

type AuthStatus = 'unauthenticated' | 'checking' | 'authenticated'

const AUTH_SENSITIVE_PUBLIC_QUERY_KEYS = [
  ['status'],
  ['latency'],
  ['public-incidents'],
  ['public-maintenance-windows'],
  ['public-day-context'],
  ['public-monitor-outages'],
] as const

export const useAuthStore = defineStore('auth', () => {
  const status = ref<AuthStatus>('checking')
  let verifyInFlight: Promise<boolean> | null = null

  const isAuthenticated = computed(() => status.value === 'authenticated')

  function resetAuthSensitivePublicQueries() {
    const queryClient = useQueryClient()
    for (const key of AUTH_SENSITIVE_PUBLIC_QUERY_KEYS) {
      queryClient.resetQueries({ queryKey: key })
    }
  }

  async function ensureValidToken(): Promise<boolean> {
    if (status.value === 'authenticated') return true

    if (verifyInFlight) {
      return verifyInFlight
    }

    status.value = 'checking'

    const p = verifyAccessSession()
      .then(() => {
        status.value = 'authenticated'
        return true
      })
      .catch(() => {
        status.value = 'unauthenticated'
        verifyInFlight = null
        return false
      })
      .finally(() => {
        verifyInFlight = null
      })

    verifyInFlight = p
    return p
  }

  // 初始化时重置敏感查询
  resetAuthSensitivePublicQueries()

  return {
    status,
    isAuthenticated,
    ensureValidToken,
  }
})
