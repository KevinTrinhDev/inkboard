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
});
