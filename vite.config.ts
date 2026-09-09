import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";

// GitHub Pages project site: https://xxxnaif-hub.github.io/ipa-translator/
export default defineConfig({
  base: "/ipa-translator/",
  plugins: [react()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  optimizeDeps: {
    exclude: ["@xenova/transformers"],
  },
  build: {
    target: "es2022",
    chunkSizeWarningLimit: 2000,
  },
  worker: {
    format: "es",
  },
});
