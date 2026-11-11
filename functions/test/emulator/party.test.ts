import { getApps, initializeApp } from "firebase-admin/app";
import { getFirestore, Timestamp, type Firestore } from "firebase-admin/firestore";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createParty, delegateLeader, joinParty, leaveParty } from "../../src/party/service";
import { evaluateSchedule } from "../../src/schedule/evaluate";
import { openSchedules } from "../../src/schedule/open";

const PROJECT = "demo-boss-planner";
const kst = (iso: string) => Date.parse(`${iso}+09:00`);

// 2026-11-12는 목요일
const THU = kst("2026-11-12T10:00:00");
const FRI = kst("2026-11-13T10:00:00");
const MON = kst("2026-11-09T10:00:00");
const PERIOD = "W-20261112";

let db: Firestore;

async function addUser(uid: string) {
  await db.doc(`users/${uid}`).set({ displayName: uid, apiKeyRegistered: true });
  await db.doc(`secrets/${uid}`).set({
    apiKey: "k",
    characters: { [`char-${uid}`]: { ocid: `ocid-${uid}`, name: `캐릭-${uid}`, world: "스카니아", job: "비숍", level: 280 } },
  });
}

const partyInput = (uid: string, extra: Record<string, unknown> = {}) => ({
  name: "스우팟",
  bossName: "스우",
  difficulty: "HARD",
  cycle: "WEEKLY",
  durationMinutes: 60,
  characterId: `char-${uid}`,
  ...extra,
});

const join = (uid: string, inviteCode: string, now: number) =>
  joinParty(db, uid, { inviteCode, characterId: `char-${uid}` }, now);

const submit = (partyId: string, uid: string, slots: string[], submitted = true) =>
  db.doc(`parties/${partyId}/schedules/${PERIOD}/unavailable/${uid}`).set({ slots, submitted, updatedAt: Timestamp.now() });

const vote = (partyId: string, uid: string, agreed: number[], round: number) =>
  db.doc(`parties/${partyId}/schedules/${PERIOD}/votes/${uid}`).set({ agreed, round, updatedAt: Timestamp.now() });

const schedule = async (partyId: string) => (await db.doc(`parties/${partyId}/schedules/${PERIOD}`).get()).data();

/** 하루의 모든 칸 (KST) */
function day(ymd: string, fromHour = 0, toHour = 24): string[] {
  const slots: string[] = [];
  for (let h = fromHour; h < toHour; h++) {
    slots.push(`${ymd}-${String(h).padStart(2, "0")}00`, `${ymd}-${String(h).padStart(2, "0")}30`);
  }
  return slots;
}
const WEEK = ["20261112", "20261113", "20261114", "20261115", "20261116", "20261117", "20261118"];
/** 주어진 날짜·시간대만 빼고 일주일 전부 불가 */
const allExcept = (ymd: string, fromHour: number, toHour: number) =>
  WEEK.flatMap((d) => day(d)).filter((slot) => !day(ymd, fromHour, toHour).includes(slot));

/** 목요일에 a가 만들고 b가 가입한 2인 파티 */
async function twoMemberParty() {
  const { partyId, inviteCode } = await createParty(db, "a", partyInput("a"), THU);
  await join("b", inviteCode, THU);
  return partyId;
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
  await Promise.all(["a", "b", "c"].map(addUser));
});

describe("createParty", () => {
  it("목요일에 만들면 이번 주기 일정이 바로 열린다", async () => {
    const { partyId, inviteCode } = await createParty(db, "a", partyInput("a"), THU);

    const party = (await db.doc(`parties/${partyId}`).get()).data()!;
    expect(party).toMatchObject({ leaderUid: "a", memberUids: ["a"], durationSlots: 2, scheduleStarted: true });
    expect(party.members.a).toMatchObject({ characterName: "캐릭-a", level: 280 });
    expect(JSON.stringify(party)).not.toContain("ocid");
    expect(inviteCode).toMatch(/^[A-HJ-NP-Z2-9]{6}$/);
    expect((await db.doc(`inviteCodes/${inviteCode}`).get()).get("partyId")).toBe(partyId);
    expect(await schedule(partyId)).toMatchObject({ state: "OPEN", round: 0, candidates: [] });
  });

  it("다른 요일에 만들면 다음 주기부터 시작한다", async () => {
    const { partyId } = await createParty(db, "a", partyInput("a"), MON);
    expect((await db.doc(`parties/${partyId}`).get()).get("scheduleStarted")).toBe(false);
    expect((await db.collection(`parties/${partyId}/schedules`).get()).size).toBe(0);

    expect(await openSchedules(db, "WEEKLY", kst("2026-11-12T00:00:00"))).toBe(1);
    expect(await schedule(partyId)).toMatchObject({ state: "OPEN" });
    expect((await db.doc(`parties/${partyId}`).get()).get("scheduleStarted")).toBe(true);
    // 다시 실행해도 기존 일정을 덮어쓰지 않는다.
    expect(await openSchedules(db, "WEEKLY", kst("2026-11-12T00:05:00"))).toBe(0);
  });

  it("남의 캐릭터나 잘못된 값은 거절한다", async () => {
    await expect(createParty(db, "a", partyInput("b"), THU)).rejects.toMatchObject({ code: "failed-precondition" });
    await expect(createParty(db, "a", partyInput("a", { durationMinutes: 45 }), THU)).rejects.toMatchObject({
      code: "invalid-argument",
    });
    await expect(createParty(db, "a", partyInput("a", { cycle: "DAILY" }), THU)).rejects.toMatchObject({
      code: "invalid-argument",
    });
  });
});

describe("가입·탈퇴·위임 시기", () => {
  it("첫 주기가 시작되기 전의 새 파티는 아무 요일에나 가입할 수 있다", async () => {
    const { partyId, inviteCode } = await createParty(db, "a", partyInput("a"), MON);
    await join("b", inviteCode.toLowerCase(), MON);
    expect((await db.doc(`parties/${partyId}`).get()).get("memberUids")).toEqual(["a", "b"]);
  });

  it("주기가 시작된 파티는 목요일에만 가입·탈퇴·위임할 수 있다", async () => {
    const { partyId, inviteCode } = await createParty(db, "a", partyInput("a"), THU);
    await join("b", inviteCode, THU);

    const notStartDay = { code: "failed-precondition", details: { reason: "not-start-day" } };
    await expect(join("c", inviteCode, FRI)).rejects.toMatchObject(notStartDay);
    await expect(leaveParty(db, "b", { partyId }, FRI)).rejects.toMatchObject(notStartDay);
    await expect(delegateLeader(db, "a", { partyId, newLeaderUid: "b" }, FRI)).rejects.toMatchObject(notStartDay);

    await delegateLeader(db, "a", { partyId, newLeaderUid: "b" }, THU);
    expect((await db.doc(`parties/${partyId}`).get()).get("leaderUid")).toBe("b");
  });

  it("일정이 확정된 뒤에는 목요일이어도 가입·탈퇴할 수 없다", async () => {
    const { partyId, inviteCode } = await createParty(db, "a", partyInput("a"), THU);
    await join("b", inviteCode, THU);
    await db.doc(`parties/${partyId}/schedules/${PERIOD}`).update({ state: "LOCKED" });

    const locked = { code: "failed-precondition", details: { reason: "schedule-not-open" } };
    await expect(join("c", inviteCode, THU)).rejects.toMatchObject(locked);
    await expect(leaveParty(db, "b", { partyId }, THU)).rejects.toMatchObject(locked);
  });

  it("잘못된 코드, 중복 가입, 정원 초과를 거절한다", async () => {
    const { partyId, inviteCode } = await createParty(db, "a", partyInput("a"), THU);
    await expect(join("b", "ZZZZZZ", THU)).rejects.toMatchObject({ code: "not-found" });
    await expect(join("a", inviteCode, THU)).rejects.toMatchObject({ code: "already-exists" });

    await db.doc(`parties/${partyId}`).update({ memberUids: ["a", "m2", "m3", "m4", "m5", "m6"] });
    await expect(join("b", inviteCode, THU)).rejects.toMatchObject({ details: { reason: "full" } });
  });

  it("파티장은 위임해야 나갈 수 있고, 마지막 한 명이 나가면 파티가 없어진다", async () => {
    const { partyId, inviteCode } = await createParty(db, "a", partyInput("a"), THU);
    await join("b", inviteCode, THU);
    await submit(partyId, "a", []);

    await expect(leaveParty(db, "a", { partyId }, THU)).rejects.toMatchObject({
      details: { reason: "leader-must-delegate" },
    });
    await expect(leaveParty(db, "c", { partyId }, THU)).rejects.toMatchObject({ code: "permission-denied" });

    expect(await leaveParty(db, "b", { partyId }, THU)).toEqual({ deleted: false });
    expect(await leaveParty(db, "a", { partyId }, THU)).toEqual({ deleted: true });
    expect((await db.doc(`parties/${partyId}`).get()).exists).toBe(false);
    expect((await db.doc(`inviteCodes/${inviteCode}`).get()).exists).toBe(false);
    expect((await db.collectionGroup("unavailable").get()).size).toBe(0);
  });
});

describe("추천과 투표", () => {
  it("전원이 제출해야 후보가 나오고, 빠른 순 3개를 준다", async () => {
    const partyId = await twoMemberParty();

    await submit(partyId, "a", day("20261112"));
    expect(await evaluateSchedule(db, partyId, PERIOD, THU)).toBe("waiting-inputs");
    // 체크만 하고 제출하지 않은 것은 입력으로 보지 않는다.
    await submit(partyId, "b", day("20261113"), false);
    expect(await evaluateSchedule(db, partyId, PERIOD, THU)).toBe("waiting-inputs");
    expect((await schedule(partyId))!.candidates).toEqual([]);

    await submit(partyId, "b", day("20261113"));
    expect(await evaluateSchedule(db, partyId, PERIOD, THU)).toBe("recommended");

    const result = (await schedule(partyId))!;
    // 목·금이 막혀 토요일 00:00부터 한 구간 → 1시간씩 앞에서부터
    expect(result.candidates.map((c: { slotId: string }) => c.slotId)).toEqual([
      "20261114-0000",
      "20261114-0100",
      "20261114-0200",
    ]);
    expect(result.candidates[0].end.toMillis() - result.candidates[0].start.toMillis()).toBe(60 * 60 * 1000);
    expect(result.round).toBe(1);

    // 같은 입력으로 다시 불러도 바뀌지 않는다.
    expect(await evaluateSchedule(db, partyId, PERIOD, THU)).toBe("waiting-votes");
    expect((await schedule(partyId))!.round).toBe(1);
  });

  it("불가 시간이 없어도 제출하면 입력으로 본다. 지난 시간은 추천하지 않는다", async () => {
    const partyId = await twoMemberParty();
    await submit(partyId, "a", []);
    await submit(partyId, "b", []);
    await evaluateSchedule(db, partyId, PERIOD, kst("2026-11-12T10:10:00"));
    expect((await schedule(partyId))!.candidates[0].slotId).toBe("20261112-1030");
  });

  it("다른 파티에서 확정된 시간은 불가 시간과 똑같이 뺀다", async () => {
    const partyId = await twoMemberParty();
    await db.doc("users/b/busy/20261114-2000").set({ partyId: "other" });
    await db.doc("users/b/busy/20261114-2030").set({ partyId: "other" });
    // 지난 주기의 busy는 상관없다.
    await db.doc("users/b/busy/20261107-2100").set({ partyId: "other" });

    await submit(partyId, "a", allExcept("20261114", 20, 23));
    await submit(partyId, "b", []);
    await evaluateSchedule(db, partyId, PERIOD, THU);

    expect((await schedule(partyId))!.candidates.map((c: { slotId: string }) => c.slotId)).toEqual([
      "20261114-2100",
      "20261114-2200",
    ]);
  });

  it("전원이 겹치는 시간이 없으면 그 주 미사용(SKIPPED)이 된다", async () => {
    const partyId = await twoMemberParty();
    await submit(partyId, "a", allExcept("20261114", 20, 22));
    await submit(partyId, "b", allExcept("20261115", 20, 22));

    expect(await evaluateSchedule(db, partyId, PERIOD, THU)).toBe("skipped");
    expect(await schedule(partyId)).toMatchObject({ state: "SKIPPED", skippedReason: "NO_COMMON_TIME", candidates: [] });
    expect(await evaluateSchedule(db, partyId, PERIOD, THU)).toBe("not-open");
  });

  it("전원이 동의한 후보만 unanimous에 들어간다", async () => {
    const partyId = await twoMemberParty();
    await submit(partyId, "a", []);
    await submit(partyId, "b", []);
    await evaluateSchedule(db, partyId, PERIOD, THU);

    await vote(partyId, "a", [0, 2], 1);
    expect(await evaluateSchedule(db, partyId, PERIOD, THU)).toBe("waiting-votes");
    await vote(partyId, "b", [2], 1);
    expect(await evaluateSchedule(db, partyId, PERIOD, THU)).toBe("unanimous");
    expect((await schedule(partyId))!.unanimous).toEqual([2]);

    // 투표를 바꾸면 다시 계산한다.
    await vote(partyId, "a", [0, 1, 2], 1);
    await vote(partyId, "b", [1, 2], 1);
    await evaluateSchedule(db, partyId, PERIOD, THU);
    expect((await schedule(partyId))!.unanimous).toEqual([1, 2]);
  });

  it("전원 동의가 없으면 다음 후보 3개로 넘어가고, 후보가 떨어지면 SKIPPED가 된다", async () => {
    const partyId = await twoMemberParty();
    // 토요일 20~24시만 가능 → 1시간 블록 4개
    await submit(partyId, "a", allExcept("20261114", 20, 24));
    await submit(partyId, "b", []);
    await evaluateSchedule(db, partyId, PERIOD, THU);

    await vote(partyId, "a", [0], 1);
    await vote(partyId, "b", [1], 1);
    expect(await evaluateSchedule(db, partyId, PERIOD, THU)).toBe("next-round");
    let current = (await schedule(partyId))!;
    expect(current.round).toBe(2);
    expect(current.candidates.map((c: { slotId: string }) => c.slotId)).toEqual(["20261114-2300"]);

    // 지난 라운드의 투표는 세지 않는다.
    expect(await evaluateSchedule(db, partyId, PERIOD, THU)).toBe("waiting-votes");

    await vote(partyId, "a", [], 2);
    await vote(partyId, "b", [0], 2);
    expect(await evaluateSchedule(db, partyId, PERIOD, THU)).toBe("skipped");
    current = (await schedule(partyId))!;
    expect(current).toMatchObject({ state: "SKIPPED", skippedReason: "NO_AGREEMENT" });
  });

  it("불가 시간을 고치면 후보와 투표가 처음부터 다시 시작된다", async () => {
    const partyId = await twoMemberParty();
    await submit(partyId, "a", []);
    await submit(partyId, "b", []);
    await evaluateSchedule(db, partyId, PERIOD, THU);
    await vote(partyId, "a", [0], 1);
    await vote(partyId, "b", [0], 1);
    await evaluateSchedule(db, partyId, PERIOD, THU);
    expect((await schedule(partyId))!.unanimous).toEqual([0]);

    await submit(partyId, "b", day("20261112"));
    expect(await evaluateSchedule(db, partyId, PERIOD, THU)).toBe("recommended");
    const current = (await schedule(partyId))!;
    expect(current).toMatchObject({ round: 2, unanimous: [] });
    expect(current.candidates[0].slotId).toBe("20261113-0000");

    // 제출을 취소하면 후보가 사라진다.
    await submit(partyId, "b", day("20261112"), false);
    expect(await evaluateSchedule(db, partyId, PERIOD, THU)).toBe("waiting-inputs");
    expect(await schedule(partyId)).toMatchObject({ round: 3, candidates: [], state: "OPEN" });
  });

  it("가입하면 후보가 비워지고, 탈퇴하면 남은 사람 기준으로 다시 계산한다", async () => {
    const { partyId, inviteCode } = await createParty(db, "a", partyInput("a"), THU);
    await join("b", inviteCode, THU);
    await submit(partyId, "a", []);
    await submit(partyId, "b", []);
    await evaluateSchedule(db, partyId, PERIOD, THU);
    expect((await schedule(partyId))!.candidates).toHaveLength(3);

    await join("c", inviteCode, THU);
    expect(await schedule(partyId)).toMatchObject({ candidates: [], state: "OPEN" });

    await submit(partyId, "c", allExcept("20261114", 20, 22));
    await evaluateSchedule(db, partyId, PERIOD, THU);
    expect((await schedule(partyId))!.candidates.map((c: { slotId: string }) => c.slotId)).toEqual(["20261114-2000", "20261114-2100"]);

    await leaveParty(db, "c", { partyId }, THU);
    const current = (await schedule(partyId))!;
    expect(current.candidates).toHaveLength(3);
    expect(current.candidates[0].slotId).toBe("20261112-1000");
    expect((await db.doc(`parties/${partyId}/schedules/${PERIOD}/unavailable/c`).get()).exists).toBe(false);
  });
});
