import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// base "./" makes the build work from any sub-path, e.g. https://<user>.github.io/<repo>/
export default defineConfig({
  base: "./",
  plugins: [react()],
  build: {
    target: "es2022",
    chunkSizeWarningLimit: 1500,
  },
  worker: { format: "es" },
});
