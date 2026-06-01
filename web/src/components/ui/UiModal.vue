<script setup lang="ts">
withDefaults(defineProps<{
  visible?: boolean
}>(), {
  visible: false,
})

defineEmits<{
  close: []
}>()
</script>

<template>
  <Teleport to="body">
    <div v-if="visible" class="ui-modal-overlay animate-fade-in" @click.self="$emit('close')">
      <div class="ui-modal-panel animate-slide-up">
        <slot />
      </div>
    </div>
  </Teleport>
</template>

<style scoped lang="scss">
.ui-modal-overlay {
  position: fixed;
  inset: 0;
  z-index: 50;
  display: flex;
  align-items: flex-end;
  justify-content: center;
  padding: 0;
  background: var(--overlay-bg);
  backdrop-filter: blur(10px);
}

.ui-modal-panel {
  width: 100%;
  max-width: 720px;
  max-height: min(90vh, 860px);
  overflow-y: auto;
  overflow-x: hidden;
  border-top-left-radius: var(--radius-xl);
  border-top-right-radius: var(--radius-xl);
  border: 1px solid var(--color-border);
  background: var(--color-card);
  box-shadow: var(--shadow-panel);
}

@media (min-width: 640px) {
  .ui-modal-overlay {
    align-items: center;
    padding: 1rem;
  }

  .ui-modal-panel {
    border-radius: var(--radius-xl);
  }
}
</style>
