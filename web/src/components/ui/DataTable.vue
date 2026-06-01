<script setup lang="ts">
import { computed } from 'vue'

const props = withDefaults(defineProps<{
  minWidth?: string
}>(), {
  minWidth: '860px',
})

const tableStyle = computed(() =>
  props.minWidth ? { minWidth: props.minWidth } : undefined,
)
</script>

<template>
  <div class="data-table-wrapper">
    <table class="data-table" :style="tableStyle">
      <slot />
    </table>
  </div>
</template>

<style scoped lang="scss">
@use '../../styles/mixins' as *;

.data-table-wrapper {
  overflow-x: auto;
  @include card;
}

:deep(.data-table) {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.875rem;

  th, td {
    padding: 0.75rem;
    border-bottom: 1px solid var(--color-border);
  }

  th {
    text-align: center;
    font-weight: 500;
    color: var(--color-text-muted);
    font-size: 0.75rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    background: var(--color-bg);
    white-space: nowrap;
  }

  td {
    text-align: center;
  }
}

:deep(.data-table__row) {
  transition: background-color 0.1s ease;

  &:hover {
    background-color: var(--color-bg);
  }
}

:deep(.data-table__td--name) {
  font-weight: 500;
  color: var(--color-text-primary);
}

:deep(.data-table__td--mono) {
  font-size: 0.75rem;
  color: var(--color-text-muted);
  font-variant-numeric: tabular-nums;
}

:deep(.data-table__td--target) {
  max-width: 160px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--color-text-muted);

  @media (min-width: 640px) {
    max-width: 220px;
  }
}

:deep(.data-table__td--nowrap) {
  white-space: nowrap;
  font-size: 0.75rem;
  color: var(--color-text-muted);
}

:deep(.data-table__td--error) {
  max-width: 260px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 0.75rem;
  color: var(--color-text-muted);
}

:deep(.data-table__td--actions),
:deep(.data-table__th--actions) {
  text-align: right;
  white-space: nowrap;
  width: 1%;
}

:deep(.data-table__th--hidden-lg),
:deep(.data-table__td--hidden-lg) {
  display: none;
  @media (min-width: 1024px) {
    display: table-cell;
  }
}

:deep(.data-table__th--hidden-xl),
:deep(.data-table__td--hidden-xl) {
  display: none;
  @media (min-width: 1280px) {
    display: table-cell;
  }
}
</style>
