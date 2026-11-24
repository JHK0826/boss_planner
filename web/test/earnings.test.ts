import { describe, expect, it } from "vitest";
import { earnedThisWeek, expectedThisWeek, monthlyEarnings } from "../src/lib/earnings";
import type { EarningsRecord, SchedulerBoss } from "../src/lib/model";

const kst = (iso: string) => Date.parse(`${iso}+09:00`);
const boss = (name: string, cycle: "WEEKLY" | "MONTHLY", cleared: boolean, share: number, partySize = 1): SchedulerBoss => ({
  name,
  difficulty: "HARD",
  cycle,
  cleared,
  partySize,
  price: share * partySize,
  share,
});

const bosses = [
  boss("림보", "WEEKLY", true, 300, 3),
  boss("스우", "WEEKLY", false, 100),
  boss("검은 마법사", "MONTHLY", false, 1000),
];

const record = (id: string, crystal: number, settlements: EarningsRecord["settlements"] = {}): EarningsRecord => ({
  id,
  characters: { c1: { crystalValue: crystal, crystalCount: 1 } },
  settlements,
});

describe("수익 보기", () => {
  it("예상 수익은 주간 보스 전부와 아직 안 잡은 월간 보스", () => {
    expect(expectedThisWeek(bosses)).toBe(1400);
    expect(expectedThisWeek([...bosses.slice(0, 2), boss("검은 마법사", "MONTHLY", true, 1000)])).toBe(400);
  });

  it("이번 주에 번 돈은 클리어한 주간 결정석과 이번 주 정산금 (그 캐릭터 것만)", () => {
    const records = [
      record("W-20261119", 300, {
        p1_W: { characterId: "c1", partyName: "스우팟", amount: 50, raidAtMs: kst("2026-11-21T21:00:00") },
        p2_W: { characterId: "c2", partyName: "다른캐릭", amount: 999, raidAtMs: 0 },
      }),
    ];
    const week = earnedThisWeek(bosses, records, "c1", kst("2026-11-24T12:00:00"));
    expect(week).toMatchObject({ crystal: 300, settlement: 50, total: 350 });
    expect(week.settlements.map((s) => s.partyName)).toEqual(["스우팟"]);
  });

  it("월별: 주간 기록은 시작일(목요일)의 달로 묶고 월간 결정석을 더한다", () => {
    const records = [
      record("W-20261126", 300), // 11월 26일 시작 → 11월
      record("W-20261119", 200, { k: { characterId: "c1", partyName: "", amount: 50, raidAtMs: 0 } }),
      record("M-202611", 1000),
      record("W-20261029", 70), // 10월
    ];
    const months = monthlyEarnings(records, "c1", kst("2026-12-02T12:00:00"), 3);
    expect(months.map((m) => [m.monthId, m.crystal, m.settlement, m.total, m.recorded])).toEqual([
      ["M-202612", 0, 0, 0, false],
      ["M-202611", 1500, 50, 1550, true],
      ["M-202610", 70, 0, 70, true],
    ]);
    expect(months[1].label).toBe("2026년 11월");
  });

  it("해가 바뀌어도 달을 거꾸로 센다", () => {
    expect(monthlyEarnings([], "c1", kst("2027-01-05T00:00:00"), 2).map((m) => m.monthId)).toEqual(["M-202701", "M-202612"]);
  });
});
