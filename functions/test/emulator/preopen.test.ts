import { getApps, initializeApp } from "firebase-admin/app";
import { getFirestore, Timestamp, type Firestore } from "firebase-admin/firestore";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createParty, joinParty, startSchedule } from "../../src/party/service";
import { resolveRaidResult } from "../../src/schedule/clear";
import { confirmSchedule } from "../../src/schedule/confirm";
import { evaluateSchedule } from "../../src/schedule/evaluate";
import { openNextPeriod, openSchedules } from "../../src/schedule/open";
import { loadPendingSlots } from "../../src/schedule/pending";

const PROJECT = "demo-boss-planner";
const kst = (iso: string) => Date.parse(`${iso}+09:00`);
// 2026-11-12는 목요일. 다음 주기는 11/19(목) 시작이다.
const THU = kst("2026-11-12T10:00:00");
const NEXT_THU = kst("2026-11-19T00:00:00");
const PERIOD = "W-20261112";
const NEXT = "W-20261119";
const NEXT_WEEK = ["20261119", "20261120", "20261121", "20261122", "20261123", "20261124", "20261125"];

let db: Firestore;

async function addUser(uid: string) {
  await db.doc(`users/${uid}`).set({ displayName: uid, apiKeyRegistered: true });
  await db.doc(`secrets/${uid}`).set({
    apiKey: `key-${uid}`,
    charactersFetchedAt: Timestamp.fromMillis(THU),
    characters: { [`char-${uid}`]: { ocid: `ocid-${uid}`, name: `캐릭-${uid}`, world: "스카니아", job: "비숍", level: 280 } },
  });
}

function day(ymd: string, fromHour = 0, toHour = 24): string[] {
  const slots: string[] = [];
  for (let h = fromHour; h < toHour; h++) slots.push(`${ymd}-${String(h).padStart(2, "0")}00`, `${ymd}-${String(h).padStart(2, "0")}30`);
  return slots;
}
/** 다음 주에서 주어진 시간대만 빼고 전부 불가 */
const nextWeekExcept = (...free: [string, number, number][]) => {
  const open = new Set(free.flatMap(([ymd, from, to]) => day(ymd, from, to)));
  return NEXT_WEEK.flatMap((d) => day(d)).filter((slot) => !open.has(slot));
};

const ref = (partyId: string, periodId: string) => db.doc(`parties/${partyId}/schedules/${periodId}`);
const data = async (partyId: string, periodId: string) => (await ref(partyId, periodId).get()).data();
const submit = (partyId: string, periodId: string, uid: string, slots: string[]) =>
  ref(partyId, periodId).collection("unavailable").doc(uid).set({ slots, submitted: true, updatedAt: Timestamp.now() });
const vote = (partyId: string, periodId: string, uid: string, agreed: number[], round: number) =>
  ref(partyId, periodId).collection("votes").doc(uid).set({ agreed, round, updatedAt: Timestamp.now() });

/** a·b 2인 스우 파티: 이번 주 토요일 20시에 확정하고 클리어까지 */
async function clearedParty(name = "스우팟", bosses = [{ name: "스우", difficulty: "HARD" }]) {
  const { partyId, inviteCode } = await createParty(db, "a", { name, bosses, durationMinutes: 60, characterId: "char-a" }, THU);
  await joinParty(db, "b", { inviteCode, characterId: "char-b" }, THU);
  await startSchedule(db, "a", { partyId }, THU);
  for (const uid of ["a", "b"]) await submit(partyId, PERIOD, uid, []);
  await evaluateSchedule(db, partyId, PERIOD, THU);
  const round = (await data(partyId, PERIOD))!.round as number;
  for (const uid of ["a", "b"]) await vote(partyId, PERIOD, uid, [0], round);
  await evaluateSchedule(db, partyId, PERIOD, THU);
  await confirmSchedule(db, "a", { partyId, periodId: PERIOD, candidateIndex: 0 }, THU);
  const raidStart = ((await data(partyId, PERIOD))!.confirmed.start as Timestamp).toMillis();
  await resolveRaidResult(db, ref(partyId, PERIOD), true, "MANUAL", raidStart + 60 * 60 * 1000);
  return { partyId, inviteCode, afterRaid: raidStart + 60 * 60 * 1000 };
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

describe("다음 주 미리 열기", () => {
  it("클리어하면 다음 주 일정을 미리 연다 (한 번만)", async () => {
    const { partyId, afterRaid } = await clearedParty();
    const settled = (await data(partyId, PERIOD))!;
    expect(settled.state).toBe("SETTLED");

    expect(await openNextPeriod(db, partyId, settled, afterRaid)).toBe(NEXT);
    expect(await data(partyId, NEXT)).toMatchObject({
      state: "OPEN",
      preOpened: true,
      periodStart: Timestamp.fromMillis(NEXT_THU),
      inputDeadline: Timestamp.fromMillis(kst("2026-11-20T00:00:00")),
    });
    expect(await openNextPeriod(db, partyId, settled, afterRaid)).toBeNull();
  });

  it("미사용·종료도 열고, 진행 중이거나 월간이거나 다음 주기가 이미 시작했으면 열지 않는다", async () => {
    const { partyId } = await createParty(db, "a", { name: "팟", bosses: [{ name: "스우", difficulty: "HARD" }], durationMinutes: 60, characterId: "char-a" }, THU);
    const finished = (state: string, cycle = "WEEKLY") => ({ state, cycle, periodEnd: Timestamp.fromMillis(NEXT_THU) });
    const now = kst("2026-11-15T12:00:00");
    expect(await openNextPeriod(db, partyId, finished("RETRY"), now)).toBeNull();
    expect(await openNextPeriod(db, partyId, finished("LOCKED"), now)).toBeNull();
    expect(await openNextPeriod(db, partyId, finished("SKIPPED", "MONTHLY"), now)).toBeNull();
    expect(await openNextPeriod(db, partyId, finished("SKIPPED"), NEXT_THU)).toBeNull();
    expect(await openNextPeriod(db, partyId, finished("EXPIRED"), now)).toBe(NEXT);
  });
});

describe("미리 제출·투표와 확정", () => {
  it("전원이 미리 내면 다음 주 후보가 나오고 투표가 되지만, 확정은 목요일부터", async () => {
    const { partyId, afterRaid } = await clearedParty();
    await openNextPeriod(db, partyId, (await data(partyId, PERIOD))!, afterRaid);
    const early = kst("2026-11-15T12:00:00");

    await submit(partyId, NEXT, "a", nextWeekExcept(["20261121", 20, 22]));
    await submit(partyId, NEXT, "b", []);
    await evaluateSchedule(db, partyId, NEXT, early);
    const recommended = (await data(partyId, NEXT))!;
    expect(recommended.candidates[0]).toMatchObject({ slotId: "20261121-2000" });

    for (const uid of ["a", "b"]) await vote(partyId, NEXT, uid, [0], recommended.round);
    await evaluateSchedule(db, partyId, NEXT, early);
    expect((await data(partyId, NEXT))!.unanimous).toEqual([0]);

    await expect(confirmSchedule(db, "a", { partyId, periodId: NEXT, candidateIndex: 0 }, early)).rejects.toMatchObject({
      details: { reason: "not-started" },
    });

    // 목요일 00:00: 같은 문서가 이번 주기가 된다(새로 만들지 않음).
    expect(await openSchedules(db, "WEEKLY", NEXT_THU)).toBe(0);
    expect((await data(partyId, NEXT))!.preOpened).toBe(false);
    expect(await confirmSchedule(db, "a", { partyId, periodId: NEXT, candidateIndex: 0 }, NEXT_THU + 60_000)).toEqual({
      slotId: "20261121-2000",
    });
  });

  it("목요일에 새 파티원이 들어오면 미리 나온 후보를 비우고 다시 조율한다", async () => {
    const { partyId, inviteCode, afterRaid } = await clearedParty();
    await openNextPeriod(db, partyId, (await data(partyId, PERIOD))!, afterRaid);
    const early = kst("2026-11-15T12:00:00");
    for (const uid of ["a", "b"]) await submit(partyId, NEXT, uid, []);
    await evaluateSchedule(db, partyId, NEXT, early);
    expect((await data(partyId, NEXT))!.candidates.length).toBeGreaterThan(0);

    await openSchedules(db, "WEEKLY", NEXT_THU);
    await joinParty(db, "c", { inviteCode, characterId: "char-c" }, NEXT_THU + 60_000);
    expect((await data(partyId, NEXT))!.candidates).toEqual([]);
  });

  it("다음 주 추천은 다른 파티의 다음 주 투표 후보를 피한다", async () => {
    const { partyId, afterRaid } = await clearedParty();
    await openNextPeriod(db, partyId, (await data(partyId, PERIOD))!, afterRaid);
    const early = kst("2026-11-15T12:00:00");
    for (const uid of ["a", "b"]) await submit(partyId, NEXT, uid, nextWeekExcept(["20261121", 20, 22]));
    await evaluateSchedule(db, partyId, NEXT, early);

    // a가 속한 다른 파티가 같은 다음 주를 추천받을 때, 위 파티의 후보 칸(토 20:00~21:00)을 투표 중 후보로 본다.
    const { partyId: other } = await createParty(db, "a", { name: "데미안팟", bosses: [{ name: "데미안", difficulty: "HARD" }], durationMinutes: 60, characterId: "char-a" }, THU);
    const slots = await loadPendingSlots(db, other, ["a"], { startMs: NEXT_THU, totalSlots: 7 * 48 }, early);
    const saturday20 = 2 * 48 + 40;
    expect(slots.all).toContain(saturday20);
    expect(slots.byMember[0]).toContain(saturday20);
  });
});
