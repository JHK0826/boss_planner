import { getApps, initializeApp } from "firebase-admin/app";
import { getFirestore, Timestamp, type Firestore } from "firebase-admin/firestore";
import type { MulticastMessage } from "firebase-admin/messaging";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { runInputDeadlineCheck, sendPushes, type Sender } from "../../src/notify/send";
import { confirmReceived, markPaid, registerSettlement } from "../../src/settlement/service";

const PROJECT = "demo-boss-planner";
const kst = (iso: string) => Date.parse(`${iso}+09:00`);
const REF = { partyId: "p1", periodId: "W-20261112" };

let db: Firestore;

const scheduleRef = () => db.doc("parties/p1/schedules/W-20261112");
const schedule = async () => (await scheduleRef().get()).data()!;
const statuses = async () =>
  Object.fromEntries((await scheduleRef().collection("settlement").get()).docs.map((d) => [d.id, d.get("status")]));

/** a(파티장), b, c가 참여해 클리어한 일정 */
async function seed(state = "SETTLED", memberUids = ["a", "b", "c"]) {
  await db.doc("parties/p1").set({
    name: "스우팟",
    leaderUid: "a",
    memberUids,
    members: Object.fromEntries(memberUids.map((uid) => [uid, { displayName: uid }])),
  });
  await scheduleRef().set({
    state,
    settlement: null,
    inputDeadline: Timestamp.fromMillis(kst("2026-11-13T00:00:00")),
    confirmed: { start: Timestamp.fromMillis(kst("2026-11-14T20:00:00")), memberUids },
  });
}

/** 보낸 메시지를 모으고, 지정한 토큰은 "등록 해제됨"으로 응답하는 가짜 FCM */
function fakeSender(deadTokens: string[] = []) {
  const messages: MulticastMessage[] = [];
  const sender: Sender = {
    async sendEachForMulticast(message) {
      messages.push(message);
      return {
        responses: message.tokens.map((token) =>
          deadTokens.includes(token)
            ? { success: false, error: { code: "messaging/registration-token-not-registered" } }
            : { success: true },
        ),
      };
    },
  };
  return { sender, messages };
}

beforeAll(() => {
  if (getApps().length === 0) initializeApp({ projectId: PROJECT });
  db = getFirestore();
});

beforeEach(async () => {
  await fetch(
    `http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`,
    { method: "DELETE" },
  );
});

describe("분배금 정산", () => {
  it("판매자가 등록하면 나머지 파티원마다 대기 상태 문서가 생긴다", async () => {
    await seed();
    expect(await registerSettlement(db, "b", { ...REF, amountPerPerson: 5_000_000 })).toEqual({ recipients: 2 });

    expect((await schedule()).settlement).toMatchObject({ sellerUid: "b", amountPerPerson: 5_000_000, completed: false });
    expect(await statuses()).toEqual({ a: "PENDING", c: "PENDING" });
    expect((await scheduleRef().collection("settlement").doc("a").get()).get("amount")).toBe(5_000_000);
  });

  it("클리어하지 않은 일정, 참여하지 않은 사람, 잘못된 금액은 거절한다", async () => {
    await seed("LOCKED");
    await expect(registerSettlement(db, "b", { ...REF, amountPerPerson: 100 })).rejects.toMatchObject({
      details: { reason: "not-settled" },
    });
    await seed();
    await expect(registerSettlement(db, "z", { ...REF, amountPerPerson: 100 })).rejects.toMatchObject({
      details: { reason: "not-member" },
    });
    for (const bad of [0, -5, 1.5, "100", 2_000_000_000_000]) {
      await expect(registerSettlement(db, "b", { ...REF, amountPerPerson: bad })).rejects.toMatchObject({
        code: "invalid-argument",
      });
    }
  });

  it("판매자는 한 명이고, 지급을 시작하기 전까지만 금액을 고칠 수 있다", async () => {
    await seed();
    await registerSettlement(db, "b", { ...REF, amountPerPerson: 100 });
    await expect(registerSettlement(db, "a", { ...REF, amountPerPerson: 200 })).rejects.toMatchObject({
      details: { reason: "already-registered" },
    });

    await registerSettlement(db, "b", { ...REF, amountPerPerson: 300 });
    expect((await schedule()).settlement.amountPerPerson).toBe(300);

    await markPaid(db, "b", { ...REF, recipientUid: "a" });
    await expect(registerSettlement(db, "b", { ...REF, amountPerPerson: 400 })).rejects.toMatchObject({
      details: { reason: "already-paid" },
    });
  });

  it("대기 → 지급함 → 수령 확인 순서로만 진행되고, 전원이 확인하면 정산이 완료된다", async () => {
    await seed();
    await registerSettlement(db, "b", { ...REF, amountPerPerson: 100 });

    await expect(markPaid(db, "a", { ...REF, recipientUid: "c" })).rejects.toMatchObject({ details: { reason: "not-seller" } });
    await expect(confirmReceived(db, "a", REF)).rejects.toMatchObject({ details: { reason: "not-paid" } });
    await expect(confirmReceived(db, "b", REF)).rejects.toMatchObject({ details: { reason: "not-recipient" } });

    await markPaid(db, "b", { ...REF, recipientUid: "a" });
    await expect(markPaid(db, "b", { ...REF, recipientUid: "a" })).rejects.toMatchObject({ details: { reason: "not-pending" } });
    expect(await confirmReceived(db, "a", REF)).toEqual({ completed: false });
    expect(await statuses()).toEqual({ a: "RECEIVED", c: "PENDING" });
    expect((await schedule()).settlement.completed).toBe(false);

    await markPaid(db, "b", { ...REF, recipientUid: "c" });
    expect(await confirmReceived(db, "c", REF)).toEqual({ completed: true });
    expect((await schedule()).settlement).toMatchObject({ completed: true });
    expect((await schedule()).settlement.completedAt).not.toBeNull();
  });

  it("경매장 판매액과 수수료로 파티원별 정산금을 계산해 등록한다", async () => {
    await seed();
    expect(await registerSettlement(db, "b", { ...REF, saleAmount: 100_000_000, feePercent: 3 })).toEqual({ recipients: 2 });

    // 실수령 97,000,000 ÷ (0.97 + 2) = 32,659,932.6… → 32,659,900
    const settlement = (await schedule()).settlement;
    expect(settlement).toMatchObject({
      sellerUid: "b",
      saleAmount: 100_000_000,
      feePercent: 3,
      netAmount: 97_000_000,
      amounts: { a: 32_659_900, c: 32_659_900 },
      sellerAmount: 97_000_000 - 2 * 32_659_900,
      amountPerPerson: 32_659_900,
      weights: { a: 1, b: 1, c: 1 },
    });
    expect((await scheduleRef().collection("settlement").doc("c").get()).data()).toMatchObject({
      amount: 32_659_900,
      status: "PENDING",
    });
  });

  it("상세 비율을 주면 사람마다 정산금이 달라진다", async () => {
    await seed();
    await registerSettlement(db, "b", { ...REF, saleAmount: 100_000_000, feePercent: 5, weights: { a: 2 } });

    const settlement = (await schedule()).settlement;
    expect(settlement.weights).toEqual({ a: 2, b: 1, c: 1 });
    expect(settlement.amounts.a).toBe(settlement.amounts.c * 2 + (settlement.amounts.a - settlement.amounts.c * 2));
    expect(settlement.amounts.a / settlement.amounts.c).toBeCloseTo(2, 4);
    // 금액이 서로 다르면 1인 금액은 비워 둔다.
    expect(settlement.amountPerPerson).toBeNull();
    expect((await scheduleRef().collection("settlement").doc("a").get()).get("amount")).toBe(settlement.amounts.a);
  });

  it("잘못된 판매액, 수수료, 비율은 거절한다", async () => {
    await seed();
    const register = (extra: Record<string, unknown>) =>
      registerSettlement(db, "b", { ...REF, saleAmount: 100_000_000, feePercent: 3, ...extra });
    for (const bad of [{ saleAmount: 0 }, { saleAmount: 1.5 }, { saleAmount: 2_000_000_000_000 }, { feePercent: 4 }, { feePercent: "3" }]) {
      await expect(register(bad)).rejects.toMatchObject({ code: "invalid-argument" });
    }
    for (const weights of [{ a: 0 }, { a: 101 }, { a: 1.5 }, { a: "2" }]) {
      await expect(register({ weights })).rejects.toMatchObject({ code: "invalid-argument", details: { field: "weights" } });
    }
    // 판매액이 너무 적어 정산금이 0이 되는 경우
    await expect(register({ saleAmount: 100 })).rejects.toMatchObject({ code: "invalid-argument" });
    expect((await schedule()).settlement).toBeNull();
  });

  it("받을 사람이 없는 1인 파티는 등록과 동시에 완료된다", async () => {
    await seed("SETTLED", ["a"]);
    expect(await registerSettlement(db, "a", { ...REF, amountPerPerson: 100 })).toEqual({ recipients: 0 });
    expect((await schedule()).settlement.completed).toBe(true);
  });
});

describe("푸시 발송", () => {
  it("대상자의 모든 기기로 보내고, 등록이 풀린 토큰은 지운다", async () => {
    await db.doc("users/a/devices/token-a1").set({ platform: "android" });
    await db.doc("users/a/devices/token-a2").set({ platform: "android" });
    await db.doc("users/b/devices/token-b").set({ platform: "android" });
    const { sender, messages } = fakeSender(["token-a2"]);

    const sent = await sendPushes(
      db,
      [
        { uids: ["a", "b"], title: "스우팟", body: "일정이 확정됐습니다", partyId: "p1" },
        { uids: ["c"], title: "스우팟", body: "기기가 없는 사람", partyId: "p1" },
      ],
      sender,
    );

    expect(sent).toBe(2);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({
      tokens: ["token-a1", "token-a2", "token-b"],
      notification: { title: "스우팟", body: "일정이 확정됐습니다" },
      data: { partyId: "p1" },
    });
    expect((await db.doc("users/a/devices/token-a2").get()).exists).toBe(false);
    expect((await db.doc("users/a/devices/token-a1").get()).exists).toBe(true);
  });

  it("발송이 실패해도 예외를 던지지 않는다", async () => {
    await db.doc("users/a/devices/token-a1").set({});
    const sender: Sender = {
      sendEachForMulticast: async () => {
        throw new Error("fcm down");
      },
    };
    await expect(sendPushes(db, [{ uids: ["a"], title: "t", body: "b", partyId: "p1" }], sender)).resolves.toBe(0);
  });
});

describe("runInputDeadlineCheck", () => {
  async function seedOpen() {
    await seed("OPEN");
    for (const uid of ["a", "b", "c"]) await db.doc(`users/${uid}/devices/token-${uid}`).set({});
    await scheduleRef().collection("unavailable").doc("a").set({ slots: [], submitted: true });
    await scheduleRef().collection("unavailable").doc("b").set({ slots: ["20261112-2000"], submitted: false });
  }

  it("마감이 지나면 미입력자에게 입력 요청을, 파티장에게 미입력자 알림을 보낸다", async () => {
    await seedOpen();
    const { sender, messages } = fakeSender();

    await runInputDeadlineCheck(db, kst("2026-11-13T00:00:00"), sender);

    expect(messages).toHaveLength(2);
    expect(messages[0]).toMatchObject({ tokens: ["token-b", "token-c"] });
    expect(messages[1]).toMatchObject({ tokens: ["token-a"], notification: { body: "미입력 파티원이 존재합니다." } });
  });

  it("마감 전이거나 전원이 제출했으면 보내지 않는다", async () => {
    await seedOpen();
    const { sender, messages } = fakeSender();
    await runInputDeadlineCheck(db, kst("2026-11-12T23:00:00"), sender);
    expect(messages).toHaveLength(0);

    for (const uid of ["b", "c"]) await scheduleRef().collection("unavailable").doc(uid).set({ slots: [], submitted: true });
    await runInputDeadlineCheck(db, kst("2026-11-13T00:00:00"), sender);
    expect(messages).toHaveLength(0);
  });
});
