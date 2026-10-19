import { defineConfig } from "vite";
import tailwindcss from "@tailwindcss/vite";
import { themeCSS } from "./src/lib/design-tokens.ts";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig(async ({ mode, command }) => ({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      ...(command === "serve" && mode === "fixture"
        ? {
            "@tauri-apps/api/core": fileURLToPath(
              new URL("./tests/fixtures/backend.ts", import.meta.url),
            ),
            "@tauri-apps/plugin-dialog": fileURLToPath(
              new URL("./tests/fixtures/backend.ts", import.meta.url),
            ),
          }
        : {}),
    },
  },
  plugins: [
    react(),
    tailwindcss(),
    {
      name: "branchlight-tokens",
      transformIndexHtml: () => [
        {
          tag: "style",
          attrs: { id: "design-tokens" },
          children: themeCSS(),
          injectTo: "head",
        },
      ],
    },
  ],

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: mode === "fixture" ? 1438 : 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
}));
