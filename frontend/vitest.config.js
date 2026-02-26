import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@/components': path.resolve(__dirname, './src/components'),
      '@/utils': path.resolve(__dirname, './src/utils'),
      '@/hooks': path.resolve(__dirname, './src/hooks'),
      '@/contentApi': path.resolve(__dirname, './src/contentApi'),
      '@/styles': path.resolve(__dirname, './src/styles'),
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/__tests__/setup.js'],
    include: ['src/__tests__/**/*.{test,spec}.{js,jsx,ts,tsx}'],
    coverage: {
      provider: 'v8',
      include: [
        'src/components/**',
        'src/utils/**',
        'src/hooks/**',
      ],
      exclude: [
        'src/__tests__/**',
        'src/main.jsx',
        'src/route/**',
      ],
      reporter: ['text', 'html', 'json'],
      reportsDirectory: './coverage',
    },
    reporters: [
      'verbose',
      ['allure-vitest/reporter', { resultsDir: './allure-results' }],
    ],
  },
})
