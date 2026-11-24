import { getApps, initializeApp } from "firebase-admin/app";
import { getFirestore, Timestamp, type Firestore } from "firebase-admin/firestore";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { deleteStaleSchedulerCaches } from "../../src/characterRefresh";
import { finalizeEarnings, getSchedulerState } from "../../src/earnings/service";
import type { NexonBossContent } from "../../src/nexon/client";
import { createParty, joinParty } from "../../src/party/service";
import { runDailyClearCheck } from "../../src/schedule/clear";
import { confirmReceived, markPaid, registerSettlement } from "../../src/settlement/service";

const PROJECT = "demo-boss-planner";
const kst = (iso: string) => Date.parse(`${iso}+09:00`);
// 2026-11-12는 목요일
const THU = kst("2026-11-12T10:00:00");
const PRICES = { "림보|HARD": 900_000_000, "스우|HARD": 300_000_000, "검은 마법사|HARD": 1_000_000_000 };

let db: Firestore;

async function addUser(uid: string) {
  await db.doc(`users/${uid}`).set({ displayName: uid, apiKeyRegistered: true, selectedCharacterIds: [`char-${uid}`] });
  await db.doc(`secrets/${uid}`).set({
    apiKey: `key-${uid}`,
    charactersFetchedAt: Timestamp.fromMillis(THU),
    characters: { [`char-${uid}`]: { ocid: `ocid-${uid}`, name: `캐릭-${uid}`, world: "스카니아", job: "비숍", level: 280 } },
  });
}

const boss = (name: string, cycle: string, complete: boolean, registered = true): NexonBossContent => ({
  content_name: name,
  difficulty: "hard",
  cycle,
  registration_flag: String(registered),
  complete_flag: String(complete),
});

/** apiKey별 응답을 정해 둔 가짜 NEXON 클라이언트 */
function fakeNexon(contents: NexonBossContent[]) {
  const getBossContents = vi.fn(async (_apiKey: string, _ocid: string, _date?: string) => contents);
  const makeClient = (apiKey: string) => ({ getBossContents: (ocid: string, date?: string) => getBossContents(apiKey, ocid, date) });
  return { makeClient, getBossContents };
}

const earnings = async (uid: string, id: string) => (await db.doc(`users/${uid}/earnings/${id}`).get()).data();

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

describe("getSchedulerState", () => {
  const contents = [
    boss("림보", "bossWeekly", true),
    boss("스우", "bossWeekly", false),
    boss("자쿰", "bossDaily", true), // 일간은 빼고
    boss("데미안", "bossWeekly", true, false), // 등록 안 한 보스도 뺀다
    boss("검은 마법사", "bossMonthly", true),
  ];

  it("등록한 보스와 인원수·결정석 몫을 주고, 이번 주·이번 달 결정석 수익을 기록한다", async () => {
    // a·b·c 3인 림보 파티
    const { inviteCode } = await createParty(db, "a", { name: "림보팟", bosses: [{ name: "림보", difficulty: "HARD" }], durationMinutes: 20, characterId: "char-a" }, THU);
    await joinParty(db, "b", { inviteCode, characterId: "char-b" }, THU);
    await joinParty(db, "c", { inviteCode, characterId: "char-c" }, THU);
    const { makeClient, getBossContents } = fakeNexon(contents);
    const now = kst("2026-11-14T12:00:00");

    const result = await getSchedulerState(db, "a", {}, now, makeClient, PRICES);

    expect(getBossContents).toHaveBeenCalledWith("key-a", "ocid-a", undefined);
    expect(result.characters["char-a"].bosses.map((b) => [b.name, b.cycle, b.cleared, b.partySize, b.share])).toEqual([
      ["림보", "WEEKLY", true, 3, 300_000_000],
      ["스우", "WEEKLY", false, 1, 300_000_000],
      ["검은 마법사", "MONTHLY", true, 1, 1_000_000_000],
    ]);
    expect(result.characters["char-a"]).toMatchObject({ fetchedAtMs: now, error: null });
    expect((await earnings("a", "W-20261112"))?.characters["char-a"]).toEqual({ crystalValue: 300_000_000, crystalCount: 1 });
    expect((await earnings("a", "M-202611"))?.characters["char-a"]).toEqual({ crystalValue: 1_000_000_000, crystalCount: 1 });
  });

  it("10분 안에는 저장해 둔 값을 쓰고, 새로고침은 1분이 지나야 다시 부른다", async () => {
    const { makeClient, getBossContents } = fakeNexon(contents);
    const t0 = kst("2026-11-14T12:00:00");
    await getSchedulerState(db, "a", {}, t0, makeClient, PRICES);
    await getSchedulerState(db, "a", {}, t0 + 5 * 60_000, makeClient, PRICES);
    await getSchedulerState(db, "a", { refresh: true }, t0 + 30_000, makeClient, PRICES);
    expect(getBossContents).toHaveBeenCalledTimes(1);

    await getSchedulerState(db, "a", { refresh: true }, t0 + 2 * 60_000, makeClient, PRICES);
    await getSchedulerState(db, "a", {}, t0 + 13 * 60_000, makeClient, PRICES);
    expect(getBossContents).toHaveBeenCalledTimes(3);
  });

  it("받지 못하면 저장해 둔 값과 이유를 함께 준다", async () => {
    await getSchedulerState(db, "a", {}, THU, fakeNexon(contents).makeClient, PRICES);
    const failing = () => ({
      getBossContents: async (): Promise<NexonBossContent[]> => {
        throw new Error("network");
      },
    });
    const result = await getSchedulerState(db, "a", { refresh: true }, THU + 5 * 60_000, failing, PRICES);
    expect(result.characters["char-a"].bosses).toHaveLength(3);
    expect(result.characters["char-a"].error).toBe("알 수 없는 오류가 발생했습니다.");
    expect(result.characters["char-a"].fetchedAtMs).toBe(THU);
  });

  it("API Key가 없으면 거절한다", async () => {
    await db.doc("secrets/a").delete();
    await expect(getSchedulerState(db, "a", {}, THU, fakeNexon(contents).makeClient)).rejects.toMatchObject({ details: { reason: "no-api-key" } });
  });
});

describe("finalizeEarnings", () => {
  it("목요일에는 끝난 주를 수요일 날짜로 다시 조회해 확정한다", async () => {
    const { makeClient, getBossContents } = fakeNexon([boss("림보", "bossWeekly", true), boss("스우", "bossWeekly", true)]);
    expect(await finalizeEarnings(db, kst("2026-11-19T05:00:00"), makeClient, PRICES)).toBe(3);
    expect(getBossContents).toHaveBeenCalledWith("key-a", "ocid-a", "2026-11-18");
    expect((await earnings("a", "W-20261112"))?.characters["char-a"]).toEqual({ crystalValue: 1_200_000_000, crystalCount: 2 });
    // 월간 기록은 1일에만
    expect(await earnings("a", "M-202611")).toBeUndefined();
  });

  it("1일에는 끝난 달의 월간 보스를 말일 날짜로 확정한다", async () => {
    const { makeClient, getBossContents } = fakeNexon([boss("검은 마법사", "bossMonthly", true)]);
    await finalizeEarnings(db, kst("2026-12-01T05:00:00"), makeClient, PRICES);
    expect(getBossContents).toHaveBeenCalledWith("key-a", "ocid-a", "2026-11-30");
    expect((await earnings("a", "M-202611"))?.characters["char-a"]).toEqual({ crystalValue: 1_000_000_000, crystalCount: 1 });
  });

  it("매일 05:00 작업이 목요일에 끝난 주를 실제 가격표로 확정한다", async () => {
    const { makeClient, getBossContents } = fakeNexon([boss("림보", "bossWeekly", true)]);
    await runDailyClearCheck(db, kst("2026-11-19T05:00:00"), (apiKey) => ({
      ...makeClient(apiKey),
      listCharacters: async () => [],
      getCharacterBasic: async () => {
        throw new Error("unused");
      },
    }));
    expect(getBossContents).toHaveBeenCalledWith("key-a", "ocid-a", "2026-11-18");
    // 하드 림보 23억 8500만, 혼자
    expect((await earnings("a", "W-20261112"))?.characters["char-a"]).toEqual({ crystalValue: 2_385_000_000, crystalCount: 1 });
  });

  it("목요일·1일이 아니면 아무것도 하지 않는다", async () => {
    const { makeClient, getBossContents } = fakeNexon([]);
    expect(await finalizeEarnings(db, kst("2026-11-17T05:00:00"), makeClient, PRICES)).toBe(0);
    expect(getBossContents).not.toHaveBeenCalled();
  });
});

describe("정산금 기록", () => {
  it("수령 확인하면 받는 사람의, 정산이 끝나면 판매자의 그 주 기록에 들어간다", async () => {
    const { partyId } = await createParty(db, "a", { name: "스우팟", bosses: [{ name: "스우", difficulty: "HARD" }], durationMinutes: 20, characterId: "char-a" }, THU);
    await db.doc(`parties/${partyId}`).update({ memberUids: ["a", "b"], "members.b": { characterId: "char-b", displayName: "b" } });
    const raidAt = Timestamp.fromMillis(kst("2026-11-14T21:00:00"));
    const periodId = "W-20261112";
    await db.doc(`parties/${partyId}/schedules/${periodId}`).set({ state: "SETTLED", confirmed: { start: raidAt, memberUids: ["a", "b"] }, settlement: null });

    await registerSettlement(db, "a", { partyId, periodId, saleAmount: 100_000_000, feePercent: 5 });
    // 아직 아무도 번 돈이 없다.
    expect(await earnings("b", "W-20261112")).toBeUndefined();

    await markPaid(db, "a", { partyId, periodId, recipientUid: "b" });
    await confirmReceived(db, "b", { partyId, periodId });

    const key = `${partyId}_${periodId}`;
    // b: 정산금 48,717,900에서 경매장 수수료 5%를 뗀 금액
    expect((await earnings("b", "W-20261112"))?.settlements[key]).toMatchObject({ characterId: "char-b", partyName: "스우팟", amount: 46_282_005 });
    // a(판매자): 실수령 9500만 - 48,717,900
    expect((await earnings("a", "W-20261112"))?.settlements[key]).toMatchObject({ characterId: "char-a", amount: 46_282_100 });
  });
});

describe("스케줄러 캐시 정리", () => {
  it("25일이 지난 캐시만 지운다", async () => {
    await db.doc("users/a/scheduler/char-a").set({ bosses: [], fetchedAt: Timestamp.fromMillis(kst("2026-10-01T00:00:00")) });
    await db.doc("users/b/scheduler/char-b").set({ bosses: [], fetchedAt: Timestamp.fromMillis(kst("2026-11-14T00:00:00")) });
    expect(await deleteStaleSchedulerCaches(db, kst("2026-11-15T05:00:00"))).toBe(1);
    expect((await db.doc("users/a/scheduler/char-a").get()).exists).toBe(false);
    expect((await db.doc("users/b/scheduler/char-b").get()).exists).toBe(true);
  });
});
