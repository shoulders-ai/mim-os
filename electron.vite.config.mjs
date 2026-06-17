import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'
import { resolve } from 'path'

function mainSourceAliasPlugin() {
  return {
    name: 'main-source-alias',
    enforce: 'pre',
    resolveId(source) {
      if (source.startsWith('@main/') && source.endsWith('.js')) {
        return resolve(__dirname, 'src/main', source.slice('@main/'.length).replace(/\.js$/, '.ts'))
      }
      return null
    }
  }
}

export default defineConfig({
  resolve: {
    alias: {
      '@main': resolve(__dirname, 'src/main')
    }
  },
  main: {
    plugins: [mainSourceAliasPlugin(), externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/main/index.ts'),
          cli: resolve(__dirname, 'src/main/cli.ts')
        }
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: resolve(__dirname, 'src/preload/index.ts')
      }
    }
  },
  renderer: {
    plugins: [mainSourceAliasPlugin(), vue(), tailwindcss()],
    root: resolve(__dirname, 'src/renderer'),
    publicDir: resolve(__dirname, 'public'),
    build: {
      rollupOptions: {
        input: resolve(__dirname, 'src/renderer/index.html')
      }
    }
  }
})
