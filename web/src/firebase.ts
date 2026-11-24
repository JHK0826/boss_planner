import { initializeApp } from "firebase/app";
import { connectAuthEmulator, getAuth } from "firebase/auth";
import {
  connectFirestoreEmulator,
  initializeFirestore,
  memoryLocalCache,
  persistentLocalCache,
  persistentMultipleTabManager,
} from "firebase/firestore";
import { connectFunctionsEmulator, getFunctions } from "firebase/functions";
import { connectStorageEmulator, getStorage } from "firebase/storage";

const env = import.meta.env;
export const usingEmulators = env.VITE_USE_EMULATORS === "true";

/** 웹 설정값이 비어 있으면 화면에 설정 안내를 보여 준다. */
export const configured = usingEmulators || !!env.VITE_FIREBASE_API_KEY;

export const app = initializeApp(
  usingEmulators
    ? { apiKey: "demo-key", projectId: "demo-boss-planner", appId: "demo-app", storageBucket: "demo-boss-planner.appspot.com" }
    : {
        apiKey: env.VITE_FIREBASE_API_KEY,
        authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
        projectId: env.VITE_FIREBASE_PROJECT_ID,
        storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET,
        messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID,
        appId: env.VITE_FIREBASE_APP_ID,
      },
);

export const auth = getAuth(app);
// 한 번 읽은 문서는 기기에 남겨 두어 다시 열 때 빨리 보이고 읽기도 줄인다(여러 탭에서 같이 씀).
export const db = initializeFirestore(app, {
  localCache: usingEmulators ? memoryLocalCache() : persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
});
// Cloud Functions는 서울 리전에 있다 (Android 앱과 같음).
export const functions = getFunctions(app, "asia-northeast3");
export const storage = getStorage(app);

if (usingEmulators) {
  connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
  connectFirestoreEmulator(db, "127.0.0.1", 8080);
  connectFunctionsEmulator(functions, "127.0.0.1", 5001);
  connectStorageEmulator(storage, "127.0.0.1", 9199);
}
