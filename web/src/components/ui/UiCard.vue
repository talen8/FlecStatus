<script setup lang="ts">
import { computed } from 'vue'

const props = withDefaults(defineProps<{
  hover?: boolean
  onClick?: () => void
}>(), {
  hover: false,
})

const cardClass = computed(() => [
  'ui-card',
  props.hover && 'ui-card--hover',
  props.hover && props.onClick && 'ui-card--clickable',
])

function handleKeydown(e: KeyboardEvent) {
  if (e.target !== e.currentTarget) return
  if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') {
    e.preventDefault()
    props.onClick?.()
  }
}
</script>

<template>
  <div
    :class="cardClass"
    :role="onClick ? 'button' : undefined"
    :tabindex="onClick ? 0 : undefined"
    @click="onClick?.()"
    @keydown.enter="handleKeydown"
    @keydown.space="handleKeydown"
  >
    <slot />
  </div>
</template>

<style scoped lang="scss">
@use '../../styles/mixins' as *;

.ui-card {
  @include card;
}

.ui-card--hover {
  @include card-hover;
}

.ui-card--clickable {
  cursor: pointer;
}
</style>
