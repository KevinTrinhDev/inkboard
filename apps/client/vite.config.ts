import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      manifest: {
        name: "inkboard",
        short_name: "inkboard",
        description: "Semantic teaching board for iPad + facecam recording.",
        start_url: "/",
        display: "standalone",
        background_color: "#1a1a1a",
        theme_color: "#1a1a1a",
        icons: [
          { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
        ],
      },
    }),
  ],
  server: {
    // Dev server binds to the LAN interface too, but real usage goes
    // through Caddy's local HTTPS — see infra/caddy/README.md.
    host: "127.0.0.1",
    port: 5173,
  },
  build: {
    rollupOptions: {
      output: {
        // tldraw and katex are by far the two largest dependencies and
        // change far less often than app code — splitting them into their
        // own vendor chunks lets the browser cache them across app deploys
        // instead of re-downloading everything on every build.
        manualChunks: {
          tldraw: ["tldraw"],
          katex: ["katex"],
        },
      },
    },
  },
});
