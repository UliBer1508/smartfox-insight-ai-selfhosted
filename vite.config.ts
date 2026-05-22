import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";
import { VitePWA } from "vite-plugin-pwa";
import pkg from "./package.json" with { type: "json" };

const buildTime = new Date().toISOString();

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  define: {
    __BUILD_TIME__: JSON.stringify(buildTime),
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  server: {
    host: "::",
    port: 8080,
    proxy: {
      '/api/smartfox': {
        target: 'http://192.168.188.45',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/smartfox/, ''),
        secure: false,
      },
      '/api/fronius': {
        target: 'http://192.168.188.64',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/fronius/, ''),
        secure: false,
      },
    },
  },
  plugins: [
    react(),
    mode === "development" && componentTagger(),
    VitePWA({
      // Auto-update: neuer SW wird beim nächsten Reload aktiviert.
      // Wir triggern den Reload explizit in src/pwa/registerSW.ts.
      registerType: "autoUpdate",
      injectRegister: false, // wir registrieren manuell via virtual:pwa-register
      // In Dev/Preview-Iframes KEIN SW aktivieren (vermeidet Stale-Caching im Editor).
      devOptions: {
        enabled: false,
      },
      includeAssets: [
        "favicon.ico",
        "favicon-16x16.png",
        "favicon-32x32.png",
        "apple-touch-icon.png",
        "offline.html",
        "robots.txt",
      ],
      // Vorhandenes manifest.webmanifest nutzen – nicht überschreiben
      manifest: false,
      workbox: {
        // OAuth-Redirects niemals aus dem Cache bedienen
        navigateFallback: "index.html",
        navigateFallbackDenylist: [
          /^\/~oauth/,
          /^\/api\//,
          /^\/functions\//,
        ],
        cleanupOutdatedCaches: true,
        clientsClaim: true,
        skipWaiting: false, // wir entscheiden manuell, wann aktiviert wird
        globPatterns: ["**/*.{js,css,html,svg,png,ico,webmanifest,woff2}"],
        runtimeCaching: [
          {
            // HTML-Navigations: immer Netzwerk zuerst, damit neue Versionen ankommen
            urlPattern: ({ request }) => request.mode === "navigate",
            handler: "NetworkFirst",
            options: {
              cacheName: "html-pages",
              networkTimeoutSeconds: 3,
              expiration: { maxEntries: 20, maxAgeSeconds: 60 * 60 * 24 },
            },
          },
          {
            // Statische Assets aus dem Build (Hash im Namen → langlebig)
            urlPattern: ({ url }) => url.pathname.startsWith("/assets/"),
            handler: "StaleWhileRevalidate",
            options: {
              cacheName: "static-assets",
              expiration: { maxEntries: 200, maxAgeSeconds: 60 * 60 * 24 * 30 },
            },
          },
          {
            // Google Fonts CSS
            urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
            handler: "StaleWhileRevalidate",
            options: { cacheName: "google-fonts-stylesheets" },
          },
          {
            urlPattern: /^https:\/\/fonts\.gstatic\.com\/.*/i,
            handler: "CacheFirst",
            options: {
              cacheName: "google-fonts-webfonts",
              expiration: { maxEntries: 30, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            // Supabase REST/Functions/Auth/Storage: niemals offline-cachen
            urlPattern: /^https:\/\/.*\.supabase\.co\/.*/i,
            handler: "NetworkOnly",
          },
        ],
      },
    }),
  ].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
}));
