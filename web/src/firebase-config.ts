// Firebase 웹 설정값. 앱과 서비스 워커(알림)가 같이 쓴다. 값은 web/.env.local에서 빌드할 때 들어간다.
const env = import.meta.env;
export const usingEmulators = env.VITE_USE_EMULATORS === "true";

export const firebaseConfig = usingEmulators
  ? { apiKey: "demo-key", projectId: "demo-boss-planner", appId: "demo-app", storageBucket: "demo-boss-planner.appspot.com" }
  : {
      apiKey: env.VITE_FIREBASE_API_KEY as string | undefined,
      authDomain: env.VITE_FIREBASE_AUTH_DOMAIN as string | undefined,
      projectId: env.VITE_FIREBASE_PROJECT_ID as string | undefined,
      storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET as string | undefined,
      messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID as string | undefined,
      appId: env.VITE_FIREBASE_APP_ID as string | undefined,
    };

/** 웹 푸시용 VAPID 키. 비어 있으면 알림 켜기를 막고 안내한다. */
export const vapidKey = (env.VITE_FIREBASE_VAPID_KEY as string | undefined) ?? "";
