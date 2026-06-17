import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'
import { resolve } from 'path'

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@main': resolve(__dirname, 'src/main'),
    },
  },
  test: {
    environment: 'node',
    include: [
      'src/**/*.test.ts',
      'sdk/**/*.test.{ts,mjs}',
      'packages/**/*.test.{ts,mjs}',
      'scripts/**/*.test.{ts,mjs}',
    ],
    globals: true
  }
})
