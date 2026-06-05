import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import tailwindcss from "@tailwindcss/vite";

// https://vitejs.dev/config/
const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react(), tailwindcss()],
  base: "/app/",
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    proxy: {
      // 將 API requests proxy 到 backend server
      "/api": {
        target: "http://127.0.0.1:8000", // 預設 backend address
        changeOrigin: true,
        // 如有需要可 rewrite path，例如 backend 不接受 /api prefix 時移除它
        // rewrite: (path) => path.replace(/^\/api/, ''),
      },
    },
  },
});
