<script setup lang="ts">
import { computed } from 'vue'

const props = withDefaults(defineProps<{
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'success'
  size?: 'xs' | 'sm' | 'md' | 'lg'
  type?: 'button' | 'submit' | 'reset'
  disabled?: boolean | undefined
  full?: boolean
}>(), {
  variant: 'primary',
  size: 'md',
  type: 'button',
  disabled: false,
  full: false,
})

defineEmits<{
  click: [event: MouseEvent]
}>()

const variantClasses: Record<string, string> = {
  primary: 'btn--primary',
  secondary: 'btn--secondary',
  ghost: 'btn--ghost',
  danger: 'btn--danger',
  success: 'btn--success',
}

const sizeClasses: Record<string, string> = {
  xs: 'btn--xs',
  sm: 'btn--sm',
  md: 'btn--md',
  lg: 'btn--lg',
}

const buttonClass = computed(() => [
  'btn',
  variantClasses[props.variant],
  sizeClasses[props.size],
  props.full && 'btn--full',
])
</script>

<template>
  <button
    :type="type"
    :disabled="disabled"
    :class="buttonClass"
    @click="$emit('click', $event)"
  >
    <slot />
  </button>
</template>

<style scoped lang="scss">
.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  font-weight: 500;
  border-radius: 0.5rem;
  transition: background-color 0.15s ease, color 0.15s ease, opacity 0.15s ease;
  cursor: pointer;

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
}

.btn--xs {
  height: 1.625rem;
  padding: 0 0.5rem;
  font-size: 0.75rem;
  border-radius: 0.25rem;
}

.btn--sm {
  height: 2.25rem;
  padding: 0 0.875rem;
  font-size: 0.875rem;
}

.btn--md {
  height: 2.5rem;
  padding: 0 1rem;
  font-size: 1rem;
}

.btn--lg {
  height: 2.75rem;
  padding: 0 1.25rem;
  font-size: 1rem;
}

.btn--primary {
  background-color: var(--color-accent, #3b82f6);
  color: white;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05);

  &:hover:not(:disabled) {
    opacity: 0.9;
  }

  &:active:not(:disabled) {
    opacity: 1;
  }
}

.btn--secondary {
  background-color: var(--color-card);
  color: var(--color-text-secondary);
  border: 1px solid var(--color-border);
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05);

  &:hover:not(:disabled) {
    background-color: var(--color-bg);
  }
}

.dark .btn--secondary {
  background-color: var(--color-bg-secondary);
  color: var(--color-text-secondary);
  border-color: var(--color-input-border);

  &:hover:not(:disabled) {
    background-color: var(--color-card-hover);
  }
}

.btn--ghost {
  background-color: transparent;
  color: var(--color-text-secondary);

  &:hover:not(:disabled) {
    color: var(--color-text-primary);
    background-color: var(--color-bg-secondary);
  }
}

.dark .btn--ghost {
  color: var(--color-text-muted);

  &:hover:not(:disabled) {
    color: var(--color-text-primary);
    background-color: var(--color-bg-secondary);
  }
}

.btn--danger {
  background-color: var(--color-danger);
  color: white;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05);

  &:hover:not(:disabled) {
    background-color: var(--color-danger-hover);
  }

  &:active:not(:disabled) {
    background-color: var(--color-danger-hover);
  }
}

.dark .btn--danger {
  background-color: var(--color-danger);

  &:hover:not(:disabled) {
    background-color: var(--color-danger-hover);
  }
}

.btn--success {
  background-color: var(--color-up);
  color: white;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05);

  &:hover:not(:disabled) {
    opacity: 0.9;
  }

  &:active:not(:disabled) {
    opacity: 1;
  }
}

.btn--full {
  width: 100%;
}
</style>
