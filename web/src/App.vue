<script setup lang="ts">
import { onMounted } from 'vue'

onMounted(() => {
  // 移除服务器端预渲染的内容，避免出现重复内容闪烁
  document.getElementById('uptimer-preload')?.remove()
})
</script>

<template>
  <router-view />
</template>
