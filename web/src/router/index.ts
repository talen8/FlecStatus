import { createRouter, createWebHistory } from 'vue-router'
import { useAuthStore } from '../stores/auth'

const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: '/',
      component: () => import('../pages/StatusPage.vue'),
    },
    {
      path: '/history/incidents',
      component: () => import('../pages/IncidentHistoryPage.vue'),
    },
    {
      path: '/history/maintenance',
      component: () => import('../pages/MaintenanceHistoryPage.vue'),
    },
    {
      path: '/admin',
      component: () => import('../pages/AdminDashboard.vue'),
      meta: { requiresAuth: true },
    },
    {
      path: '/admin/analytics',
      component: () => import('../pages/AdminAnalytics.vue'),
      meta: { requiresAuth: true },
    },
  ],
})

router.beforeEach(async (to) => {
  if (to.meta.requiresAuth) {
    const auth = useAuthStore()
    await auth.ensureValidToken()
  }
})

export default router
