import type { DocumentData, DocumentSnapshot, Firestore } from "firebase-admin/firestore";
import { Timestamp } from "firebase-admin/firestore";
import { getMessaging, type MulticastMessage } from "firebase-admin/messaging";
import { activeMemberUids, type MercenaryLike } from "../domain/mercenary";
import { missingInputNotifications, type PartyInfo, type Push } from "./messages";

/** FCM 발송부. 테스트에서 바꿔 끼울 수 있게 필요한 메서드만 받는다. */
export interface Sender {
  sendEachForMulticast(message: MulticastMessage): Promise<{ responses: { success: boolean; error?: { code: string } }[] }>;
}

const INVALID_TOKEN_CODES = new Set([
  "messaging/registration-token-not-registered",
  "messaging/invalid-registration-token",
  "messaging/invalid-argument",
]);

export function toPartyInfo(snapshot: DocumentSnapshot): PartyInfo | null {
  const data = snapshot.data();
  if (!data) return null;
  return {
    id: snapshot.id,
    name: (data.name as string) ?? "",
    leaderUid: data.leaderUid as string,
    memberUids: (data.memberUids as string[]) ?? [],
    members: data.members as PartyInfo["members"],
  };
}

/**
 * 웹앱 주소. functions/.env의 WEB_APP_URL(예: https://bossplanner.web.app)을 쓰고,
 * 없으면 Firebase Hosting 기본 도메인(https://<프로젝트 ID>.web.app). 둘 다 모르면(로컬 실행 등) undefined.
 */
export function webAppUrl(env: Record<string, string | undefined> = process.env): string | undefined {
  const configured = env.WEB_APP_URL?.trim().replace(/\/+$/, "");
  if (configured) return configured;
  return env.GCLOUD_PROJECT ? `https://${env.GCLOUD_PROJECT}.web.app` : undefined;
}

/** 웹앱(아이폰·PC)에서 알림을 눌렀을 때 열 그 파티 화면 주소 */
export function webPartyLink(partyId: string, baseUrl: string | undefined = webAppUrl()): string | undefined {
  return baseUrl ? `${baseUrl}/parties/${encodeURIComponent(partyId)}` : undefined;
}

/**
 * 알림을 보낸다. 토큰은 users/{uid}/devices 문서 ID다.
 * 더 이상 유효하지 않은 토큰은 지운다. 알림 실패가 본 작업을 막지 않도록 예외를 던지지 않는다.
 */
export async function sendPushes(db: Firestore, pushes: Push[], sender: Sender = getMessaging()): Promise<number> {
  let sent = 0;
  for (const push of pushes) {
    try {
      const deviceSnaps = await Promise.all(push.uids.map((uid) => db.collection(`users/${uid}/devices`).get()));
      const devices = deviceSnaps.flatMap((snap) => snap.docs);
      if (devices.length === 0) continue;
      const link = webPartyLink(push.partyId);
      const result = await sender.sendEachForMulticast({
        tokens: devices.map((doc) => doc.id),
        notification: { title: push.title, body: push.body },
        data: { partyId: push.partyId },
        android: { notification: { channelId: "schedule" } },
        // 웹앱 토큰: 알림을 누르면 그 파티 화면을 연다. Android 토큰에는 쓰이지 않는다.
        ...(link ? { webpush: { fcmOptions: { link } } } : {}),
      });
      await Promise.all(
        result.responses.map((response, index) => {
          if (response.success) {
            sent++;
            return null;
          }
          return response.error && INVALID_TOKEN_CODES.has(response.error.code) ? devices[index].ref.delete() : null;
        }),
      );
    } catch (error) {
      console.error("push failed", (error as Error).message);
    }
  }
  return sent;
}

/**
 * 매일 00:00: 입력 마감(주기 시작일 23:59)이 지났는데 제출하지 않은 파티원과 그 파티장에게 알린다.
 */
export async function runInputDeadlineCheck(db: Firestore, nowMs: number, sender?: Sender): Promise<number> {
  const open = await db.collectionGroup("schedules").where("state", "==", "OPEN").get();
  const pushes: Push[] = [];
  for (const doc of open.docs) {
    const schedule: DocumentData = doc.data();
    if ((schedule.inputDeadline as Timestamp).toMillis() > nowMs) continue;
    const party = toPartyInfo(await doc.ref.parent.parent!.get());
    if (!party) continue;
    const unavailable = await doc.ref.collection("unavailable").get();
    const submitted = new Set(unavailable.docs.filter((d) => d.get("submitted") === true).map((d) => d.id));
    // 용병으로 대체한 사람은 입력하지 않아도 된다.
    const active = activeMemberUids(party.memberUids, schedule.mercenaries as MercenaryLike[] | undefined);
    pushes.push(...missingInputNotifications(party, active.filter((uid) => !submitted.has(uid))));
  }
  return sendPushes(db, pushes, sender);
}
