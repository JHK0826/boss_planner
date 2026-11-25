import { getApps, initializeApp } from "firebase-admin/app";
import { getFirestore, Timestamp, type Firestore } from "firebase-admin/firestore";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { currentPeriod } from "../../src/domain/time";
import { createParty, joinParty, startSchedule, updatePartyPreferences } from "../../src/party/service";
import { resolveRaidResult } from "../../src/schedule/clear";
import { evaluateSchedule } from "../../src/schedule/evaluate";
import { newScheduleData } from "../../src/schedule/model";
import { openSchedules } from "../../src/schedule/open";
import { switchAssignedCandidate } from "../../src/schedule/switch";

const PROJECT = "demo-boss-planner";
const kst = (iso: string) => Date.parse(`${iso}+09:00`);
// 2026-11-12(목) 10:00. 이번 주기는 11/12(목) ~ 11/18(수), 다음 주기는 11/19(목)부터
const THU = kst("2026-11-12T10:00:00");
const NEXT_THU = kst("2026-11-19T00:00:00");
const PERIOD = "W-20261112";
const NEXT = "W-20261119";
const THIS_WEEK = ["20261112", "20261113", "20261114", "20261115", "20261116", "20261117", "20261118"];
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

/** 하루의 fromHour ~ toHour 칸 ID */
function day(ymd: string, fromHour = 0, toHour = 24): string[] {
  const slots: string[] = [];
  for (let row = fromHour * 2; row < toHour * 2; row++) {
    slots.push(`${ymd}-${String(Math.floor(row / 2)).padStart(2, "0")}${row % 2 === 0 ? "00" : "30"}`);
  }
  return slots;
}
/** 주어진 시간대만 빼고 그 주 전부 불가 */
const onlyFree = (week: string[], ...free: [string, number, number][]) => {
  const open = new Set(free.flatMap(([ymd, from, to]) => day(ymd, from, to)));
  return week.flatMap((d) => day(d)).filter((slot) => !open.has(slot));
};

const ref = (partyId: string, periodId = PERIOD) => db.doc(`parties/${partyId}/schedules/${periodId}`);
const data = async (partyId: string, periodId = PERIOD) => (await ref(partyId, periodId).get()).data()!;
const slotIds = async (partyId: string, periodId = PERIOD) =>
  ((await data(partyId, periodId)).candidates as { slotId: string }[]).map((c) => c.slotId);
const submit = (partyId: string, uid: string, slots: string[], periodId = PERIOD) =>
  ref(partyId, periodId).collection("unavailable").doc(uid).set({ slots, submitted: true, updatedAt: Timestamp.now() });
const busy = async (uid: string) => (await db.collection(`users/${uid}/busy`).get()).docs.map((doc) => doc.id);

/** a(파티장)·b 2인 파티, 이번 주기 시작 */
async function party(autoAssign: boolean, boss = "스우") {
  const { partyId, inviteCode } = await createParty(
    db,
    "a",
    { name: `${boss}팟`, bosses: [{ name: boss, difficulty: "HARD" }], durationMinutes: 60, characterId: "char-a", autoAssign },
    THU,
  );
  await joinParty(db, "b", { inviteCode, characterId: "char-b" }, THU);
  await startSchedule(db, "a", { partyId }, THU);
  return partyId;
}

/** 이번 주 레이드가 끝나 미리 연 다음 주 일정 */
async function preOpenNextWeek(partyId: string) {
  await ref(partyId, NEXT).set({ ...newScheduleData(currentPeriod("WEEKLY", NEXT_THU), 60), preOpened: true });
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

describe("투표 없이 자동 지정", () => {
  it("전원이 내는 순간 점수 1위로 확정하고 busy를 만든다. 투표는 보지 않는다", async () => {
    const partyId = await party(true);
    expect((await db.doc(`parties/${partyId}`).get()).get("autoAssign")).toBe(true);
    await submit(partyId, "a", onlyFree(THIS_WEEK, ["20261114", 20, 22]));
    expect(await evaluateSchedule(db, partyId, PERIOD, THU)).toBe("waiting-inputs");
    await ref(partyId).collection("votes").doc("b").set({ agreed: [1], round: 0, updatedAt: Timestamp.now() });

    await submit(partyId, "b", []);
    expect(await evaluateSchedule(db, partyId, PERIOD, THU)).toBe("auto-confirmed");
    const locked = await data(partyId);
    expect(locked).toMatchObject({ state: "LOCKED", confirmedBy: "AUTO", assignMode: "AUTO", unanimous: [] });
    expect(locked.confirmed).toMatchObject({ slotId: "20261114-2000", memberUids: ["a", "b"] });
    // 순위 후보 (점수순, 점수·이유 포함)
    expect(locked.candidates.map((c: { slotId: string }) => c.slotId)).toEqual(["20261114-2000", "20261114-2100"]);
    expect(locked.candidates[0]).toMatchObject({ score: expect.any(Number), reasons: [] });
    expect(await busy("a")).toEqual(["20261114-2000", "20261114-2030"]);
    expect((await db.doc("users/b/busy/20261114-2000").get()).get("characterId")).toBe("char-b");
    expect(await evaluateSchedule(db, partyId, PERIOD, THU)).toBe("not-open");
  });

  it("미리 연 다음 주는 예정만 두고, 목요일 전환에서 확정한다. 그 사이 1위가 막히면 다음 순위로 확정한다", async () => {
    const partyId = await party(true);
    await preOpenNextWeek(partyId);
    for (const uid of ["a", "b"]) await submit(partyId, uid, onlyFree(NEXT_WEEK, ["20261121", 20, 22]), NEXT);
    expect(await evaluateSchedule(db, partyId, NEXT, THU)).toBe("waiting-auto");
    expect(await data(partyId, NEXT)).toMatchObject({ state: "OPEN", assignMode: "AUTO" });
    expect(await slotIds(partyId, NEXT)).toEqual(["20261121-2000", "20261121-2100"]);
    // 입력이 그대로면 다시 계산하지 않는다.
    const round = (await data(partyId, NEXT)).round;
    expect(await evaluateSchedule(db, partyId, NEXT, THU)).toBe("waiting-auto");
    expect((await data(partyId, NEXT)).round).toBe(round);

    // 그 사이 a의 다른 파티가 토 20:00에 확정했다.
    for (const slotId of ["20261121-2000", "20261121-2030"]) {
      await db.doc(`users/a/busy/${slotId}`).set({ partyId: "other", periodId: NEXT });
    }
    await openSchedules(db, "WEEKLY", NEXT_THU);
    expect(await data(partyId, NEXT)).toMatchObject({
      state: "LOCKED",
      preOpened: false,
      confirmedBy: "AUTO",
      confirmed: { slotId: "20261121-2100" },
    });
  });

  it("조율 중에 자동 지정을 켜면 바로 확정되고, 미리 연 일정에서 끄면 투표 후보로 돌아간다", async () => {
    const partyId = await party(false);
    await submit(partyId, "a", onlyFree(THIS_WEEK, ["20261114", 20, 22]));
    await submit(partyId, "b", []);
    expect(await evaluateSchedule(db, partyId, PERIOD, THU)).toBe("recommended");
    expect(await data(partyId)).toMatchObject({ state: "OPEN", assignMode: "VOTE" });

    await preOpenNextWeek(partyId);
    for (const uid of ["a", "b"]) await submit(partyId, uid, onlyFree(NEXT_WEEK, ["20261121", 20, 22]), NEXT);
    await evaluateSchedule(db, partyId, NEXT, THU);

    await updatePartyPreferences(db, "a", { partyId, autoAssign: true }, THU);
    expect(await data(partyId)).toMatchObject({ state: "LOCKED", confirmedBy: "AUTO", confirmed: { slotId: "20261114-2000" } });
    // 미리 연 다음 주는 목요일 전이라 예정만
    expect(await data(partyId, NEXT)).toMatchObject({ state: "OPEN", assignMode: "AUTO" });

    await updatePartyPreferences(db, "a", { partyId, autoAssign: false }, THU);
    expect(await data(partyId, NEXT)).toMatchObject({ state: "OPEN", assignMode: "VOTE" });
    await expect(updatePartyPreferences(db, "a", { partyId, autoAssign: "yes" }, THU)).rejects.toMatchObject({
      details: { field: "autoAssign" },
    });
  });

  it("미클리어로 재조정되면 남은 기간의 다음 시간으로 바로 확정한다", async () => {
    const partyId = await party(true);
    await submit(partyId, "a", onlyFree(THIS_WEEK, ["20261114", 20, 22], ["20261115", 20, 22]));
    await submit(partyId, "b", []);
    await evaluateSchedule(db, partyId, PERIOD, THU);
    expect((await data(partyId)).confirmed.slotId).toBe("20261114-2000");

    await resolveRaidResult(db, ref(partyId), false, "MANUAL", kst("2026-11-14T21:10:00"));
    expect(await data(partyId)).toMatchObject({
      state: "LOCKED",
      retryCount: 1,
      confirmedBy: "AUTO",
      confirmed: { slotId: "20261115-2000" },
    });
    expect(await busy("b")).toEqual(["20261115-2000", "20261115-2030"]);
  });

  it("평소 시간: 최근 레이드가 토 21:00이었으면 토 21:00을 고른다", async () => {
    const partyId = await party(true);
    // 지난 두 주의 레이드 기록 (토요일 21:00)
    for (const [periodId, start, raid] of [
      ["W-20261105", "2026-11-05T00:00:00", "2026-11-07T21:00:00"],
      ["W-20261029", "2026-10-29T00:00:00", "2026-10-31T21:00:00"],
    ]) {
      await ref(partyId, periodId).set({
        state: "SETTLED",
        periodStart: Timestamp.fromMillis(kst(start)),
        confirmed: { slotId: "x", start: Timestamp.fromMillis(kst(raid)), end: Timestamp.fromMillis(kst(raid) + 3600_000), memberUids: ["a", "b"] },
      });
    }
    // 토요일 10~24시가 다 되면, 기록이 없을 때는 가장 이른 10:00이 1위다.
    await submit(partyId, "a", onlyFree(THIS_WEEK, ["20261114", 10, 24]));
    await submit(partyId, "b", []);
    await evaluateSchedule(db, partyId, PERIOD, THU);
    const locked = await data(partyId);
    expect(locked.confirmed.slotId).toBe("20261114-2100");
    expect(locked.candidates[0].reasons).toContain("USUAL_TIME");
  });
});

describe("자동 지정 후 파티장이 다른 순위로 교체", () => {
  /** 토 20~22시, 일 20~22시만 되는 자동 지정 파티: 토 20:00으로 확정, 후보 토 20:00·토 21:00·일 20:00 */
  async function lockedParty() {
    const partyId = await party(true);
    await submit(partyId, "a", onlyFree(THIS_WEEK, ["20261114", 20, 22], ["20261115", 20, 22]));
    await submit(partyId, "b", []);
    await evaluateSchedule(db, partyId, PERIOD, THU);
    return partyId;
  }
  const change = (partyId: string, uid: string, candidateIndex: number, now = THU) =>
    switchAssignedCandidate(db, uid, { partyId, periodId: PERIOD, candidateIndex }, now);

  it("파티장이 바꾸면 busy가 옮겨지고 확정 시간이 바뀐다", async () => {
    const partyId = await lockedParty();
    expect(await slotIds(partyId)).toEqual(["20261114-2000", "20261114-2100", "20261115-2000"]);
    await expect(change(partyId, "b", 2)).rejects.toMatchObject({ details: { reason: "not-leader" } });
    await expect(change(partyId, "a", 0)).rejects.toMatchObject({ details: { reason: "same" } });

    expect(await change(partyId, "a", 2)).toEqual({ slotId: "20261115-2000" });
    expect(await data(partyId)).toMatchObject({ state: "LOCKED", confirmedBy: "LEADER", confirmed: { slotId: "20261115-2000", memberUids: ["a", "b"] } });
    for (const uid of ["a", "b"]) expect(await busy(uid)).toEqual(["20261115-2000", "20261115-2030"]);
  });

  it("다른 파티와 겹치거나 기한이 지나면 거절한다", async () => {
    const partyId = await lockedParty();
    await db.doc("users/b/busy/20261114-2100").set({ partyId: "other", periodId: PERIOD });
    await expect(change(partyId, "a", 1)).rejects.toMatchObject({ details: { reason: "conflict", conflictUids: ["b"] } });
    // 지금 확정 시간(토 20:00) 4시간 전이 지나면 바꿀 수 없다.
    await expect(change(partyId, "a", 2, kst("2026-11-14T16:00:00"))).rejects.toMatchObject({ details: { reason: "deadline-passed" } });
  });

  it("4시간 안에 시작하는 후보로는 바꿀 수 없고, 투표 모드 일정은 바꿀 수 없다", async () => {
    const partyId = await party(true);
    // 토 07~08시(새벽 보정)와 토 20~21시 → 토 20:00 확정, 2위는 토 07:00
    await submit(partyId, "a", onlyFree(THIS_WEEK, ["20261114", 7, 8], ["20261114", 20, 21]));
    await submit(partyId, "b", []);
    await evaluateSchedule(db, partyId, PERIOD, THU);
    expect(await slotIds(partyId)).toEqual(["20261114-2000", "20261114-0700"]);
    await expect(change(partyId, "a", 1, kst("2026-11-14T04:00:00"))).rejects.toMatchObject({ details: { reason: "too-soon" } });

    const votingParty = await party(false, "데미안");
    await expect(
      switchAssignedCandidate(db, "a", { partyId: votingParty, periodId: PERIOD, candidateIndex: 0 }, THU),
    ).rejects.toMatchObject({ details: { reason: "not-auto" } });
  });
});
