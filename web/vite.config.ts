/// <reference types="vitest/config" />
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

// 앱 버전은 저장소 최상위의 version.properties 한 곳에서 관리한다 (Android 앱과 같은 번호).
const versionName =
  readFileSync(new URL("../version.properties", import.meta.url), "utf8").match(/^versionName=(.+)$/m)?.[1] ?? "?";

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(versionName),
  },
  resolve: {
    alias: {
      // 서버(Cloud Functions)의 순수 계산 코드를 그대로 쓴다: 주기·칸 ID, 분배금 계산, 보스 타입.
      "@shared": fileURLToPath(new URL("../functions/src", import.meta.url)),
    },
  },
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      // 알림(Firebase Cloud Messaging)을 받으려고 서비스 워커를 직접 쓴다: src/sw.ts
      strategies: "injectManifest",
      srcDir: "src",
      filename: "sw.ts",
      injectManifest: {
        // Firebase SDK가 들어 있어 기본 한도(2MB)를 넘을 수 있다.
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
      },
      includeAssets: ["icon.svg", "apple-touch-icon.png"],
      manifest: {
        name: "보스 스케줄 매니저",
        short_name: "보스 플래너",
        description: "메이플스토리 고정 파티 보스 일정 조율과 정산",
        lang: "ko",
        start_url: "/",
        display: "standalone",
        background_color: "#5B4B8A",
        theme_color: "#5B4B8A",
        icons: [
          { src: "icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "icon-512.png", sizes: "512x512", type: "image/png" },
          { src: "icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
    }),
  ],
  build: {
    // Firebase SDK가 대부분이라 크다. 서비스 워커가 기기에 저장해 두므로 처음 한 번만 받는다.
    chunkSizeWarningLimit: 1200,
  },
  test: {
    include: ["test/**/*.test.ts"],
  },
});
