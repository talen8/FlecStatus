<script setup lang="ts">
import { computed } from 'vue'

const props = withDefaults(defineProps<{
  variant: 'up' | 'down' | 'maintenance' | 'paused' | 'unknown' | 'info'
  size?: 'sm' | 'md'
}>(), {
  size: 'sm',
})

const variantClasses: Record<string, string> = {
  up: 'badge--up',
  down: 'badge--down',
  maintenance: 'badge--maintenance',
  paused: 'badge--paused',
  unknown: 'badge--unknown',
  info: 'badge--info',
}

const badgeClass = computed(() => [
  'badge',
  variantClasses[props.variant],
  props.size === 'sm' ? 'badge--sm' : 'badge--md',
])
</script>

<template>
  <span :class="badgeClass">
    <slot />
  </span>
</template>

<style scoped lang="scss">
.badge {
  display: inline-flex;
  align-items: center;
  border-radius: 9999px;
  letter-spacing: 0.025em;
}

.badge--sm {
  padding: 0.125rem 0.625rem;
  font-size: 0.75rem;
}

.badge--md {
  padding: 0.25rem 0.75rem;
  font-size: 0.875rem;
}

.badge--up {
  background-color: #ecfdf5;
  color: #047857;
  box-shadow: inset 0 0 0 1px rgba(5, 150, 105, 0.2);
}

.dark .badge--up {
  background-color: rgba(16, 185, 129, 0.1);
  color: #6ee7b7;
  box-shadow: inset 0 0 0 1px rgba(52, 211, 153, 0.3);
}

.badge--down {
  background-color: #fef2f2;
  color: #b91c1c;
  box-shadow: inset 0 0 0 1px rgba(220, 38, 38, 0.2);
}

.dark .badge--down {
  background-color: rgba(239, 68, 68, 0.1);
  color: #fca5a5;
  box-shadow: inset 0 0 0 1px rgba(248, 113, 113, 0.3);
}

.badge--maintenance {
  background-color: #eff6ff;
  color: #1d4ed8;
  box-shadow: inset 0 0 0 1px rgba(59, 130, 246, 0.2);
}

.dark .badge--maintenance {
  background-color: rgba(59, 130, 246, 0.1);
  color: #93c5fd;
  box-shadow: inset 0 0 0 1px rgba(96, 165, 250, 0.3);
}

.badge--paused {
  background-color: #fffbeb;
  color: #b45309;
  box-shadow: inset 0 0 0 1px rgba(245, 158, 11, 0.2);
}

.dark .badge--paused {
  background-color: rgba(245, 158, 11, 0.1);
  color: #fcd34d;
  box-shadow: inset 0 0 0 1px rgba(251, 191, 36, 0.3);
}

.badge--unknown {
  background-color: #f1f5f9;
  color: #475569;
  box-shadow: inset 0 0 0 1px rgba(100, 116, 139, 0.2);
}

.dark .badge--unknown {
  background-color: rgba(100, 116, 139, 0.1);
  color: #cbd5e1;
  box-shadow: inset 0 0 0 1px rgba(148, 163, 184, 0.3);
}

.badge--info {
  background-color: #f1f5f9;
  color: #334155;
  box-shadow: inset 0 0 0 1px rgba(100, 116, 139, 0.15);
}

.dark .badge--info {
  background-color: rgba(100, 116, 139, 0.1);
  color: #cbd5e1;
  box-shadow: inset 0 0 0 1px rgba(148, 163, 184, 0.25);
}
</style>
