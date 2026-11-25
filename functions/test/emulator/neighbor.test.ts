import { getApps, initializeApp } from "firebase-admin/app";
import { getFirestore, Timestamp, type Firestore } from "firebase-admin/firestore";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createParty, joinParty, startSchedule } from "../../src/party/service";
import { confirmSchedule } from "../../src/schedule/confirm";
import { evaluateSchedule } from "../../src/schedule/evaluate";
import { refreshNeighborSchedules } from "../../src/schedule/refresh";

const PROJECT = "demo-boss-planner";
const kst = (iso: string) => Date.parse(`${iso}+09:00`);
// 2026-11-12(목) 10:00. 이번 주기는 11/12(목) ~ 11/18(수)
const THU = kst("2026-11-12T10:00:00");
const PERIOD = "W-20261112";
const WEEK = ["20261112", "20261113", "20261114", "20261115", "20261116", "20261117", "20261118"];
const SAT = "20261114";

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
/** 이번 주에서 주어진 시간대만 빼고 전부 불가 */
const weekExcept = (...free: [string, number, number][]) => {
  const open = new Set(free.flatMap(([ymd, from, to]) => day(ymd, from, to)));
  return WEEK.flatMap((d) => day(d)).filter((slot) => !open.has(slot));
};
/** 매일 18~24시만 가능 */
const evenings = () => weekExcept(...WEEK.map((d): [string, number, number] => [d, 18, 24]));
/** 토요일 20~21시만 가능 */
const saturday20Only = () => weekExcept([SAT, 20, 21]);

const ref = (partyId: string) => db.doc(`parties/${partyId}/schedules/${PERIOD}`);
const data = async (partyId: string) => (await ref(partyId).get()).data()!;
const slotIds = async (partyId: string) => ((await data(partyId)).candidates as { slotId: string }[]).map((c) => c.slotId);
const submitAll = async (partyId: string, inputs: Record<string, string[]>) => {
  for (const [uid, slots] of Object.entries(inputs)) {
    await ref(partyId).collection("unavailable").doc(uid).set({ slots, submitted: true, updatedAt: Timestamp.now() });
  }
  return evaluateSchedule(db, partyId, PERIOD, THU);
};
const vote = async (partyId: string, uid: string, agreed: number[]) =>
  ref(partyId).collection("votes").doc(uid).set({ agreed, round: (await data(partyId)).round, updatedAt: Timestamp.now() });

/** a가 두 파티에 다 있다. A: a·b 스우팟, B: c·a 데미안팟. 둘 다 이번 주기를 바로 시작한다. */
async function twoParties() {
  const a = await createParty(db, "a", { name: "스우팟", bosses: [{ name: "스우", difficulty: "HARD" }], durationMinutes: 60, characterId: "char-a" }, THU);
  await joinParty(db, "b", { inviteCode: a.inviteCode, characterId: "char-b" }, THU);
  const b = await createParty(db, "c", { name: "데미안팟", bosses: [{ name: "데미안", difficulty: "HARD" }], durationMinutes: 60, characterId: "char-c" }, THU);
  await joinParty(db, "a", { inviteCode: b.inviteCode, characterId: "char-a" }, THU);
  await startSchedule(db, "a", { partyId: a.partyId }, THU);
  await startSchedule(db, "c", { partyId: b.partyId }, THU);
  return { A: a.partyId, B: b.partyId };
}

/** A가 토요일 20:00 후보에 전원 동의하고 확정한 뒤, 확정 트리거가 하는 다시 추천을 돌린다 */
async function confirmA(A: string) {
  for (const uid of ["a", "b"]) await vote(A, uid, [0]);
  await evaluateSchedule(db, A, PERIOD, THU);
  await confirmSchedule(db, "a", { partyId: A, periodId: PERIOD, candidateIndex: 0 }, THU);
  expect((await data(A)).state).toBe("LOCKED");
  return refreshNeighborSchedules(db, A, await data(A), THU);
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

describe("같은 파티원이 있는 다른 파티와 이어 돌기", () => {
  it("다른 파티가 투표 중인 후보 바로 앞뒤를 우선 추천한다", async () => {
    const { A, B } = await twoParties();
    expect(await submitAll(A, { a: saturday20Only(), b: saturday20Only() })).toBe("recommended");
    expect(await slotIds(A)).toEqual([`${SAT}-2000`]);

    // B는 매일 저녁 가능. 토요일은 A 후보(20:00~21:00) 바로 앞(19:00)이 18:00보다 먼저 나온다.
    expect(await submitAll(B, { c: evenings(), a: evenings() })).toBe("recommended");
    const ids = await slotIds(B);
    expect(ids).toContain(`${SAT}-1900`);
    expect(ids).not.toContain(`${SAT}-1800`);
    expect(ids).not.toContain(`${SAT}-2000`);

    // A가 그 시간으로 확정해도 B에 이미 이어지는 후보가 있으므로 다시 고르지 않는다.
    const round = (await data(B)).round;
    expect(await confirmA(A)).toEqual([]);
    expect(await slotIds(B)).toEqual(ids);
    expect((await data(B)).round).toBe(round);
  });

  it("확정하면 아직 아무도 투표하지 않은 다른 파티의 후보를 그 시간에 맞춰 다시 고른다", async () => {
    const { A, B } = await twoParties();
    // B가 먼저 추천받아 A를 모른다 → 토요일은 18:00
    await submitAll(B, { c: evenings(), a: evenings() });
    expect(await slotIds(B)).toContain(`${SAT}-1800`);
    const before = await data(B);

    await submitAll(A, { a: saturday20Only(), b: saturday20Only() });
    expect(await confirmA(A)).toEqual([B]);

    const after = await data(B);
    const ids = await slotIds(B);
    expect(ids).toContain(`${SAT}-1900`);
    expect(ids).not.toContain(`${SAT}-1800`);
    expect(after).toMatchObject({ state: "OPEN", round: before.round + 1, recommendReason: "neighbor", inputsKey: before.inputsKey });
    // 아무도 투표하지 않았던 후보는 다시 나와도 되므로, 이미 준 후보 목록은 새 후보로 바뀐다.
    expect(after.offeredSlotIds).toEqual(ids);
  });

  it("이미 누가 투표했으면 그대로 둔다", async () => {
    const { A, B } = await twoParties();
    await submitAll(B, { c: evenings(), a: evenings() });
    await vote(B, "c", [0]);
    const before = await data(B);

    await submitAll(A, { a: saturday20Only(), b: saturday20Only() });
    expect(await confirmA(A)).toEqual([]);
    const after = await data(B);
    expect(after.round).toBe(before.round);
    expect(after.candidates).toEqual(before.candidates);
  });

  it("다시 골라도 남는 시각이 없으면 일정을 끝내지 않고 그대로 둔다", async () => {
    const { A, B } = await twoParties();
    // 두 파티 모두 토요일 20:00밖에 안 된다. B가 먼저 그 시각을 받고, A가 먼저 확정한다.
    await submitAll(B, { c: saturday20Only(), a: saturday20Only() });
    await submitAll(A, { a: saturday20Only(), b: saturday20Only() });
    expect(await confirmA(A)).toEqual([]);

    expect(await data(B)).toMatchObject({ state: "OPEN" });
    expect(await slotIds(B)).toEqual([`${SAT}-2000`]);
  });
});
