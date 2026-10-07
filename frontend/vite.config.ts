import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (
            id.includes("/node_modules/recharts/") ||
            id.includes("/node_modules/d3-")
          )
            return "charts";
        },
      },
    },
  },
  server: {
    proxy: {
      "/api": {
        target: process.env.VITE_PROXY_TARGET || "http://localhost:8000",
        configure: (proxy) =>
          proxy.on("proxyReq", (proxyReq, req) => {
            // Preserve the browser-facing authority for the API's same-origin check.
            if (req.headers.host) proxyReq.setHeader("Host", req.headers.host);
          }),
      },
    },
    allowedHosts: [
      "boogieman-amicably-napped.ngrok-free.dev",
      "waymark.nishly.xyz",
    ],
  },
});
