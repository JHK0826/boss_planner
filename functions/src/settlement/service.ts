import { Timestamp, type Firestore } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/v2/https";
import { requireString } from "../schedule/confirm";
import type { Confirmed } from "../schedule/model";
import { FEE_PERCENTS, MAX_SALE_AMOUNT, MAX_WEIGHT, computeSettlement } from "./calc";

type Data = Record<string, unknown> | undefined | null;

/** 1인 금액을 직접 넣던 예전 방식의 최대값 */
export const MAX_AMOUNT = 1_000_000_000_000;

function refs(db: Firestore, data: Data) {
  const partyId = requireString(data, "partyId");
  const periodId = requireString(data, "periodId");
  const scheduleRef = db.doc(`parties/${partyId}/schedules/${periodId}`);
  return { scheduleRef, settlementRef: scheduleRef.collection("settlement") };
}

interface Plan {
  amounts: Record<string, number>;
  /** 일정 문서의 settlement에 함께 저장할 계산 근거 */
  summary: Record<string, unknown>;
}

/**
 * 요청 값을 검사해 "받을 사람별 정산금"을 정하는 함수를 돌려준다.
 * 참여자 목록은 트랜잭션 안에서 읽으므로 계산은 그때 한다.
 */
function planner(uid: string, data: Data): (participants: string[]) => Plan {
  // 0.2.0 이하 앱: 1인 금액을 직접 넣는 방식
  if (data?.saleAmount === undefined && data?.amountPerPerson !== undefined) {
    const amount = data.amountPerPerson;
    if (typeof amount !== "number" || !Number.isInteger(amount) || amount <= 0 || amount > MAX_AMOUNT) {
      throw new HttpsError("invalid-argument", "분배금은 1 이상의 정수(메소)여야 합니다.", { field: "amountPerPerson" });
    }
    return (participants) => ({
      amounts: Object.fromEntries(participants.filter((member) => member !== uid).map((member) => [member, amount])),
      summary: { amountPerPerson: amount },
    });
  }

  const saleAmount = data?.saleAmount;
  const feePercent = data?.feePercent;
  if (typeof saleAmount !== "number" || !Number.isInteger(saleAmount) || saleAmount <= 0 || saleAmount > MAX_SALE_AMOUNT) {
    throw new HttpsError("invalid-argument", "경매장 판매액은 1 이상의 정수(메소)여야 합니다.", { field: "saleAmount" });
  }
  if (!FEE_PERCENTS.includes(feePercent as (typeof FEE_PERCENTS)[number])) {
    throw new HttpsError("invalid-argument", "수수료는 5% 또는 3%여야 합니다.", { field: "feePercent" });
  }
  const weights = (data?.weights ?? {}) as Record<string, unknown>;
  if (typeof weights !== "object" || Array.isArray(weights)) {
    throw new HttpsError("invalid-argument", "비율 값이 올바르지 않습니다.", { field: "weights" });
  }

  return (participants) => {
    const used: Record<string, number> = {};
    for (const member of participants) {
      const weight = weights[member] ?? 1;
      if (typeof weight !== "number" || !Number.isInteger(weight) || weight < 1 || weight > MAX_WEIGHT) {
        throw new HttpsError("invalid-argument", `비율은 1~${MAX_WEIGHT}의 정수여야 합니다.`, { field: "weights" });
      }
      used[member] = weight;
    }
    const result = computeSettlement({
      saleAmount,
      feePercent: feePercent as number,
      sellerUid: uid,
      participants,
      weights: used,
    });
    if (Object.values(result.amounts).some((amount) => amount <= 0)) {
      throw new HttpsError("invalid-argument", "판매액이 너무 적어 나눌 수 없습니다.", { field: "saleAmount" });
    }
    return {
      amounts: result.amounts,
      summary: {
        saleAmount,
        feePercent,
        netAmount: result.netAmount,
        sellerAmount: result.sellerAmount,
        weights: result.weights,
        // 전원 같은 금액일 때만 채운다. 0.2.0 이하 앱이 이 값을 보여 준다.
        amountPerPerson: result.uniform ? (Object.values(result.amounts)[0] ?? null) : null,
      },
    };
  };
}

/**
 * 드롭 아이템을 판매한 파티원이 분배금을 등록한다.
 *
 * 경매장 판매액과 수수료(5% 또는 3%)를 받아 파티원별 정산금을 계산한다(calc.ts).
 * 비율을 따로 주지 않으면 전원 같은 몫이다.
 * 한 일정에는 판매자 1명, 판매 1건만 담는다. 받을 사람마다 settlement/{uid} 문서를 만든다.
 * 아직 아무에게도 지급하지 않았다면 판매자가 고쳐서 다시 등록할 수 있다.
 */
export async function registerSettlement(db: Firestore, uid: string, data: Data): Promise<{ recipients: number }> {
  const { scheduleRef, settlementRef } = refs(db, data);
  const plan = planner(uid, data);

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

    const { amounts, summary } = plan(participants);
    const recipients = Object.keys(amounts);
    for (const recipient of recipients) {
      tx.set(settlementRef.doc(recipient), { amount: amounts[recipient], status: "PENDING", paidAt: null, receivedAt: null });
    }
    const now = Timestamp.now();
    tx.update(scheduleRef, {
      settlement: {
        sellerUid: uid,
        ...summary,
        amounts,
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
