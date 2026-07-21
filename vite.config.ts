import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: "prompt",
      includeAssets: ["setwise-mark.svg"],
      manifest: {
        name: "Setwise",
        short_name: "Setwise",
        description: "Setwise testnet trading and portfolio prototype",
        start_url: "/sets",
        scope: "/",
        display: "standalone",
        background_color: "#090d18",
        theme_color: "#090d18",
        icons: [
          {
            src: "/setwise-mark.svg",
            sizes: "any",
            type: "image/svg+xml",
            purpose: "any maskable"
          }
        ]
      },
      workbox: {
        navigateFallback: "/index.html",
        // RFQ and firm-quote POSTs are intentionally unmatched, so Workbox never
        // stores indicative responses or executable transaction calldata.
        runtimeCaching: []
      }
    })
  ]
});
