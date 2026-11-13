import type { DocumentData, DocumentSnapshot, Firestore } from "firebase-admin/firestore";
import { Timestamp } from "firebase-admin/firestore";
import { getMessaging, type MulticastMessage } from "firebase-admin/messaging";
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
      const result = await sender.sendEachForMulticast({
        tokens: devices.map((doc) => doc.id),
        notification: { title: push.title, body: push.body },
        data: { partyId: push.partyId },
        android: { notification: { channelId: "schedule" } },
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
    pushes.push(...missingInputNotifications(party, party.memberUids.filter((uid) => !submitted.has(uid))));
  }
  return sendPushes(db, pushes, sender);
}
