// 웹 푸시 알림 (Android push/Push.kt와 같은 저장 방식: users/{uid}/devices/{토큰}).
// 아이폰은 iOS 16.4 이상에서 홈 화면에 추가한 앱으로 열었을 때만 알림을 받을 수 있고, 권한은 버튼을 눌렀을 때만 물을 수 있다.
import { deleteToken, getMessaging, getToken, isSupported, type Messaging, onMessage } from "firebase/messaging";
import * as api from "../data/api";
import { app, usingEmulators } from "../firebase";
import { firebaseConfig, vapidKey } from "../firebase-config";

const TOKEN_KEY = "push_token";

export type PushAvailability =
  | "available"
  /** 아이폰 Safari에서 그냥 연 경우: 홈 화면에 추가해야 한다 */
  | "needs-install"
  | "unsupported"
  /** VAPID 키가 설정되지 않았다 */
  | "not-configured";

const isIos = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const isStandalone = () =>
  window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;

let messagingPromise: Promise<Messaging | null> | null = null;
/** 알림을 쓸 수 없는 환경(에뮬레이터, 설정값 없음, 지원하지 않는 브라우저)이면 null */
function messaging(): Promise<Messaging | null> {
  messagingPromise ??=
    usingEmulators || !vapidKey || !("messagingSenderId" in firebaseConfig) || !firebaseConfig.messagingSenderId
      ? Promise.resolve(null)
      : isSupported().then((ok) => (ok ? getMessaging(app) : null)).catch(() => null);
  return messagingPromise;
}

export async function pushAvailability(): Promise<PushAvailability> {
  if (usingEmulators || !vapidKey) return "not-configured";
  if (isIos() && !isStandalone()) return "needs-install";
  if (!("Notification" in window) || !("serviceWorker" in navigator) || !(await messaging())) return "unsupported";
  return "available";
}

/** 이 기기에서 알림을 받기로 했는가 (권한이 있고 토큰을 저장해 둠) */
export function pushEnabled(): boolean {
  try {
    return "Notification" in window && Notification.permission === "granted" && !!localStorage.getItem(TOKEN_KEY);
  } catch {
    return false;
  }
}

class PushError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UserFacingError";
  }
}

async function currentToken(m: Messaging): Promise<string> {
  const registration = await navigator.serviceWorker.ready;
  return getToken(m, { vapidKey, serviceWorkerRegistration: registration });
}

async function store(uid: string, token: string) {
  let previous: string | null = null;
  try {
    previous = localStorage.getItem(TOKEN_KEY);
    localStorage.setItem(TOKEN_KEY, token);
  } catch {
    // 저장하지 못해도 알림은 온다. 다음에 다시 저장한다.
  }
  await api.saveDeviceToken(uid, token);
  // 토큰이 바뀌었으면 예전 토큰으로는 보내지 않게 지운다.
  if (previous && previous !== token) await api.deleteDeviceToken(uid, previous).catch(() => {});
}

/** "알림 켜기" 버튼: 권한을 묻고 이 기기의 토큰을 저장한다. 반드시 버튼을 누른 순간에 불러야 한다(아이폰 규칙). */
export async function enablePush(uid: string): Promise<void> {
  const m = await messaging();
  if (!m) throw new PushError("이 브라우저에서는 알림을 받을 수 없습니다.");
  const permission = await Notification.requestPermission();
  if (permission !== "granted") throw new PushError("알림이 허용되지 않았습니다. 휴대폰 설정에서 이 앱의 알림을 허용해 주세요.");
  await store(uid, await currentToken(m));
}

/** 앱을 열 때: 이미 켜 둔 기기라면 토큰이 바뀌었을 수 있으니 다시 저장한다. */
export async function refreshPush(uid: string): Promise<void> {
  if (!pushEnabled() || (await pushAvailability()) !== "available") return;
  const m = await messaging();
  if (m) await store(uid, await currentToken(m));
}

/** "알림 끄기"와 로그아웃: 이 기기로 알림이 가지 않게 토큰을 지운다. */
export async function disablePush(uid: string): Promise<void> {
  let token: string | null = null;
  try {
    token = localStorage.getItem(TOKEN_KEY);
    localStorage.removeItem(TOKEN_KEY);
  } catch {
    // 무시
  }
  if (!token) return;
  await api.deleteDeviceToken(uid, token).catch(() => {});
  const m = await messaging();
  if (m) await deleteToken(m).catch(() => {});
}

/** 앱을 보고 있을 때 온 알림은 시스템 알림 대신 화면 아래에 잠깐 보여 준다. */
export function onForegroundPush(show: (text: string) => void): () => void {
  let unsubscribe: (() => void) | null = null;
  let cancelled = false;
  void messaging().then((m) => {
    if (!m || cancelled) return;
    unsubscribe = onMessage(m, (payload) => {
      const { title, body } = payload.notification ?? {};
      if (title || body) show([title, body].filter(Boolean).join(" · "));
    });
  });
  return () => {
    cancelled = true;
    unsubscribe?.();
  };
}
