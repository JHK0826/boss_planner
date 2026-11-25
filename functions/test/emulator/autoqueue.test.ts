import { getApps, initializeApp } from "firebase-admin/app";
import { getFirestore, Timestamp, type Firestore } from "firebase-admin/firestore";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { currentPeriod } from "../../src/domain/time";
import { createParty, joinParty, startSchedule } from "../../src/party/service";
import { releaseStaleDeferrals, wakeDeferredNeighbors } from "../../src/schedule/autoWake";
import { evaluateSchedule } from "../../src/schedule/evaluate";
import { newScheduleData } from "../../src/schedule/model";
import { openSchedules } from "../../src/schedule/open";

const PROJECT = "demo-boss-planner";
const kst = (iso: string) => Date.parse(`${iso}+09:00`);
// 2026-11-12(목) 10:00. 이번 주기 11/12 ~ 11/18, 다음 주기 11/19부터
const THU = kst("2026-11-12T10:00:00");
const NEXT_THU = kst("2026-11-19T00:00:00");
const PERIOD = "W-20261112";
const NEXT = "W-20261119";

let db: Firestore;

async function addUser(uid: string) {
  await db.doc(`users/${uid}`).set({ displayName: uid, apiKeyRegistered: true });
  await db.doc(`secrets/${uid}`).set({
    apiKey: `key-${uid}`,
    charactersFetchedAt: Timestamp.fromMillis(THU),
    characters: { [`char-${uid}`]: { ocid: `ocid-${uid}`, name: `캐릭-${uid}`, world: "스카니아", job: "비숍", level: 280 } },
  });
}

/** 하루의 fromHour ~ toHour 칸 ID */
function day(ymd: string, fromHour = 0, toHour = 24): string[] {
  const slots: string[] = [];
  for (let row = fromHour * 2; row < toHour * 2; row++) {
    slots.push(`${ymd}-${String(Math.floor(row / 2)).padStart(2, "0")}${row % 2 === 0 ? "00" : "30"}`);
  }
  return slots;
}
/** startYmd부터 7일 중, ymd의 20~22시만 가능 */
function onlySaturdayEvening(startYmd: string, ymd: string): string[] {
  const start = Date.parse(`${startYmd.slice(0, 4)}-${startYmd.slice(4, 6)}-${startYmd.slice(6)}T00:00:00Z`);
  const days = Array.from({ length: 7 }, (_, i) => new Date(start + i * 86_400_000).toISOString().slice(0, 10).replaceAll("-", ""));
  const open = new Set(day(ymd, 20, 22));
  return days.flatMap((d) => day(d)).filter((slot) => !open.has(slot));
}

const ref = (partyId: string, periodId = PERIOD) => db.doc(`parties/${partyId}/schedules/${periodId}`);
const data = async (partyId: string, periodId = PERIOD) => (await ref(partyId, periodId).get()).data()!;

/** 불가 시간을 정한 서버 시각(updatedAt)으로 제출한다 (일괄 제출이면 같은 시각) */
async function submit(partyId: string, uid: string, slots: string[], atMs: number, periodId = PERIOD) {
  await ref(partyId, periodId).collection("unavailable").doc(uid).set({ slots, submitted: true, updatedAt: Timestamp.fromMillis(atMs) });
}

/**
 * a가 두 자동 지정 파티에 다 있다.
 * H: a·b, 익스트림 발드릭스 (결정석 값이 크다) / L: a·c, 하드 스우
 */
async function parties() {
  const make = async (other: string, boss: string, difficulty: string) => {
    const { partyId, inviteCode } = await createParty(
      db,
      "a",
      { name: `${boss}팟`, bosses: [{ name: boss, difficulty }], durationMinutes: 60, characterId: "char-a", autoAssign: true },
      THU,
    );
    await joinParty(db, other, { inviteCode, characterId: `char-${other}` }, THU);
    await startSchedule(db, "a", { partyId }, THU);
    return partyId;
  };
  return { H: await make("b", "발드릭스", "EXTREME"), L: await make("c", "스우", "HARD") };
}

/** 두 파티 모두 토 20~22시만 되게 낸다 (a는 두 파티 모두, b·c는 제약 없음) */
async function submitBoth(H: string, L: string, hAt: number, lAt: number, periodId = PERIOD, startYmd = "20261112", sat = "20261114") {
  const slots = onlySaturdayEvening(startYmd, sat);
  await submit(H, "a", slots, hAt, periodId);
  await submit(H, "b", [], hAt, periodId);
  await submit(L, "a", slots, lAt, periodId);
  await submit(L, "c", [], lAt, periodId);
}

beforeAll(() => {
  if (getApps().length === 0) initializeApp({ projectId: PROJECT });
  db = getFirestore();
});

beforeEach(async () => {
  await fetch(`http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, {
    method: "DELETE",
  });
  await Promise.all(["a", "b", "c"].map(addUser));
});

describe("자동 지정 파티끼리의 확정 순서", () => {
  it("같은 순간 다 냈으면 결정석 값이 큰 파티가 먼저 확정하고, 다른 파티는 미뤘다가 그 시간을 피해 확정한다", async () => {
    const { H, L } = await parties();
    await submitBoth(H, L, THU, THU);

    expect(await evaluateSchedule(db, L, PERIOD, THU)).toBe("deferred");
    expect(await data(L)).toMatchObject({ state: "OPEN", assignMode: "AUTO", autoDeferredFor: H });
    expect((await data(L)).autoDeferredAt.toMillis()).toBe(THU);

    expect(await evaluateSchedule(db, H, PERIOD, THU)).toBe("auto-confirmed");
    expect(await data(H)).toMatchObject({ state: "LOCKED", confirmed: { slotId: "20261114-2000" }, autoDeferredAt: null });

    expect(await wakeDeferredNeighbors(db, H, await data(H), THU)).toEqual([L]);
    // a는 20:00~21:00에 H 레이드가 있어 L은 바로 뒤 21:00
    expect(await data(L)).toMatchObject({
      state: "LOCKED",
      confirmed: { slotId: "20261114-2100" },
      autoDeferredAt: null,
      autoDeferredFor: null,
    });
  });

  it("1분 안이면 동시로 본다: 먼저 냈어도 결정석 값이 작은 파티는 미룬다", async () => {
    const { H, L } = await parties();
    await submitBoth(H, L, THU + 30_000, THU);
    expect(await evaluateSchedule(db, L, PERIOD, THU + 60_000)).toBe("deferred");
  });

  it("1분 이상 먼저 다 냈으면 결정석 값이 작아도 먼저 확정한다", async () => {
    const { H, L } = await parties();
    await submitBoth(H, L, THU + 61_000, THU);
    expect(await evaluateSchedule(db, L, PERIOD, THU + 120_000)).toBe("auto-confirmed");
    expect((await data(L)).confirmed.slotId).toBe("20261114-2000");
    expect(await evaluateSchedule(db, H, PERIOD, THU + 120_000)).toBe("auto-confirmed");
    expect((await data(H)).confirmed.slotId).toBe("20261114-2100");
  });

  it("목요일 전환: 둘 다 미리 냈으면 처리 순서와 상관없이 결정석 값이 큰 파티가 1위를 가져간다", async () => {
    const { H, L } = await parties();
    for (const partyId of [H, L]) {
      await ref(partyId, NEXT).set({ ...newScheduleData(currentPeriod("WEEKLY", NEXT_THU), 60), preOpened: true });
    }
    await submitBoth(H, L, THU, THU, NEXT, "20261119", "20261121");
    for (const partyId of [H, L]) expect(await evaluateSchedule(db, partyId, NEXT, THU)).toBe("waiting-auto");

    await openSchedules(db, "WEEKLY", NEXT_THU);
    // 확정 트리거가 하는 깨우기
    await wakeDeferredNeighbors(db, H, await data(H, NEXT), NEXT_THU);
    expect((await data(H, NEXT)).confirmed.slotId).toBe("20261121-2000");
    expect((await data(L, NEXT)).confirmed.slotId).toBe("20261121-2100");
  });

  it("앞선 파티가 확정하지 못하고 끝나도 깨어나 확정한다", async () => {
    const { H, L } = await parties();
    await submitBoth(H, L, THU, THU);
    // H의 b는 전부 불가 → H는 겹치는 시간이 없다
    await submit(H, "b", onlySaturdayEvening("20261112", "20261113").concat(day("20261114")), THU);
    expect(await evaluateSchedule(db, L, PERIOD, THU)).toBe("deferred");
    expect(await evaluateSchedule(db, H, PERIOD, THU)).toBe("skipped");
    await wakeDeferredNeighbors(db, H, await data(H), THU);
    expect(await data(L)).toMatchObject({ state: "LOCKED", confirmed: { slotId: "20261114-2000" } });
  });

  it("미룬 지 5분이 넘으면 정리 작업이 우선순위를 보지 않고 확정한다", async () => {
    const { H, L } = await parties();
    await submitBoth(H, L, THU, THU);
    expect(await evaluateSchedule(db, L, PERIOD, THU)).toBe("deferred");
    expect(await releaseStaleDeferrals(db, THU + 4 * 60_000)).toBe(0);
    expect(await releaseStaleDeferrals(db, THU + 6 * 60_000)).toBe(1);
    expect(await data(L)).toMatchObject({ state: "LOCKED", confirmedBy: "AUTO", confirmed: { slotId: "20261114-2000" } });
  });
});
