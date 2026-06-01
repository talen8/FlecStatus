import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vite';
import viteCompression from 'vite-plugin-compression';

export default defineConfig({
  root: import.meta.dirname,
  plugins: [
    vue(),
    viteCompression({ algorithm: 'gzip', ext: '.gz', threshold: 0 }),
  ],
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:8787',
        changeOrigin: true,
      },
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id: string) {
          if (id.includes('/node_modules/vue/') || id.includes('/node_modules/pinia/') || id.includes('/node_modules/vue-router/')) {
            return 'vendor-vue'
          }
          if (id.includes('/node_modules/@tanstack/')) {
            return 'vendor-query'
          }
        },
      },
    },
  },
});
