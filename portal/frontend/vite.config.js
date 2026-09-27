import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  base: "/",
  build: {
    outDir: "dist",
    emptyOutDir: true,
    target: ["chrome100", "firefox100", "safari15", "edge100"],
    assetsDir: "assets",
  },
  server: {
    port: 5173,
    // Local development: run the API with PORTAL_ENV=dev (see README)
    proxy: {
      "/api": "http://127.0.0.1:3000",
    },
  },
});
