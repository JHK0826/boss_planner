import { Timestamp, type Firestore } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/v2/https";
import { requireString } from "../schedule/confirm";
import type { Confirmed } from "../schedule/model";

type Data = Record<string, unknown> | undefined | null;

/** 메소 최대 입력값. 실수로 자릿수를 더 넣는 것을 막는 용도다. */
export const MAX_AMOUNT = 1_000_000_000_000;

function refs(db: Firestore, data: Data) {
  const partyId = requireString(data, "partyId");
  const periodId = requireString(data, "periodId");
  const scheduleRef = db.doc(`parties/${partyId}/schedules/${periodId}`);
  return { scheduleRef, settlementRef: scheduleRef.collection("settlement") };
}

/**
 * 드롭 아이템을 판매한 파티원이 1인 분배금을 등록한다.
 *
 * 한 일정에는 판매자 1명, 금액 1건만 담는다. 받을 사람마다 settlement/{uid} 문서를 만든다.
 * (지금은 전원 같은 금액이지만, 문서가 사람별이라 나중에 배율 조정을 넣을 수 있다.)
 * 아직 아무에게도 지급하지 않았다면 판매자가 금액을 고쳐 다시 등록할 수 있다.
 */
export async function registerSettlement(db: Firestore, uid: string, data: Data): Promise<{ recipients: number }> {
  const { scheduleRef, settlementRef } = refs(db, data);
  const amount = data?.amountPerPerson;
  if (typeof amount !== "number" || !Number.isInteger(amount) || amount <= 0 || amount > MAX_AMOUNT) {
    throw new HttpsError("invalid-argument", "분배금은 1 이상의 정수(메소)여야 합니다.", { field: "amountPerPerson" });
  }

  return db.runTransaction(async (tx) => {
    const schedule = (await tx.get(scheduleRef)).data();
    const participants = (schedule?.confirmed as Confirmed | null)?.memberUids ?? [];
    if (!schedule || !participants.includes(uid)) {
      throw new HttpsError("permission-denied", "이 레이드에 참여한 파티원만 등록할 수 있습니다.", { reason: "not-member" });
    }
    if (schedule.state !== "SETTLED") {
      throw new HttpsError("failed-precondition", "클리어한 일정에만 분배금을 등록할 수 있습니다.", { reason: "not-settled" });
    }
    const existing = schedule.settlement;
    if (existing) {
      if (existing.sellerUid !== uid) {
        throw new HttpsError("already-exists", "다른 파티원이 이미 분배금을 등록했습니다.", { reason: "already-registered" });
      }
      const docs = await tx.get(settlementRef);
      if (docs.docs.some((doc) => doc.get("status") !== "PENDING")) {
        throw new HttpsError("failed-precondition", "이미 지급을 시작해서 금액을 바꿀 수 없습니다.", { reason: "already-paid" });
      }
    }

    const recipients = participants.filter((member) => member !== uid);
    for (const recipient of recipients) {
      tx.set(settlementRef.doc(recipient), { amount, status: "PENDING", paidAt: null, receivedAt: null });
    }
    const now = Timestamp.now();
    tx.update(scheduleRef, {
      settlement: {
        sellerUid: uid,
        amountPerPerson: amount,
        registeredAt: now,
        // 받을 사람이 없으면(1인 파티) 바로 끝난다.
        completed: recipients.length === 0,
        completedAt: recipients.length === 0 ? now : null,
      },
      updatedAt: now,
    });
    return { recipients: recipients.length };
  });
}

/** 판매자가 한 파티원에게 지급했다고 표시한다: 대기 → 지급함 */
export async function markPaid(db: Firestore, uid: string, data: Data): Promise<void> {
  const { scheduleRef, settlementRef } = refs(db, data);
  const recipientRef = settlementRef.doc(requireString(data, "recipientUid"));

  await db.runTransaction(async (tx) => {
    const [scheduleSnap, recipientSnap] = await Promise.all([tx.get(scheduleRef), tx.get(recipientRef)]);
    if (scheduleSnap.get("settlement.sellerUid") !== uid) {
      throw new HttpsError("permission-denied", "분배금을 등록한 판매자만 지급 처리할 수 있습니다.", { reason: "not-seller" });
    }
    if (recipientSnap.get("status") !== "PENDING") {
      throw new HttpsError("failed-precondition", "지급 대기 중인 파티원이 아닙니다.", { reason: "not-pending" });
    }
    tx.update(recipientRef, { status: "PAID", paidAt: Timestamp.now() });
  });
}

/** 받은 사람이 수령을 확인한다: 지급함 → 수령 확인. 전원이 확인하면 정산이 완료된다. */
export async function confirmReceived(db: Firestore, uid: string, data: Data): Promise<{ completed: boolean }> {
  const { scheduleRef, settlementRef } = refs(db, data);

  return db.runTransaction(async (tx) => {
    const all = await tx.get(settlementRef);
    const mine = all.docs.find((doc) => doc.id === uid);
    if (!mine) {
      throw new HttpsError("permission-denied", "분배금을 받을 파티원이 아닙니다.", { reason: "not-recipient" });
    }
    if (mine.get("status") !== "PAID") {
      throw new HttpsError("failed-precondition", "판매자가 지급함으로 표시한 뒤에 수령을 확인할 수 있습니다.", {
        reason: "not-paid",
      });
    }
    const now = Timestamp.now();
    tx.update(mine.ref, { status: "RECEIVED", receivedAt: now });
    const completed = all.docs.every((doc) => doc.id === uid || doc.get("status") === "RECEIVED");
    if (completed) {
      tx.update(scheduleRef, { "settlement.completed": true, "settlement.completedAt": now, updatedAt: now });
    }
    return { completed };
  });
}
