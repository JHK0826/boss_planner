import { getApps, initializeApp } from "firebase-admin/app";
import { getFirestore, Timestamp, type Firestore } from "firebase-admin/firestore";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createParty, joinParty, startSchedule } from "../../src/party/service";
import { openNextPeriod, openSchedules } from "../../src/schedule/open";

const PROJECT = "demo-boss-planner";
const kst = (iso: string) => Date.parse(`${iso}+09:00`);
// 2026-11-12(목) 10:00. 이번 주기 11/12 ~ 11/18, 다음 주기 11/19부터
const THU = kst("2026-11-12T10:00:00");
const SAT = kst("2026-11-14T22:00:00");
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

/** 파티장 a와 other가 있는 주간 파티 */
async function party(other: string, boss: string, start = true) {
  const { partyId, inviteCode } = await createParty(
    db,
    "a",
    { name: `${boss}팟`, bosses: [{ name: boss, difficulty: "HARD" }], durationMinutes: 20, characterId: "char-a" },
    THU,
  );
  await joinParty(db, other, { inviteCode, characterId: `char-${other}` }, THU);
  if (start) await startSchedule(db, "a", { partyId }, THU);
  return partyId;
}

/** 이번 주 레이드가 끝난 것처럼 다음 주 일정을 미리 연다 */
const finishThisWeek = (partyId: string, atMs = SAT) =>
  openNextPeriod(db, partyId, { cycle: "WEEKLY", state: "SETTLED", periodEnd: Timestamp.fromMillis(NEXT_THU) }, atMs);

const unavailable = (partyId: string, periodId: string, uid: string) => db.doc(`parties/${partyId}/schedules/${periodId}/unavailable/${uid}`);
const submit = (partyId: string, periodId: string, uid: string, slots: string[], extra: Record<string, unknown> = {}, atMs = SAT) =>
  unavailable(partyId, periodId, uid).set({ slots, submitted: true, updatedAt: Timestamp.fromMillis(atMs), ...extra });
const read = async (partyId: string, periodId: string, uid: string) => (await unavailable(partyId, periodId, uid).get()).data();

const NEXT_SLOTS = ["20261121-2000", "20261121-2030"];

beforeAll(() => {
  if (getApps().length === 0) initializeApp({ projectId: PROJECT });
  db = getFirestore();
});

beforeEach(async () => {
  await fetch(`http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, {
    method: "DELETE",
  });
  await Promise.all(["a", "b", "c", "d"].map(addUser));
});

describe("다른 파티에 낸 불가 시간을 새로 연 일정에 넣기", () => {
  it("한 파티에 다음 주 불가 시간을 냈으면, 다른 파티가 레이드를 끝내고 다음 주를 열 때 그대로 넣는다", async () => {
    const first = await party("b", "스우");
    const second = await party("c", "데미안");
    expect(await finishThisWeek(first)).toBe(NEXT);
    await submit(first, NEXT, "a", NEXT_SLOTS);

    expect(await finishThisWeek(second, SAT + 3600_000)).toBe(NEXT);
    expect(await read(second, NEXT, "a")).toMatchObject({ slots: NEXT_SLOTS, submitted: true, carriedFrom: first });
    // c는 다른 파티에 낸 것이 없으니 그대로 미입력
    expect(await read(second, NEXT, "c")).toBeUndefined();
  });

  it("'내 다른 파티에도 제출'을 끄고 냈거나, 아직 제출하지 않았으면 넣지 않는다", async () => {
    const first = await party("b", "스우");
    const second = await party("c", "데미안");
    await finishThisWeek(first);
    await submit(first, NEXT, "a", NEXT_SLOTS, { shareToOthers: false });
    await submit(first, NEXT, "b", NEXT_SLOTS, { submitted: false });
    await finishThisWeek(second);
    expect(await read(second, NEXT, "a")).toBeUndefined();
  });

  it("여러 파티에 냈으면 가장 최근 것을, 이미 낸 사람의 문서는 건드리지 않는다", async () => {
    const first = await party("b", "스우");
    const second = await party("c", "데미안");
    const third = await party("d", "루시드");
    await finishThisWeek(first);
    await finishThisWeek(second);
    await submit(first, NEXT, "a", ["20261121-2000"], {}, SAT);
    await submit(second, NEXT, "a", NEXT_SLOTS, {}, SAT + 60_000);
    // d는 third에 직접 미리 낸 상태(문서가 이미 있음)
    await submit(first, NEXT, "b", ["20261122-2000"]);
    await unavailable(third, NEXT, "d").set({ slots: [], submitted: false, updatedAt: Timestamp.fromMillis(SAT) });

    await finishThisWeek(third);
    expect(await read(third, NEXT, "a")).toMatchObject({ slots: NEXT_SLOTS, carriedFrom: second });
    expect(await read(third, NEXT, "d")).toMatchObject({ slots: [], submitted: false });
    expect((await read(third, NEXT, "d"))?.carriedFrom).toBeUndefined();
  });

  it("목요일 00:00에 새 주기를 열 때도 넣는다", async () => {
    const first = await party("b", "스우");
    const second = await party("c", "데미안");
    await finishThisWeek(first);
    await submit(first, NEXT, "a", NEXT_SLOTS);
    // second는 이번 주 레이드가 아직 안 끝나 미리 열지 않았다 → 목요일 00:00에 연다
    await openSchedules(db, "WEEKLY", NEXT_THU);
    expect(await read(second, NEXT, "a")).toMatchObject({ slots: NEXT_SLOTS, submitted: true, carriedFrom: first });
  });

  it("파티장이 이번 주기를 지금 시작할 때도 이번 주기에 낸 불가 시간을 넣는다", async () => {
    const first = await party("b", "스우");
    await submit(first, PERIOD, "a", ["20261114-2000"], {}, THU);
    const later = await party("c", "데미안", false);
    await startSchedule(db, "a", { partyId: later }, THU + 60_000);
    expect(await read(later, PERIOD, "a")).toMatchObject({ slots: ["20261114-2000"], submitted: true, carriedFrom: first });
  });
});
