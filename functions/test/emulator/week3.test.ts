import { getApps, initializeApp } from "firebase-admin/app";
import { getFirestore, Timestamp, type Firestore } from "firebase-admin/firestore";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { NexonBossContent } from "../../src/nexon/client";
import { createParty, joinParty, leaveParty } from "../../src/party/service";
import { approveChange, requestChange } from "../../src/schedule/change";
import { resolveRaidResult, runDailyClearCheck } from "../../src/schedule/clear";
import { confirmSchedule } from "../../src/schedule/confirm";
import { evaluateSchedule } from "../../src/schedule/evaluate";
import { sweepSchedules } from "../../src/schedule/sweep";

const PROJECT = "demo-boss-planner";
const kst = (iso: string) => Date.parse(`${iso}+09:00`);
// 2026-11-12는 목요일
const THU = kst("2026-11-12T10:00:00");
const PERIOD = "W-20261112";
const WEEK = ["20261112", "20261113", "20261114", "20261115", "20261116", "20261117", "20261118"];

/** 같은 캐릭터가 두 파티에 들어가려면 보스가 달라야 한다. */
const OTHER_BOSS = [{ name: "데미안", difficulty: "HARD" }];

let db: Firestore;

function day(ymd: string, fromHour = 0, toHour = 24): string[] {
  const slots: string[] = [];
  for (let h = fromHour; h < toHour; h++) {
    slots.push(`${ymd}-${String(h).padStart(2, "0")}00`, `${ymd}-${String(h).padStart(2, "0")}30`);
  }
  return slots;
}
/** 주어진 시간대들만 빼고 일주일 전부 불가 */
const allExcept = (...free: [string, number, number][]) => {
  const open = new Set(free.flatMap(([ymd, from, to]) => day(ymd, from, to)));
  return WEEK.flatMap((d) => day(d)).filter((slot) => !open.has(slot));
};

async function addUser(uid: string) {
  await db.doc(`users/${uid}`).set({ displayName: uid, apiKeyRegistered: true });
  await db.doc(`secrets/${uid}`).set({
    apiKey: `key-${uid}`,
    charactersFetchedAt: Timestamp.fromMillis(THU),
    characters: { [`char-${uid}`]: { ocid: `ocid-${uid}`, name: `캐릭-${uid}`, world: "스카니아", job: "비숍", level: 280 } },
  });
}

const scheduleRef = (partyId: string) => db.doc(`parties/${partyId}/schedules/${PERIOD}`);
const schedule = async (partyId: string) => (await scheduleRef(partyId).get()).data()!;
const submit = (partyId: string, uid: string, slots: string[]) =>
  scheduleRef(partyId).collection("unavailable").doc(uid).set({ slots, submitted: true, updatedAt: Timestamp.now() });
const vote = (partyId: string, uid: string, agreed: number[], round: number) =>
  scheduleRef(partyId).collection("votes").doc(uid).set({ agreed, round, updatedAt: Timestamp.now() });
const busyIds = async (uid: string) => (await db.collection(`users/${uid}/busy`).get()).docs.map((d) => d.id);

/**
 * 목요일에 만든 파티. 후보가 나오고 전원이 0번 후보에 동의한 상태까지 만든다.
 * free: 전원이 가능한 시간대 (기본: 토요일 20~22시 → 후보 20:00, 21:00)
 */
async function partyReadyToConfirm(
  leader: string,
  members: string[],
  free: [string, number, number][] = [["20261114", 20, 22]],
  name = "스우팟",
  bosses: { name: string; difficulty: string }[] = [{ name: "스우", difficulty: "HARD" }],
  durationMinutes = 60,
) {
  const { partyId, inviteCode } = await createParty(
    db,
    leader,
    { name, bosses, durationMinutes, characterId: `char-${leader}` },
    THU,
  );
  for (const uid of members) await joinParty(db, uid, { inviteCode, characterId: `char-${uid}` }, THU);
  const all = [leader, ...members];
  await submit(partyId, leader, allExcept(...free));
  for (const uid of members) await submit(partyId, uid, []);
  await evaluateSchedule(db, partyId, PERIOD, THU);
  const round = (await schedule(partyId)).round as number;
  for (const uid of all) await vote(partyId, uid, [0], round);
  await evaluateSchedule(db, partyId, PERIOD, THU);
  return partyId;
}

const confirm = (partyId: string, uid: string, candidateIndex = 0, now = THU) =>
  confirmSchedule(db, uid, { partyId, periodId: PERIOD, candidateIndex }, now);

beforeAll(() => {
  if (getApps().length === 0) initializeApp({ projectId: PROJECT });
  db = getFirestore();
});

beforeEach(async () => {
  await fetch(
    `http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`,
    { method: "DELETE" },
  );
  await Promise.all(["a", "b", "c"].map(addUser));
});

describe("confirmSchedule", () => {
  it("파티장이 전원 동의 후보를 확정하면 LOCKED가 되고 전원의 busy가 기록된다", async () => {
    const partyId = await partyReadyToConfirm("a", ["b"]);

    await expect(confirm(partyId, "b")).rejects.toMatchObject({ details: { reason: "not-leader" } });
    await expect(confirm(partyId, "a", 1)).rejects.toMatchObject({ details: { reason: "not-unanimous" } });
    await expect(confirm(partyId, "a", 7)).rejects.toMatchObject({ details: { reason: "not-unanimous" } });

    expect(await confirm(partyId, "a")).toEqual({ slotId: "20261114-2000" });
    const locked = await schedule(partyId);
    expect(locked.state).toBe("LOCKED");
    expect(locked.confirmed).toMatchObject({ slotId: "20261114-2000", memberUids: ["a", "b"] });
    expect(await busyIds("a")).toEqual(["20261114-2000", "20261114-2030"]);
    expect(await busyIds("b")).toEqual(["20261114-2000", "20261114-2030"]);
    expect((await db.doc("users/b/busy/20261114-2000").get()).data()).toMatchObject({
      partyId,
      partyName: "스우팟",
      bosses: [{ name: "스우", difficulty: "HARD" }],
    });

    await expect(confirm(partyId, "a")).rejects.toMatchObject({ details: { reason: "not-open" } });
  });

  it("투표가 바뀌었는데 unanimous가 아직 옛 값이어도 실제 투표로 판단한다", async () => {
    const partyId = await partyReadyToConfirm("a", ["b"]);
    await vote(partyId, "b", [1], (await schedule(partyId)).round);
    // evaluateSchedule을 부르지 않아 schedule.unanimous는 아직 [0]이다.
    await expect(confirm(partyId, "a")).rejects.toMatchObject({ details: { reason: "not-unanimous" } });
  });

  it("이미 지난 후보는 확정할 수 없다", async () => {
    const partyId = await partyReadyToConfirm("a", ["b"]);
    await expect(confirm(partyId, "a", 0, kst("2026-11-14T20:00:00"))).rejects.toMatchObject({
      details: { reason: "past" },
    });
  });

  it("같은 사람이 속한 다른 파티의 확정 시간과 겹치면 거절한다", async () => {
    // b가 두 파티에 속한다. 두 파티 모두 토요일 20시가 후보다.
    const first = await partyReadyToConfirm("a", ["b"]);
    const second = await partyReadyToConfirm("c", ["b"], [["20261114", 20, 21]], "두번째", OTHER_BOSS);
    await confirm(first, "a");

    await expect(confirm(second, "c")).rejects.toMatchObject({
      code: "failed-precondition",
      details: { reason: "conflict", conflictUids: ["b"] },
    });
    expect((await schedule(second)).state).toBe("OPEN");
    expect(await busyIds("c")).toEqual([]);
  });

  it("두 파티가 동시에 확정해도 한쪽만 성공한다", async () => {
    const first = await partyReadyToConfirm("a", ["b"]);
    const second = await partyReadyToConfirm("c", ["b"], [["20261114", 20, 21]], "두번째", OTHER_BOSS);

    const results = await Promise.allSettled([confirm(first, "a"), confirm(second, "c")]);

    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const states = [(await schedule(first)).state, (await schedule(second)).state].sort();
    expect(states).toEqual(["LOCKED", "OPEN"]);
    expect(await busyIds("b")).toEqual(["20261114-2000", "20261114-2030"]);
  });

  it("다른 파티가 확정한 뒤에 계산한 추천에서는 그 시간이 빠진다", async () => {
    const first = await partyReadyToConfirm("a", ["b"]);
    await confirm(first, "a");
    // 두 번째 파티는 토요일 20~23시가 가능하지만 b가 20~21시에 이미 잡혀 있다.
    const second = await partyReadyToConfirm("c", ["b"], [["20261114", 20, 23]], "두번째", OTHER_BOSS);
    expect((await schedule(second)).candidates.map((c: { slotId: string }) => c.slotId)).toEqual([
      "20261114-2100",
      "20261114-2200",
    ]);
    await confirm(second, "c");
    expect(await busyIds("b")).toEqual(["20261114-2000", "20261114-2030", "20261114-2100", "20261114-2130"]);
  });

  it("확정된 뒤에는 목요일이어도 탈퇴할 수 없다", async () => {
    const partyId = await partyReadyToConfirm("a", ["b"]);
    await confirm(partyId, "a");
    await expect(leaveParty(db, "b", { partyId }, THU)).rejects.toMatchObject({
      details: { reason: "schedule-not-open" },
    });
  });
});

describe("일정 변경 요청", () => {
  const request = (partyId: string, uid: string, now: number) =>
    requestChange(db, uid, { partyId, periodId: PERIOD, reason: "야근" }, now);
  const respond = (partyId: string, uid: string, approve: boolean, now: number) =>
    approveChange(db, uid, { partyId, periodId: PERIOD, approve }, now);

  it("레이드 전날 23:59까지만 요청할 수 있다", async () => {
    const partyId = await partyReadyToConfirm("a", ["b"]);
    await expect(request(partyId, "b", THU)).rejects.toMatchObject({ details: { reason: "not-locked" } });
    await confirm(partyId, "a");

    await expect(request(partyId, "c", THU)).rejects.toMatchObject({ details: { reason: "not-member" } });
    await expect(request(partyId, "b", kst("2026-11-14T00:00:00"))).rejects.toMatchObject({
      details: { reason: "deadline-passed" },
    });

    await request(partyId, "b", kst("2026-11-13T23:59:59"));
    expect((await schedule(partyId)).changeRequest).toMatchObject({ requestedBy: "b", reason: "야근", status: "PENDING" });
    await expect(request(partyId, "a", THU)).rejects.toMatchObject({ details: { reason: "already-requested" } });
  });

  it("파티장이 승인하면 확정이 풀리고 OPEN으로 돌아가 다시 입력을 받는다", async () => {
    const partyId = await partyReadyToConfirm("a", ["b"]);
    await confirm(partyId, "a");
    await request(partyId, "b", THU);

    await expect(respond(partyId, "b", true, THU)).rejects.toMatchObject({ details: { reason: "not-leader" } });
    expect(await respond(partyId, "a", true, THU)).toEqual({ approved: true });

    const reopened = await schedule(partyId);
    expect(reopened).toMatchObject({ state: "OPEN", confirmed: null, candidates: [], unanimous: [] });
    expect(reopened.changeRequest.status).toBe("APPROVED");
    expect(await busyIds("a")).toEqual([]);
    expect(await busyIds("b")).toEqual([]);

    // 요청한 사람이 다시 제출하기 전에는 추천이 나오지 않는다.
    expect(await evaluateSchedule(db, partyId, PERIOD, THU)).toBe("waiting-inputs");
    await submit(partyId, "b", day("20261114"));
    await submit(partyId, "a", allExcept(["20261114", 20, 22], ["20261115", 20, 22]));
    expect(await evaluateSchedule(db, partyId, PERIOD, THU)).toBe("recommended");
    expect((await schedule(partyId)).candidates[0].slotId).toBe("20261115-2000");
  });

  it("거절하면 일정은 그대로다. 레이드가 시작된 뒤에는 승인할 수 없다", async () => {
    const partyId = await partyReadyToConfirm("a", ["b"]);
    await confirm(partyId, "a");
    await request(partyId, "b", THU);
    expect(await respond(partyId, "a", false, THU)).toEqual({ approved: false });
    expect(await schedule(partyId)).toMatchObject({ state: "LOCKED", changeRequest: { status: "REJECTED" } });
    await expect(respond(partyId, "a", true, THU)).rejects.toMatchObject({ details: { reason: "no-request" } });

    await request(partyId, "b", THU);
    await expect(respond(partyId, "a", true, kst("2026-11-14T20:00:00"))).rejects.toMatchObject({
      details: { reason: "raid-started" },
    });
  });
});

describe("클리어 확인과 재조정", () => {
  const AFTER_RAID = kst("2026-11-14T21:10:00");

  it("직접 기록한 클리어는 SETTLED가 된다. 레이드 시작 전의 기록은 받지 않는다", async () => {
    const partyId = await partyReadyToConfirm("a", ["b"]);
    await confirm(partyId, "a");
    expect(await resolveRaidResult(db, scheduleRef(partyId), true, "MANUAL", kst("2026-11-14T19:00:00"))).toBe("ignored");
    expect(await resolveRaidResult(db, scheduleRef(partyId), true, "MANUAL", AFTER_RAID)).toBe("settled");
    expect(await schedule(partyId)).toMatchObject({ state: "SETTLED", clearedBy: "MANUAL" });
    // 이미 끝난 일정에는 다시 반영하지 않는다.
    expect(await resolveRaidResult(db, scheduleRef(partyId), false, "MANUAL", AFTER_RAID)).toBe("ignored");
  });

  it("미클리어면 RETRY가 되어 확정이 풀리고 남은 기간으로 바로 다시 추천한다", async () => {
    const partyId = await partyReadyToConfirm("a", ["b"], [["20261114", 20, 21], ["20261116", 20, 21]]);
    await confirm(partyId, "a");
    await scheduleRef(partyId).collection("clears").doc("b").set({ result: "NOT_CLEARED", recordedAt: Timestamp.now() });

    expect(await resolveRaidResult(db, scheduleRef(partyId), false, "MANUAL", AFTER_RAID)).toBe("retry");

    const retry = await schedule(partyId);
    expect(retry).toMatchObject({ state: "RETRY", confirmed: null, retryCount: 1, unanimous: [] });
    // 이전 불가 시간을 그대로 써서, 지난 토요일은 빼고 월요일이 추천된다.
    expect(retry.candidates.map((c: { slotId: string }) => c.slotId)).toEqual(["20261116-2000"]);
    expect(await busyIds("a")).toEqual([]);
    expect((await scheduleRef(partyId).collection("clears").get()).size).toBe(0);

    // 재조정에서도 투표 → 확정 절차는 같다.
    await vote(partyId, "a", [0], retry.round);
    await vote(partyId, "b", [0], retry.round);
    await confirm(partyId, "a", 0, AFTER_RAID);
    expect(await schedule(partyId)).toMatchObject({ state: "LOCKED", confirmed: { slotId: "20261116-2000" } });
  });

  it("재조정할 시간이 남지 않았으면 EXPIRED가 된다", async () => {
    // 다시 잡을 공통 시간이 없는 경우
    const noTime = await partyReadyToConfirm("a", ["b"]);
    await confirm(noTime, "a");
    expect(await resolveRaidResult(db, scheduleRef(noTime), false, "MANUAL", AFTER_RAID)).toBe("retry");
    expect(await schedule(noTime)).toMatchObject({ state: "EXPIRED", expiredReason: "NO_COMMON_TIME" });

    // 수요일 밤 레이드를 목요일(주기 종료 뒤)에 미클리어로 확인한 경우
    const lastDay = await partyReadyToConfirm("c", [], [["20261118", 22, 23]], "막날팟");
    await confirm(lastDay, "c");
    expect(await resolveRaidResult(db, scheduleRef(lastDay), false, "API", kst("2026-11-19T05:00:00"))).toBe("expired");
    expect(await schedule(lastDay)).toMatchObject({ state: "EXPIRED", expiredReason: "NOT_CLEARED" });
  });

  it("예정 시각이 지나면 VERIFYING으로, 주기가 끝난 미확정 일정은 종료로 바뀐다", async () => {
    const locked = await partyReadyToConfirm("a", ["b"]);
    await confirm(locked, "a");
    const open = await partyReadyToConfirm("c", [], [["20261115", 20, 21]], "미확정");

    expect(await sweepSchedules(db, kst("2026-11-14T20:30:00"))).toEqual({ verifying: 0, closed: 0 });
    expect(await sweepSchedules(db, kst("2026-11-14T21:00:00"))).toEqual({ verifying: 1, closed: 0 });
    expect((await schedule(locked)).state).toBe("VERIFYING");

    expect(await sweepSchedules(db, kst("2026-11-19T00:00:00"))).toEqual({ verifying: 0, closed: 1 });
    expect(await schedule(open)).toMatchObject({ state: "SKIPPED", skippedReason: "PERIOD_ENDED" });
  });
});

describe("runDailyClearCheck", () => {
  const boss = (complete: boolean, difficulty = "hard"): NexonBossContent[] => [
    { content_name: "스우", difficulty: "normal", cycle: "bossWeekly", complete_flag: "false" },
    { content_name: "스우", difficulty, cycle: "bossWeekly", complete_flag: String(complete) },
  ];
  /** apiKey별 응답을 정해 둔 가짜 NEXON 클라이언트 */
  function fakeNexon(responses: Record<string, NexonBossContent[] | Error>) {
    const getBossContents = vi.fn(async (apiKey: string, _ocid: string, _date?: string) => {
      const response = responses[apiKey];
      if (!response || response instanceof Error) throw response ?? new Error("no key");
      return response;
    });
    const makeClient = (apiKey: string) => ({
      getBossContents: (ocid: string, date?: string) => getBossContents(apiKey, ocid, date),
      listCharacters: async () => [],
    });
    return { makeClient, getBossContents };
  }

  async function lockedParty() {
    const partyId = await partyReadyToConfirm("a", ["b"], [["20261114", 20, 21], ["20261116", 20, 21]]);
    await confirm(partyId, "a");
    return partyId;
  }

  it("기록이 없는 일정을 레이드 날짜 기준으로 조회해 클리어면 SETTLED로 만든다", async () => {
    const partyId = await lockedParty();
    const { makeClient, getBossContents } = fakeNexon({ "key-a": new Error("expired key"), "key-b": boss(true) });

    const counts = await runDailyClearCheck(db, kst("2026-11-15T05:00:00"), makeClient);

    expect(counts).toMatchObject({ settled: 1 });
    expect(await schedule(partyId)).toMatchObject({ state: "SETTLED", clearedBy: "API" });
    // a의 키가 실패해도 b의 키로 확인한다. date는 레이드 날짜, ocid는 파티에 넣은 캐릭터의 것이다.
    expect(getBossContents).toHaveBeenLastCalledWith("key-b", "ocid-b", "2026-11-14");
  });

  it("확인된 사람이 모두 미클리어면 재조정으로 넘긴다", async () => {
    const partyId = await lockedParty();
    const { makeClient } = fakeNexon({ "key-a": boss(false), "key-b": boss(false) });

    expect(await runDailyClearCheck(db, kst("2026-11-15T05:00:00"), makeClient)).toMatchObject({ retry: 1 });
    expect(await schedule(partyId)).toMatchObject({ state: "RETRY", candidates: [{ slotId: "20261116-2000" }] });
  });

  it("아무도 확인하지 못하면 VERIFYING으로 두고, 주기가 끝나고 이틀이 지나면 만료시킨다", async () => {
    const partyId = await lockedParty();
    // 난이도가 달라 해당 보스 항목을 찾지 못하는 경우
    const { makeClient } = fakeNexon({ "key-a": boss(true, "extreme"), "key-b": new Error("maintenance") });

    expect(await runDailyClearCheck(db, kst("2026-11-15T05:00:00"), makeClient)).toMatchObject({ unknown: 1 });
    expect((await schedule(partyId)).state).toBe("VERIFYING");

    expect(await runDailyClearCheck(db, kst("2026-11-21T05:00:00"), makeClient)).toMatchObject({ expired: 1 });
    expect(await schedule(partyId)).toMatchObject({ state: "EXPIRED", expiredReason: "UNVERIFIED" });
  });

  it("묶음 파티는 묶은 보스를 모두 클리어해야 클리어로 본다", async () => {
    const bundle = [{ name: "스우", difficulty: "HARD" }, { name: "데미안", difficulty: "HARD" }];
    const contents = (demianDone: boolean): NexonBossContent[] => [
      { content_name: "스우", difficulty: "hard", cycle: "bossWeekly", complete_flag: "true" },
      { content_name: "데미안", difficulty: "hard", cycle: "bossWeekly", complete_flag: String(demianDone) },
    ];

    const partial = await partyReadyToConfirm("a", ["b"], [["20261114", 20, 21], ["20261116", 20, 21]], "묶음", bundle, 40);
    await confirm(partial, "a");
    expect((await schedule(partial)).confirmed.end.toMillis()).toBe(kst("2026-11-14T20:40:00"));
    expect(await busyIds("a")).toEqual(["20261114-2000", "20261114-2030"]);

    const one = fakeNexon({ "key-a": contents(false), "key-b": contents(false) });
    expect(await runDailyClearCheck(db, kst("2026-11-15T05:00:00"), one.makeClient)).toMatchObject({ retry: 1 });

    const round = (await schedule(partial)).round;
    await vote(partial, "a", [0], round);
    await vote(partial, "b", [0], round);
    await confirm(partial, "a", 0, kst("2026-11-15T05:00:00"));
    const both = fakeNexon({ "key-a": contents(true) });
    expect(await runDailyClearCheck(db, kst("2026-11-17T05:00:00"), both.makeClient)).toMatchObject({ settled: 1 });
  });

  it("방금 끝난 레이드는 API 반영을 기다린다", async () => {
    const partyId = await lockedParty();
    const { makeClient, getBossContents } = fakeNexon({ "key-a": boss(true) });
    await runDailyClearCheck(db, kst("2026-11-14T21:10:00"), makeClient);
    expect(getBossContents).not.toHaveBeenCalled();
    expect((await schedule(partyId)).state).toBe("VERIFYING");
  });

  it("30일이 지난 캐릭터 목록을 다시 받는다", async () => {
    await db.doc("secrets/a").update({ charactersFetchedAt: Timestamp.fromMillis(kst("2026-10-01T00:00:00")) });
    const listCharacters = vi.fn(async () => [
      { ocid: "new-ocid", character_name: "새캐릭", world_name: "루나", character_class: "히어로", character_level: 200 },
    ]);
    await runDailyClearCheck(db, kst("2026-11-15T05:00:00"), () => ({ getBossContents: async () => [], listCharacters }));

    expect(listCharacters).toHaveBeenCalledTimes(1);
    const characters = (await db.doc("secrets/a").get()).get("characters");
    expect(Object.values(characters)).toMatchObject([{ ocid: "new-ocid", name: "새캐릭" }]);
  });
});
