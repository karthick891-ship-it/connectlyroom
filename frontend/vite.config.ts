import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// In development the Vite server proxies API, uploads and WebSocket traffic to FastAPI.
const target = process.env.VITE_PROXY_TARGET ?? "http://localhost:8000";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": target,
      "/files": target,
      "/ws": { target, ws: true },
    },
  },
  test: { environment: "node" },
});
