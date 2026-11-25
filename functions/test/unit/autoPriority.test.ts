import { describe, expect, it } from "vitest";
import { compareAutoPriority, partyCrystalValue } from "../../src/domain/autoPriority";

const party = (partyId: string, completedAtMs: number, crystalValue: number) => ({ partyId, completedAtMs, crystalValue });

describe("자동 지정 파티끼리의 확정 순서", () => {
  it("제출 완료 시각이 1분 이상 차이 나면 결정석 값과 상관없이 먼저 끝낸 파티가 먼저다", () => {
    const early = party("b", 0, 1);
    const late = party("a", 61_000, 9_999);
    expect(compareAutoPriority(early, late)).toBeLessThan(0);
    expect(compareAutoPriority(late, early)).toBeGreaterThan(0);
    // 딱 1분 차이도 먼저 끝낸 쪽
    expect(compareAutoPriority(party("b", 0, 1), party("a", 60_000, 9_999))).toBeLessThan(0);
  });

  it("1분 안이면 동시로 보고 결정석 값이 큰 파티가 먼저, 같으면 파티 ID 순이다", () => {
    expect(compareAutoPriority(party("a", 30_000, 100), party("b", 0, 10))).toBeLessThan(0);
    expect(compareAutoPriority(party("b", 0, 10), party("a", 30_000, 100))).toBeGreaterThan(0);
    expect(compareAutoPriority(party("a", 0, 10), party("b", 59_999, 10))).toBeLessThan(0);
    expect(compareAutoPriority(party("a", 0, 10), party("a", 0, 10))).toBe(0);
  });

  it("결정석 값은 묶은 보스 가격의 합이고, 가격표에 없는 보스는 0이다", () => {
    const prices = { "스우|HARD": 100, "데미안|HARD": 50 };
    expect(partyCrystalValue([{ name: "스우", difficulty: "HARD" }, { name: "데미안", difficulty: "HARD" }], prices)).toBe(150);
    expect(partyCrystalValue([{ name: "없는 보스", difficulty: "HARD" }], prices)).toBe(0);
  });
});
