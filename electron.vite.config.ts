import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import { svelte, vitePreprocess } from '@sveltejs/vite-plugin-svelte'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: { index: resolve('electron/main.ts') }
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: { index: resolve('electron/preload.ts') }
      }
    }
  },
  renderer: {
    root: resolve('src'),
    resolve: {
      alias: {
        '@': resolve('src')
      }
    },
    plugins: [svelte({ preprocess: vitePreprocess() })],
    worker: {
      format: 'es'
    },
    build: {
      rollupOptions: {
        input: resolve('src/index.html')
      }
    }
  }
})
