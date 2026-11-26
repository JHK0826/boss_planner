import { getApps, initializeApp } from "firebase-admin/app";
import { getFirestore, Timestamp, type Firestore } from "firebase-admin/firestore";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createParty, joinParty, startSchedule } from "../../src/party/service";
import { readBusyConflicts, releaseBusy } from "../../src/schedule/confirm";
import { evaluateSchedule } from "../../src/schedule/evaluate";

const PROJECT = "demo-boss-planner";
const kst = (iso: string) => Date.parse(`${iso}+09:00`);
// 2026-11-12(목) 10:00. 이번 주기 11/12 ~ 11/18
const THU = kst("2026-11-12T10:00:00");
const PERIOD = "W-20261112";
const SAT = "20261114";
const at = (hhmm: string) => kst(`2026-11-14T${hhmm.slice(0, 2)}:${hhmm.slice(2)}:00`);

let db: Firestore;

async function addUser(uid: string) {
  await db.doc(`users/${uid}`).set({ displayName: uid, apiKeyRegistered: true });
  await db.doc(`secrets/${uid}`).set({
    apiKey: `key-${uid}`,
    charactersFetchedAt: Timestamp.fromMillis(THU),
    characters: { [`char-${uid}`]: { ocid: `ocid-${uid}`, name: `캐릭-${uid}`, world: "스카니아", job: "비숍", level: 280 } },
  });
}

/** 7일 중 토요일 from~to시만 가능 */
function onlySaturday(from: number, to: number): string[] {
  const days = ["20261112", "20261113", SAT, "20261115", "20261116", "20261117", "20261118"];
  const slots: string[] = [];
  for (const day of days) {
    for (let row = 0; row < 48; row++) {
      if (day === SAT && row >= from * 2 && row < to * 2) continue;
      slots.push(`${day}-${String(Math.floor(row / 2)).padStart(2, "0")}${row % 2 ? "30" : "00"}`);
    }
  }
  return slots;
}

/** 20분짜리 자동 지정 파티 (파티장 a) */
async function autoParty(other: string, boss: string) {
  const { partyId, inviteCode } = await createParty(
    db,
    "a",
    { name: `${boss}팟`, bosses: [{ name: boss, difficulty: "HARD" }], durationMinutes: 20, characterId: "char-a", autoAssign: true },
    THU,
  );
  await joinParty(db, other, { inviteCode, characterId: `char-${other}` }, THU);
  await startSchedule(db, "a", { partyId }, THU);
  return partyId;
}

const submit = (partyId: string, uid: string, slots: string[]) =>
  db.doc(`parties/${partyId}/schedules/${PERIOD}/unavailable/${uid}`).set({ slots, submitted: true, updatedAt: Timestamp.fromMillis(THU) });
const data = async (partyId: string) => (await db.doc(`parties/${partyId}/schedules/${PERIOD}`).get()).data()!;
const busyIds = async (uid: string) => (await db.collection(`users/${uid}/busy`).get()).docs.map((d) => d.id);
const conflicts = (uids: string[], from: string, to: string) =>
  db.runTransaction((tx) => readBusyConflicts(tx, db, uids, at(from), at(to)));

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

describe("20분 레이드 이어 돌기 (10분 단위)", () => {
  it("21:00~21:20 확정 레이드 바로 뒤를 21:20~21:40으로 잡는다", async () => {
    // A파티: a는 토 21:00~21:30만 가능 → 21:00~21:20
    const first = await autoParty("b", "스우");
    await submit(first, "a", onlySaturday(21, 21.5));
    await submit(first, "b", []);
    expect(await evaluateSchedule(db, first, PERIOD, THU)).toBe("auto-confirmed");
    expect(await data(first)).toMatchObject({ confirmed: { slotId: `${SAT}-2100`, busyUnitMinutes: 10 } });

    // B파티: a는 토 21:00~22:00 가능. 30분 칸이면 21:30이었지만, 이제 바로 이어서 21:20
    const second = await autoParty("c", "데미안");
    await submit(second, "a", onlySaturday(21, 22));
    await submit(second, "c", []);
    expect(await evaluateSchedule(db, second, PERIOD, THU)).toBe("auto-confirmed");
    const confirmed = (await data(second)).confirmed;
    expect(confirmed.slotId).toBe(`${SAT}-2120`);
    expect(confirmed.end.toMillis()).toBe(at("2140"));
    expect((await data(second)).candidates[0].reasons).toContain("ADJACENT_SAME_CHARACTER");
    expect(await busyIds("a")).toEqual([`${SAT}-2100`, `${SAT}-2110`, `${SAT}-2120`, `${SAT}-2130`]);
    expect(await busyIds("c")).toEqual([`${SAT}-2120`, `${SAT}-2130`]);
  });

  it("충돌 검사는 실제 레이드 시간끼리: 21:10 시작은 겹치고, 21:20 시작은 겹치지 않는다", async () => {
    const first = await autoParty("b", "스우");
    await submit(first, "a", onlySaturday(21, 21.5));
    await submit(first, "b", []);
    await evaluateSchedule(db, first, PERIOD, THU);
    expect(await conflicts(["a", "c"], "2110", "2130")).toEqual(["a"]);
    expect(await conflicts(["a", "c"], "2120", "2140")).toEqual([]);
    expect(await conflicts(["a"], "2040", "2100")).toEqual([]);
  });

  it("0.11.2 전 확정(30분 칸 busy)도 시간으로 판정하고, 그 바로 뒤에 잡는다", async () => {
    // 예전 확정: a의 21:00~21:20 레이드가 21:00 칸 문서 하나로 남아 있다
    await db.doc(`users/a/busy/${SAT}-2100`).set({
      partyId: "old",
      periodId: PERIOD,
      start: Timestamp.fromMillis(at("2100")),
      end: Timestamp.fromMillis(at("2120")),
      characterId: "char-a",
    });
    expect(await conflicts(["a"], "2110", "2130")).toEqual(["a"]);
    expect(await conflicts(["a"], "2120", "2140")).toEqual([]);

    const party = await autoParty("c", "데미안");
    await submit(party, "a", onlySaturday(21, 22));
    await submit(party, "c", []);
    expect(await evaluateSchedule(db, party, PERIOD, THU)).toBe("auto-confirmed");
    expect((await data(party)).confirmed.slotId).toBe(`${SAT}-2120`);
  });

  it("busy를 풀 때 새 확정은 10분 문서를, 예전 확정은 30분 칸 문서를 지운다", async () => {
    const legacy = { slotId: `${SAT}-2000`, start: Timestamp.fromMillis(at("2000")), end: Timestamp.fromMillis(at("2040")), memberUids: ["a"] };
    for (const id of ["2000", "2030"]) await db.doc(`users/a/busy/${SAT}-${id}`).set({ partyId: "old", start: legacy.start, end: legacy.end });
    await db.runTransaction(async (tx) => releaseBusy(tx, db, { confirmed: legacy }));
    expect(await busyIds("a")).toEqual([]);

    const fresh = { ...legacy, busyUnitMinutes: 10 };
    for (const id of ["2000", "2010", "2020", "2030"]) await db.doc(`users/a/busy/${SAT}-${id}`).set({ partyId: "new", start: fresh.start, end: fresh.end });
    // 바로 뒤 20:40에 시작하는 다른 레이드 문서는 남는다
    await db.doc(`users/a/busy/${SAT}-2040`).set({ partyId: "next", start: Timestamp.fromMillis(at("2040")), end: Timestamp.fromMillis(at("2100")) });
    await db.runTransaction(async (tx) => releaseBusy(tx, db, { confirmed: fresh }));
    expect(await busyIds("a")).toEqual([`${SAT}-2040`]);
  });
});
