// 웹앱 대표 주소로 옮기기. 예전 주소(https://<프로젝트 ID>.web.app)로 열면 같은 경로의 새 주소로 보낸다.
// 로그인·알림·다크 모드는 주소마다 따로 저장되므로, 옛 주소의 알림 등록은 지우고 옮긴다(알림이 두 번 오지 않게).
import { onAuth } from "../data/api";
import { disablePush, pushEnabled } from "./push";

/** web/.env.local의 VITE_WEB_APP_URL. 비어 있으면 옮기지 않는다. */
const CANONICAL_URL = ((import.meta.env.VITE_WEB_APP_URL as string | undefined) ?? "").trim();

/**
 * 옮길 주소. 이미 대표 주소이거나, Firebase Hosting 주소(*.web.app, *.firebaseapp.com)가 아니면(개발 서버 등) null.
 */
export function canonicalTarget(href: string, canonicalUrl: string = CANONICAL_URL): string | null {
  if (!canonicalUrl) return null;
  let current: URL;
  let target: URL;
  try {
    current = new URL(href);
    target = new URL(canonicalUrl);
  } catch {
    return null;
  }
  if (current.origin === target.origin) return null;
  if (!/\.(web\.app|firebaseapp\.com)$/.test(current.hostname)) return null;
  return `${target.origin}${current.pathname}${current.search}${current.hash}`;
}

/** 로그인 상태를 한 번 기다린다 (최대 3초) */
function currentUid(): Promise<string | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), 3000);
    const unsubscribe = onAuth((uid) => {
      clearTimeout(timer);
      unsubscribe();
      resolve(uid);
    });
  });
}

/** 옮겨야 하면 정리하고 옮긴 뒤 true. 옮길 필요가 없으면 false */
export async function moveToCanonical(): Promise<boolean> {
  const target = canonicalTarget(location.href);
  if (!target) return false;
  document.body.textContent = "새 주소로 옮기는 중…";
  try {
    if (pushEnabled()) {
      const uid = await currentUid();
      if (uid) await disablePush(uid);
    }
    // 옛 주소의 서비스 워커가 남아 알림을 받거나 예전 화면을 보여 주지 않게 지운다.
    const registrations = (await navigator.serviceWorker?.getRegistrations()) ?? [];
    await Promise.all(registrations.map((r) => r.unregister()));
  } catch {
    // 정리에 실패해도 옮긴다.
  }
  location.replace(target);
  return true;
}
