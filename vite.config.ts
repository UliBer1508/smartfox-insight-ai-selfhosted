import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";
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
    mode === "development" && componentTagger()
  ].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
}));
