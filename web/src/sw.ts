/// <reference lib="webworker" />
// 서비스 워커: 앱 파일을 기기에 저장해 두고(오프라인·빠른 시작), Firebase 알림을 받아 띄운다.
import { initializeApp } from "firebase/app";
import { getMessaging } from "firebase/messaging/sw";
import { clientsClaim } from "workbox-core";
import { cleanupOutdatedCaches, createHandlerBoundToURL, precacheAndRoute } from "workbox-precaching";
import { NavigationRoute, registerRoute } from "workbox-routing";
import { firebaseConfig, usingEmulators } from "./firebase-config";

declare let self: ServiceWorkerGlobalScope;

// 새 버전이 나오면 바로 바꿔 끼운다 (registerType: autoUpdate).
self.skipWaiting();
clientsClaim();

precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();
// 어느 주소로 열어도 앱 화면(index.html)을 준다. Firebase 예약 경로(/__/)는 빼고.
registerRoute(new NavigationRoute(createHandlerBoundToURL("index.html"), { denylist: [/^\/__\//] }));

// 알림: notification이 담긴 메시지는 Firebase SDK가 알아서 띄우고, 누르면 서버가 붙인 링크(그 파티 화면)를 연다.
if (!usingEmulators && firebaseConfig.apiKey && firebaseConfig.messagingSenderId) {
  getMessaging(initializeApp(firebaseConfig));
}
