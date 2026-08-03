import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import path from 'node:path';

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const backendTarget = env.VITE_API_TARGET || 'http://localhost:3010';

  // Base path для развёртывания на под-пути (например `/v2/` для staging).
  // По умолчанию — корень. При production-билде передаётся через `BASE_PATH=/v2/ npm run build`.
  // Должен начинаться и заканчиваться слешем.
  const basePath = process.env['BASE_PATH'] || '/';

  return {
    base: basePath,
    plugins: [
      react(),
      VitePWA({
        // autoUpdate: новый SW сразу активируется при загрузке без prompt.
        // Это значит пользователь всегда получает свежую версию при
        // следующем открытии приложения. Для медтрекера это важно —
        // не хочется объяснять "нажми обновить" каждый раз.
        registerType: 'autoUpdate',
        includeAssets: [
          'favicon.ico',
          'icons/icon.svg',
          'icons/apple-touch-icon.png',
          'icons/icon-192.png',
          'icons/icon-512.png',
        ],
        manifest: {
          name: 'Anamnesis',
          short_name: 'Anamnesis',
          description: 'AI-coordinated medical records tracker',
          theme_color: '#791CE7',
          background_color: '#F2F2F7',
          display: 'standalone',
          orientation: 'portrait',
          start_url: basePath,
          scope: basePath,
          icons: [
            { src: `${basePath}icons/icon-192.png`, sizes: '192x192', type: 'image/png', purpose: 'any' },
            { src: `${basePath}icons/icon-512.png`, sizes: '512x512', type: 'image/png', purpose: 'any' },
            { src: `${basePath}icons/apple-touch-icon.png`, sizes: '180x180', type: 'image/png' },
            { src: `${basePath}icons/icon.svg`, sizes: 'any', type: 'image/svg+xml', purpose: 'any maskable' },
          ],
        },
        workbox: {
          // skipWaiting + clientsClaim — новый SW сразу берёт контроль
          // над открытыми вкладками, не ждёт их закрытия. В паре с
          // registerType: 'autoUpdate' даёт мгновенный апдейт.
          skipWaiting: true,
          clientsClaim: true,
          // cleanupOutdatedCaches удаляет старые кэши при активации нового SW.
          // Критично после изменений runtimeCaching — иначе старые cache-first
          // кэши продолжают жить со битыми ответами.
          cleanupOutdatedCaches: true,
          globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
          maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
          navigateFallback: '/index.html',
          // Явно не перехватывать /uploads/* — эти файлы должны идти прямо
          // в сеть без SW-интерсепта. Иначе: 1) битый первый запрос
          // (502/504) кэшируется навсегда, 2) window.open в PWA standalone
          // может получить stale response из SW кэша.
          navigateFallbackDenylist: [/^\/uploads\//, /^\/api\//],
          runtimeCaching: [
            {
              // Не кэшируем запросы на скачивание файлов и экспорт
              urlPattern: ({ url }) => 
                url.pathname.startsWith('/api/') && 
                (url.pathname.endsWith('/file') || url.pathname.includes('/export/')),
              handler: 'NetworkOnly',
            },
            {
              urlPattern: ({ url }) => 
                url.pathname.startsWith('/api/') && 
                !url.pathname.endsWith('/file') && 
                !url.pathname.includes('/export/'),
              handler: 'NetworkFirst',
              options: {
                // v3: patient-scoped cache keys (family multi-patient)
                cacheName: 'api-cache-v3',
                networkTimeoutSeconds: 3,
                expiration: {
                  maxEntries: 200,
                  // Shorter TTL — medical data should not stick offline for a week
                  maxAgeSeconds: 60 * 60,
                },
                // ТОЛЬКО 200 — не кэшируем opaque/errors (статус 0).
                cacheableResponse: { statuses: [200] },
                // Include X-Patient-Id in cache key so patient A/B responses never mix
                plugins: [
                  {
                    cacheKeyWillBeUsed: async ({ request }) => {
                      const pid = request.headers.get('X-Patient-Id') || '0';
                      return `${request.url}::patient=${pid}`;
                    },
                  },
                ],
              },
            },
            // /uploads/* НЕ в runtimeCaching — браузер запрашивает их
            // напрямую через fetch/img src, минуя SW. Для оффлайн-режима
            // документы и так не нужны (всё равно нужен доступ к сети
            // для просмотра большого файла).
            {
              urlPattern: ({ url }) => url.origin === 'https://fonts.googleapis.com',
              handler: 'StaleWhileRevalidate',
              options: { cacheName: 'google-fonts-css-v2' },
            },
            {
              urlPattern: ({ url }) => url.origin === 'https://fonts.gstatic.com',
              handler: 'CacheFirst',
              options: {
                cacheName: 'google-fonts-webfonts-v2',
                expiration: { maxEntries: 30, maxAgeSeconds: 60 * 60 * 24 * 365 },
              },
            },
          ],
        },
        devOptions: { enabled: false },
      }),
    ],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
      },
    },
    server: {
      port: 5173,
      host: true,
      proxy: {
        '/api': { target: backendTarget, changeOrigin: true },
        '/uploads': { target: backendTarget, changeOrigin: true },
      },
    },
    build: {
      target: 'es2022',
      sourcemap: true,
      rollupOptions: {
        output: {
          manualChunks: {
            react: ['react', 'react-dom', 'react-router'],
            query: ['@tanstack/react-query', '@tanstack/react-query-persist-client'],
            motion: ['motion', '@use-gesture/react'],
            dnd: ['@dnd-kit/core', '@dnd-kit/sortable', '@dnd-kit/utilities'],
          },
        },
      },
    },
  };
});
