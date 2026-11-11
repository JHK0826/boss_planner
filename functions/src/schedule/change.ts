import { Timestamp, type Firestore } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/v2/https";
import { startOfKstDay } from "../domain/time";
import { releaseBusy, requireString } from "./confirm";
import { resetFields, type Confirmed } from "./model";

type Data = Record<string, unknown> | undefined | null;

/**
 * 확정된 일정의 변경을 요청한다. 레이드 전날 23:59(KST)까지만 받는다.
 * 마감은 기기 시계가 아니라 서버 시각(nowMs)으로 검사한다.
 */
export async function requestChange(db: Firestore, uid: string, data: Data, nowMs: number): Promise<void> {
  const partyId = requireString(data, "partyId");
  const periodId = requireString(data, "periodId");
  const reason = typeof data?.reason === "string" ? data.reason.trim().slice(0, 200) : "";
  const partyRef = db.doc(`parties/${partyId}`);
  const scheduleRef = partyRef.collection("schedules").doc(periodId);

  await db.runTransaction(async (tx) => {
    const [partySnap, scheduleSnap] = await Promise.all([tx.get(partyRef), tx.get(scheduleRef)]);
    const schedule = scheduleSnap.data();
    if (!schedule || !(partySnap.get("memberUids") as string[] | undefined)?.includes(uid)) {
      throw new HttpsError("permission-denied", "가입한 파티가 아닙니다.", { reason: "not-member" });
    }
    if (schedule.state !== "LOCKED") {
      throw new HttpsError("failed-precondition", "확정된 일정만 변경을 요청할 수 있습니다.", { reason: "not-locked" });
    }
    if (schedule.changeRequest?.status === "PENDING") {
      throw new HttpsError("already-exists", "이미 처리 대기 중인 변경 요청이 있습니다.", { reason: "already-requested" });
    }
    if (nowMs >= startOfKstDay((schedule.confirmed as Confirmed).start.toMillis())) {
      throw new HttpsError("failed-precondition", "변경 요청은 레이드 전날 23:59까지만 할 수 있습니다.", {
        reason: "deadline-passed",
      });
    }
    tx.update(scheduleRef, {
      changeRequest: { requestedBy: uid, reason, requestedAt: Timestamp.now(), status: "PENDING" },
      updatedAt: Timestamp.now(),
    });
  });
}

/**
 * 파티장이 변경 요청을 승인하거나 거절한다.
 * 승인하면 확정 시간을 풀고 OPEN으로 돌아간다. 요청한 사람은 불가 시간을 다시 제출해야
 * 새 추천이 나온다(그대로 두면 같은 시간이 다시 추천되기 때문이다).
 */
export async function approveChange(
  db: Firestore,
  uid: string,
  data: Data,
  nowMs: number,
): Promise<{ approved: boolean }> {
  const partyId = requireString(data, "partyId");
  const periodId = requireString(data, "periodId");
  const approve = data?.approve !== false;
  const partyRef = db.doc(`parties/${partyId}`);
  const scheduleRef = partyRef.collection("schedules").doc(periodId);

  await db.runTransaction(async (tx) => {
    const [partySnap, scheduleSnap] = await Promise.all([tx.get(partyRef), tx.get(scheduleRef)]);
    const schedule = scheduleSnap.data();
    if (!schedule || partySnap.get("leaderUid") !== uid) {
      throw new HttpsError("permission-denied", "파티장만 변경 요청을 처리할 수 있습니다.", { reason: "not-leader" });
    }
    const request = schedule.changeRequest;
    if (schedule.state !== "LOCKED" || request?.status !== "PENDING") {
      throw new HttpsError("failed-precondition", "처리할 변경 요청이 없습니다.", { reason: "no-request" });
    }
    const responded = { ...request, respondedAt: Timestamp.now() };
    if (!approve) {
      tx.update(scheduleRef, { changeRequest: { ...responded, status: "REJECTED" }, updatedAt: Timestamp.now() });
      return;
    }
    if (nowMs >= (schedule.confirmed as Confirmed).start.toMillis()) {
      throw new HttpsError("failed-precondition", "레이드가 이미 시작되어 변경할 수 없습니다.", {
        reason: "raid-started",
      });
    }
    releaseBusy(tx, db, schedule);
    tx.update(scheduleRef, {
      ...resetFields(schedule.round as number),
      state: "OPEN",
      changeRequest: { ...responded, status: "APPROVED" },
    });
    tx.set(
      scheduleRef.collection("unavailable").doc(request.requestedBy as string),
      { submitted: false },
      { merge: true },
    );
  });
  return { approved: approve };
}
