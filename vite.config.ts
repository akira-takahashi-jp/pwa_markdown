import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// GitHub Pages（https://<user>.github.io/pwa_markdown/）では BASE_PATH=/pwa_markdown/ でビルドする
const base = process.env.BASE_PATH ?? '/'

export default defineConfig({
  base,
  resolve: {
    alias: [{ find: /^mathjax-full\/.*$/, replacement: fileURLToPath(new URL('./src/lib/stubs/mathjax-full.ts', import.meta.url)) }],
  },
  server: {
    port: 5173,
    // Docker（macOS のバインドマウント）でファイル変更が拾えない場合は VITE_USE_POLLING=true
    watch: process.env.VITE_USE_POLLING === 'true' ? { usePolling: true, interval: 300 } : undefined,
  },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 2000,
  },
  worker: {
    format: 'es',
  },
  plugins: [
    react(),
    VitePWA({
      // 更新は「更新があります」トーストから反映する（autoUpdate だと編集中に自動リロードされるため）
      registerType: 'prompt',
      injectRegister: false,
      includeAssets: ['favicon.ico', 'icon.svg', 'apple-touch-icon-180x180.png'],
      manifest: {
        name: 'Markdown Editor',
        short_name: 'MD Editor',
        description: 'Mermaid・Marp 対応の Markdown エディター / ビューワー',
        lang: 'ja',
        start_url: base,
        scope: base,
        display: 'standalone',
        theme_color: '#1f6feb',
        background_color: '#ffffff',
        icons: [
          { src: 'pwa-64x64.png', sizes: '64x64', type: 'image/png' },
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          { src: 'maskable-icon-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
        file_handlers: [
          {
            action: base,
            accept: { 'text/markdown': ['.md', '.markdown'] },
          },
        ],
        launch_handler: { client_mode: 'focus-existing' },
      } as Record<string, unknown>,
      workbox: {
        // mermaid / Marp / KaTeX（フォント含む）/ Shiki の遅延チャンクもすべてプリキャッシュする
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2,webmanifest}'],
        maximumFileSizeToCacheInBytes: 10 * 1024 * 1024,
        navigateFallback: `${base}index.html`,
        cleanupOutdatedCaches: true,
      },
      devOptions: {
        enabled: false,
      },
    }),
  ],
})
