import { describe, expect, it } from "vitest";
import { BOSS_CATALOG } from "../../src/domain/bosses";
import { CRYSTAL_PRICES, crystalPrice, crystalPriceList } from "../../src/domain/crystals";
import {
  clearedSummary,
  monthIdOf,
  monthOfWeekId,
  partySizeFor,
  priceBosses,
  registeredBosses,
  settlementShares,
  weekIdOf,
} from "../../src/domain/earnings";

const kst = (iso: string) => Date.parse(`${iso}+09:00`);
const prices = { "스우|HARD": 300_000_000, "림보|HARD": 900_000_000, "검은 마법사|HARD": 1_000_000_000 };

describe("결정석 가격표", () => {
  it("이름과 난이도(대소문자 무관)로 찾고, 없으면 null", () => {
    expect(crystalPrice("스우", "hard", prices)).toBe(300_000_000);
    expect(crystalPrice("스우", "EXTREME", prices)).toBeNull();
    expect(crystalPriceList(prices)).toContainEqual({ name: "검은 마법사", difficulty: "HARD", price: 1_000_000_000 });
  });

  it("파티로 갈 수 있는 보스·난이도는 모두 가격이 있다 (보스를 추가하면 가격도 넣어야 한다)", () => {
    const combos = BOSS_CATALOG.flatMap((boss) => boss.difficulties.map((difficulty) => ({ name: boss.name, difficulty })));
    expect(combos).toHaveLength(56);
    expect(combos.filter((c) => crystalPrice(c.name, c.difficulty) === null)).toEqual([]);
    expect(Object.keys(CRYSTAL_PRICES)).toHaveLength(56);
  });

  it("게임 목록 값과 같고, 이름의 띄어쓰기는 보지 않는다", () => {
    expect(crystalPrice("발드릭스", "extreme")).toBe(9_600_000_000);
    expect(crystalPrice("검은 마법사", "EXTREME")).toBe(5_680_000_000);
    expect(crystalPrice("감시자 칼로스", "EXTREME")).toBe(4_104_000_000);
    expect(crystalPrice("자쿰", "chaos")).toBe(4_040_000);
    // 게임 목록은 "블러디 퀸", 스케줄러 API와 보스 목록은 "블러디퀸"
    expect(crystalPrice("블러디 퀸", "CHAOS")).toBe(4_070_000);
    expect(crystalPrice("블러디퀸", "CHAOS")).toBe(4_070_000);
  });
});

describe("스케줄러 보스", () => {
  // 실제 응답 형식: 플래그는 문자열, 난이도는 소문자, 일간 보스도 섞여 온다.
  const contents = [
    { content_name: "자쿰", difficulty: "normal", cycle: "bossDaily", registration_flag: "true", complete_flag: "true" },
    { content_name: "자쿰", difficulty: "chaos", cycle: "bossWeekly", registration_flag: "false", complete_flag: "false" },
    { content_name: "스우", difficulty: "hard", cycle: "bossWeekly", registration_flag: "true", complete_flag: "true" },
    { content_name: "림보", difficulty: "hard", cycle: "bossWeekly", registration_flag: "true", complete_flag: "false" },
    { content_name: "검은 마법사", difficulty: "hard", cycle: "bossMonthly", registration_flag: "true", complete_flag: "true" },
  ];

  it("스케줄러에 등록한 주간·월간 보스만 고른다", () => {
    expect(registeredBosses(contents)).toEqual([
      { name: "스우", difficulty: "HARD", cycle: "WEEKLY", cleared: true },
      { name: "림보", difficulty: "HARD", cycle: "WEEKLY", cleared: false },
      { name: "검은 마법사", difficulty: "HARD", cycle: "MONTHLY", cleared: true },
    ]);
  });

  it("그 캐릭터로 그 보스를 묶은 파티가 있으면 파티 인원으로 나눈다", () => {
    const parties = [
      { memberUids: ["me", "b", "c"], members: { me: { characterId: "char1" } }, bosses: [{ name: "림보" }, { name: "발드릭스" }] },
      // 다른 캐릭터로 들어간 파티는 보지 않는다.
      { memberUids: ["me", "b"], members: { me: { characterId: "char2" } }, bosses: [{ name: "스우" }] },
    ];
    expect(partySizeFor(parties, "me", "char1", "림보")).toBe(3);
    expect(partySizeFor(parties, "me", "char1", "스우")).toBe(1);
    expect(partySizeFor(parties, "me", "char2", "스우")).toBe(2);

    const priced = priceBosses(registeredBosses(contents), parties, "me", "char1", prices);
    expect(priced.map((b) => [b.name, b.partySize, b.share])).toEqual([
      ["스우", 1, 300_000_000],
      ["림보", 3, 300_000_000],
      ["검은 마법사", 1, 1_000_000_000],
    ]);
    // 클리어한 것만 센다. 림보는 아직 안 잡았다.
    expect(clearedSummary(priced, "WEEKLY")).toEqual({ crystalValue: 300_000_000, crystalCount: 1 });
    expect(clearedSummary(priced, "MONTHLY")).toEqual({ crystalValue: 1_000_000_000, crystalCount: 1 });
  });

  it("가격이 없는 보스는 0으로 센다", () => {
    const priced = priceBosses([{ name: "카링", difficulty: "HARD", cycle: "WEEKLY", cleared: true }], [], "me", "c", prices);
    expect(priced[0]).toMatchObject({ price: null, share: 0, partySize: 1 });
    expect(clearedSummary(priced, "WEEKLY")).toEqual({ crystalValue: 0, crystalCount: 1 });
  });
});

describe("수익 기록 기간", () => {
  it("주간은 목요일 시작, 월간은 그 달", () => {
    expect(weekIdOf(kst("2026-11-25T23:59:00"))).toBe("W-20261119");
    expect(weekIdOf(kst("2026-11-26T00:00:00"))).toBe("W-20261126");
    expect(monthIdOf(kst("2026-11-30T12:00:00"))).toBe("M-202611");
    // 11/26(목)에 시작한 주는 12월에 끝나도 11월로 묶는다.
    expect(monthOfWeekId("W-20261126")).toBe("M-202611");
  });
});

describe("정산금", () => {
  const settlement = { sellerUid: "a", feePercent: 5, sellerAmount: 46_282_100, completed: false };

  it("받는 사람은 수령 확인 뒤에 경매장 수수료를 뗀 금액을 번다", () => {
    const entries = [
      { uid: "b", amount: 48_717_900, status: "RECEIVED" },
      { uid: "c", amount: 48_717_900, status: "PAID" },
    ];
    expect(settlementShares(settlement, entries)).toEqual({ b: 46_282_005 });
  });

  it("판매자는 정산이 끝나야 남은 몫을 번다", () => {
    const entries = [{ uid: "b", amount: 48_717_900, status: "RECEIVED" }];
    expect(settlementShares({ ...settlement, completed: true }, entries)).toEqual({ b: 46_282_005, a: 46_282_100 });
  });

  it("예전 방식(수수료 정보 없음)은 정산금을 그대로 센다", () => {
    expect(settlementShares({ sellerUid: "a", completed: true }, [{ uid: "b", amount: 1000, status: "RECEIVED" }])).toEqual({ b: 1000 });
  });
});
