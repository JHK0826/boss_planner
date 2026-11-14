import { getApps, initializeApp } from "firebase-admin/app";
import { getFirestore, Timestamp, type Firestore } from "firebase-admin/firestore";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createParty, delegateLeader, joinParty, leaveParty, updatePartyPreferences } from "../../src/party/service";
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
  bosses: [{ name: "스우", difficulty: "HARD" }],
  durationMinutes: 60,
  // 추천 시각을 단순하게 확인하려고 기본 테스트에서는 최소 여유 시간을 끈다.
  minLeadMinutes: 0,
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
    expect(party).toMatchObject({
      leaderUid: "a",
      memberUids: ["a"],
      bosses: [{ name: "스우", difficulty: "HARD" }],
      cycle: "WEEKLY",
      durationMinutes: 60,
      durationSlots: 2,
      scheduleStarted: true,
    });
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
    await expect(createParty(db, "a", partyInput("a", { durationMinutes: 10 }), THU)).rejects.toMatchObject({
      code: "invalid-argument",
    });
  });

  it("목록에 없는 보스(시즌 보스 포함), 없는 난이도, 주간·월간 혼합은 거절한다", async () => {
    const withBosses = (bosses: unknown) => createParty(db, "a", partyInput("a", { bosses }), THU);
    const reason = (value: string) => ({ code: "invalid-argument", details: { reason: value } });

    await expect(withBosses([])).rejects.toMatchObject(reason("empty"));
    await expect(withBosses([{ name: "시즌 보스 메이린", difficulty: "HARD" }])).rejects.toMatchObject(reason("unknown-boss"));
    await expect(withBosses([{ name: "스우", difficulty: "CHAOS" }])).rejects.toMatchObject(reason("bad-difficulty"));
    await expect(
      withBosses([{ name: "스우", difficulty: "HARD" }, { name: "스우", difficulty: "NORMAL" }]),
    ).rejects.toMatchObject(reason("duplicate"));
    await expect(
      withBosses([{ name: "스우", difficulty: "HARD" }, { name: "검은 마법사", difficulty: "HARD" }]),
    ).rejects.toMatchObject(reason("mixed-cycle"));
  });

  it("여러 보스를 묶을 수 있고, 주기는 보스에서 정해진다", async () => {
    const bundle = await createParty(
      db,
      "a",
      partyInput("a", {
        bosses: [{ name: "발드릭스", difficulty: "HARD" }, { name: "벨로나", difficulty: "HARD" }],
        durationMinutes: 40,
      }),
      THU,
    );
    expect((await db.doc(`parties/${bundle.partyId}`).get()).data()).toMatchObject({
      bosses: [{ name: "발드릭스", difficulty: "HARD" }, { name: "벨로나", difficulty: "HARD" }],
      cycle: "WEEKLY",
      durationMinutes: 40,
      durationSlots: 2,
    });

    // 클라이언트가 보낸 cycle은 믿지 않는다. 검은 마법사는 월간이다.
    const monthly = await createParty(
      db,
      "b",
      partyInput("b", { bosses: [{ name: "검은 마법사", difficulty: "HARD" }], cycle: "WEEKLY" }),
      THU,
    );
    expect((await db.doc(`parties/${monthly.partyId}`).get()).get("cycle")).toBe("MONTHLY");
  });
});

describe("같은 캐릭터의 보스 중복", () => {
  const bundle = [{ name: "발드릭스", difficulty: "HARD" }, { name: "벨로나", difficulty: "HARD" }];
  const duplicate = (...bosses: string[]) => ({ code: "failed-precondition", details: { reason: "duplicate-boss", bosses } });

  it("묶음 파티에 넣은 캐릭터로는 그 보스가 들어간 파티를 또 만들 수 없다", async () => {
    await createParty(db, "a", partyInput("a", { bosses: bundle, durationMinutes: 40 }), THU);

    await expect(
      createParty(db, "a", partyInput("a", { bosses: [{ name: "벨로나", difficulty: "NORMAL" }] }), THU),
    ).rejects.toMatchObject(duplicate("벨로나"));
    await expect(
      createParty(db, "a", partyInput("a", { bosses: [{ name: "스우", difficulty: "HARD" }, ...bundle] }), THU),
    ).rejects.toMatchObject(duplicate("발드릭스", "벨로나"));

    // 겹치지 않는 보스는 만들 수 있다.
    await createParty(db, "a", partyInput("a"), THU);
  });

  it("다른 캐릭터로는 같은 보스 파티를 만들 수 있다", async () => {
    await db.doc("secrets/a").update({
      "characters.char-a2": { ocid: "ocid-a2", name: "부캐", world: "스카니아", job: "히어로", level: 260 },
    });
    await createParty(db, "a", partyInput("a", { bosses: bundle }), THU);
    await createParty(db, "a", { ...partyInput("a", { bosses: bundle }), characterId: "char-a2" }, THU);
  });

  it("가입할 때도 같은 캐릭터의 보스 중복을 막는다", async () => {
    await createParty(db, "b", partyInput("b", { bosses: bundle }), THU);
    const other = await createParty(db, "a", partyInput("a", { bosses: [{ name: "벨로나", difficulty: "EASY" }] }), THU);

    await expect(join("b", other.inviteCode, THU)).rejects.toMatchObject(duplicate("벨로나"));
    await join("c", other.inviteCode, THU);
  });

  it("파티에서 나가면 그 보스로 다시 만들 수 있다", async () => {
    const first = await createParty(db, "a", partyInput("a", { bosses: bundle }), THU);
    await leaveParty(db, "a", { partyId: first.partyId }, THU);
    await createParty(db, "a", partyInput("a", { bosses: bundle }), THU);
  });
});

describe("추천 설정", () => {
  const slotIds = async (partyId: string) =>
    (await schedule(partyId))!.candidates.map((c: { slotId: string }) => c.slotId);
  /** 주말 21:00~24:00 */
  const WEEKEND_NIGHT = { days: [6, 7], startRow: 42, endRow: 48 };

  it("선호 시간대 안의 시각을 먼저 추천한다", async () => {
    const { partyId } = await createParty(db, "a", partyInput("a", { preferredWindow: WEEKEND_NIGHT }), THU);
    expect((await db.doc(`parties/${partyId}`).get()).get("preferredWindow")).toEqual(WEEKEND_NIGHT);
    await submit(partyId, "a", []);
    await evaluateSchedule(db, partyId, PERIOD, THU);

    const ids = await slotIds(partyId);
    // 토·일은 21:00이 뽑히고(선호), 나머지 요일은 가장 이른 정각이 뽑힌다.
    expect(ids).toContain("20261114-2100");
    expect(ids).toContain("20261115-2100");
    expect(ids).not.toContain("20261114-0000");
  });

  it("최소 여유 시간 안쪽은 추천하지 않는다. 기본값은 3시간이다", async () => {
    const { partyId } = await createParty(db, "a", partyInput("a", { minLeadMinutes: undefined }), THU);
    expect((await db.doc(`parties/${partyId}`).get()).get("minLeadMinutes")).toBe(180);
    await submit(partyId, "a", []);
    await evaluateSchedule(db, partyId, PERIOD, THU);
    // 목요일 10:00 + 3시간
    expect((await slotIds(partyId))[0]).toBe("20261112-1300");
  });

  it("여유 시간을 지키면 남는 시각이 없을 때는 여유 시간 없이 추천한다", async () => {
    const { partyId } = await createParty(db, "a", partyInput("a", { minLeadMinutes: 1440 }), THU);
    // 오늘 12~13시만 가능
    await submit(partyId, "a", allExcept("20261112", 12, 13));
    await evaluateSchedule(db, partyId, PERIOD, THU);
    expect(await slotIds(partyId)).toEqual(["20261112-1200"]);
  });

  it("잘못된 설정은 거절한다", async () => {
    const create = (extra: Record<string, unknown>) => createParty(db, "a", partyInput("a", extra), THU);
    for (const preferredWindow of [
      { days: [], startRow: 0, endRow: 2 },
      { days: [8], startRow: 0, endRow: 2 },
      { days: [1, 1], startRow: 0, endRow: 2 },
      { days: [1], startRow: 10, endRow: 10 },
      { days: [1], startRow: 0, endRow: 49 },
    ]) {
      await expect(create({ preferredWindow })).rejects.toMatchObject({ details: { field: "preferredWindow" } });
    }
    for (const minLeadMinutes of [-30, 45, 3000, "60"]) {
      await expect(create({ minLeadMinutes })).rejects.toMatchObject({ details: { field: "minLeadMinutes" } });
    }
  });

  it("파티장이 설정을 바꾸면 후보를 다시 계산한다", async () => {
    const { partyId, inviteCode } = await createParty(db, "a", partyInput("a"), THU);
    await join("b", inviteCode, THU);
    await submit(partyId, "a", []);
    await submit(partyId, "b", []);
    await evaluateSchedule(db, partyId, PERIOD, THU);
    expect((await slotIds(partyId))[0]).toBe("20261112-1000");
    const before = (await schedule(partyId))!.round;

    await expect(
      updatePartyPreferences(db, "b", { partyId, preferredWindow: WEEKEND_NIGHT }, THU),
    ).rejects.toMatchObject({ details: { reason: "not-leader" } });

    await updatePartyPreferences(db, "a", { partyId, preferredWindow: WEEKEND_NIGHT, minLeadMinutes: 360 }, THU);
    const after = (await schedule(partyId))!;
    expect(after.round).toBe(before + 1);
    // 여유 6시간 → 목요일은 16:00부터, 주말은 21:00
    expect(await slotIds(partyId)).toEqual(expect.arrayContaining(["20261112-1600", "20261114-2100", "20261115-2100"]));

    // 같은 설정을 다시 저장해도 후보는 그대로다.
    await updatePartyPreferences(db, "a", { partyId, minLeadMinutes: 360 }, THU);
    expect((await schedule(partyId))!.round).toBe(before + 1);

    // 선호 시간대를 없앨 수 있다.
    await updatePartyPreferences(db, "a", { partyId, preferredWindow: null }, THU);
    expect((await db.doc(`parties/${partyId}`).get()).get("preferredWindow")).toBeNull();
  });
});

describe("여러 파티를 함께 고려", () => {
  const slotIds = async (partyId: string) =>
    (await schedule(partyId))!.candidates.map((c: { slotId: string }) => c.slotId);
  const OTHER = { bosses: [{ name: "데미안", difficulty: "HARD" }], name: "데미안팟" };

  /** 토요일 20:00~22:30만 가능한 1시간 30분짜리 파티. 가능한 시작은 20:00, 20:30, 21:00이고 서로 겹친다. */
  async function ninetyMinuteParty(members: string[]) {
    const { partyId, inviteCode } = await createParty(db, "c", partyInput("c", { ...OTHER, durationMinutes: 90 }), THU);
    for (const uid of members) await join(uid, inviteCode, THU);
    await submit(partyId, "c", [...allExcept("20261114", 20, 23), "20261114-2230"]);
    for (const uid of members) await submit(partyId, uid, []);
    await evaluateSchedule(db, partyId, PERIOD, THU);
    return partyId;
  }

  /** a와 b의 파티: 토요일 20:00~21:00이 후보로 올라 투표 중이다. */
  async function partyVotingOnSaturdayEight() {
    const { partyId, inviteCode } = await createParty(db, "a", partyInput("a"), THU);
    await join("b", inviteCode, THU);
    await submit(partyId, "a", allExcept("20261114", 20, 21));
    await submit(partyId, "b", []);
    await evaluateSchedule(db, partyId, PERIOD, THU);
    expect(await slotIds(partyId)).toEqual(["20261114-2000"]);
  }

  it("파티원이 겹치는 다른 파티가 투표 중인 후보와 겹치지 않는 시각을 추천한다", async () => {
    await partyVotingOnSaturdayEight();
    // b가 두 파티에 모두 있다. 20:00과 20:30은 저쪽 후보(20:00~21:00)와 겹치므로 21:00을 준다.
    expect(await slotIds(await ninetyMinuteParty(["b"]))).toEqual(["20261114-2100"]);
  });

  it("파티원이 겹치지 않는 파티의 후보는 상관하지 않는다", async () => {
    await partyVotingOnSaturdayEight();
    // 겹치는 사람이 없으면 가장 이른 정각인 20:00을 준다.
    expect(await slotIds(await ninetyMinuteParty([]))).toEqual(["20261114-2000"]);
  });

  it("파티원의 다른 확정 레이드 바로 앞뒤 시각을 먼저 추천한다", async () => {
    // b가 다른 파티에서 토요일 21:00~22:00이 확정되어 있다.
    await db.doc("users/b/busy/20261114-2100").set({ partyId: "other" });
    await db.doc("users/b/busy/20261114-2130").set({ partyId: "other" });

    const { partyId, inviteCode } = await createParty(db, "a", partyInput("a"), THU);
    await join("b", inviteCode, THU);
    // 토요일 12~24시 가능 → 21:00대를 빼면 정각 시작이 11개라 6개만 뽑힌다.
    await submit(partyId, "a", allExcept("20261114", 12, 24));
    await submit(partyId, "b", []);
    await evaluateSchedule(db, partyId, PERIOD, THU);

    // 이른 시각 4개와 함께, 확정 레이드 바로 앞(20:00)과 바로 뒤(22:00)가 16~19시를 제치고 들어간다.
    expect(await slotIds(partyId)).toEqual([
      "20261114-1200",
      "20261114-1300",
      "20261114-1400",
      "20261114-1500",
      "20261114-2000",
      "20261114-2200",
    ]);
  });
});

describe("소요 시간", () => {
  it("20분 단위 소요 시간은 30분 칸에서 시작하고, 끝나는 시각은 실제 소요 시간으로 잡는다", async () => {
    const { partyId, inviteCode } = await createParty(db, "a", partyInput("a", { durationMinutes: 20 }), THU);
    await join("b", inviteCode, THU);
    await submit(partyId, "a", allExcept("20261114", 20, 21));
    await submit(partyId, "b", []);
    await evaluateSchedule(db, partyId, PERIOD, THU);

    const result = (await schedule(partyId))!;
    expect(result).toMatchObject({ durationMinutes: 20, durationSlots: 1 });
    // 20분짜리는 30분 칸 하나씩: 20:00~20:20, 20:30~20:50
    expect(result.candidates.map((c: { slotId: string }) => c.slotId)).toEqual(["20261114-2000", "20261114-2030"]);
    expect(result.candidates[0].end.toMillis() - result.candidates[0].start.toMillis()).toBe(20 * 60 * 1000);
  });

  it("40분은 30분 칸 두 개가 비어 있어야 한다", async () => {
    const { partyId } = await createParty(db, "a", partyInput("a", { durationMinutes: 40 }), THU);
    // 20:00~20:30만 비면 부족하고, 21:00~22:00은 충분하다.
    await submit(partyId, "a", allExcept("20261114", 21, 22).filter((slot) => slot !== "20261114-2000"));
    await evaluateSchedule(db, partyId, PERIOD, THU);

    const result = (await schedule(partyId))!;
    expect(result.candidates.map((c: { slotId: string }) => c.slotId)).toEqual(["20261114-2100"]);
    expect(result.candidates[0].end.toMillis() - result.candidates[0].start.toMillis()).toBe(40 * 60 * 1000);
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
  it("전원이 제출해야 후보가 나오고, 요일마다 하나씩 최대 6개를 준다", async () => {
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
    // 목·금이 막혀 토~수 5일이 가능 → 요일마다 가장 이른 정각 하나씩, 남는 한 자리는 토요일의 두 번째
    expect(result.candidates.map((c: { slotId: string }) => c.slotId)).toEqual([
      "20261114-0000",
      "20261114-0100",
      "20261115-0000",
      "20261116-0000",
      "20261117-0000",
      "20261118-0000",
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
    // 10:10 이후의 첫 정각
    expect((await schedule(partyId))!.candidates[0].slotId).toBe("20261112-1100");
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

  it("전원 동의가 없으면 다음 후보로 넘어가고, 후보가 떨어지면 SKIPPED가 된다", async () => {
    const partyId = await twoMemberParty();
    // 토요일 20~24시만 가능 → 겹치지 않는 1시간 4개
    await submit(partyId, "a", allExcept("20261114", 20, 24));
    await submit(partyId, "b", []);
    await evaluateSchedule(db, partyId, PERIOD, THU);
    const slotIds = async () => (await schedule(partyId))!.candidates.map((c: { slotId: string }) => c.slotId);
    expect(await slotIds()).toEqual(["20261114-2000", "20261114-2100", "20261114-2200", "20261114-2300"]);

    await vote(partyId, "a", [0], 1);
    await vote(partyId, "b", [1], 1);
    expect(await evaluateSchedule(db, partyId, PERIOD, THU)).toBe("next-round");
    expect((await schedule(partyId))!.round).toBe(2);
    // 이미 보여 준 시각은 빼고, 30분씩 어긋난 시각이 나온다.
    expect(await slotIds()).toEqual(["20261114-2030", "20261114-2130", "20261114-2230"]);

    // 지난 라운드의 투표는 세지 않는다.
    expect(await evaluateSchedule(db, partyId, PERIOD, THU)).toBe("waiting-votes");

    await vote(partyId, "a", [], 2);
    await vote(partyId, "b", [0], 2);
    expect(await evaluateSchedule(db, partyId, PERIOD, THU)).toBe("skipped");
    expect(await schedule(partyId)).toMatchObject({ state: "SKIPPED", skippedReason: "NO_AGREEMENT" });
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
    expect((await schedule(partyId))!.candidates).toHaveLength(6);

    await join("c", inviteCode, THU);
    expect(await schedule(partyId)).toMatchObject({ candidates: [], state: "OPEN" });

    await submit(partyId, "c", allExcept("20261114", 20, 22));
    await evaluateSchedule(db, partyId, PERIOD, THU);
    expect((await schedule(partyId))!.candidates.map((c: { slotId: string }) => c.slotId)).toEqual(["20261114-2000", "20261114-2100"]);

    await leaveParty(db, "c", { partyId }, THU);
    const current = (await schedule(partyId))!;
    expect(current.candidates).toHaveLength(6);
    expect(current.candidates[0].slotId).toBe("20261112-1000");
    expect((await db.doc(`parties/${partyId}/schedules/${PERIOD}/unavailable/c`).get()).exists).toBe(false);
  });
});
