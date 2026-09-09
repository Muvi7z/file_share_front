import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const backendApiTarget = process.env.API_PROXY_TARGET || "http://192.168.1.140:5544";

export default defineConfig({
  plugins: [react()],
  server: {
    host: "0.0.0.0",
    port: 5173,
    proxy: {
      "/api": {
        target: backendApiTarget,
        changeOrigin: true
      }
    }
  }
});
