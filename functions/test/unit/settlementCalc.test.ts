import { describe, expect, it } from "vitest";
import { computeSettlement } from "../../src/settlement/calc";

const base = { sellerUid: "s", participants: ["s", "a"] };

describe("computeSettlement", () => {
  it("판매액 1억, 수수료 3%, 2명 균등: 정산금 49,238,500", () => {
    // 실수령 97,000,000 ÷ (0.97 + 1) = 49,238,578.68… → 100메소 단위 내림
    const result = computeSettlement({ ...base, saleAmount: 100_000_000, feePercent: 3 });
    expect(result).toMatchObject({
      netAmount: 97_000_000,
      amounts: { a: 49_238_500 },
      sellerAmount: 47_761_500,
      uniform: true,
    });
  });

  it("파티원이 수수료를 떼고 받는 금액이 판매자 몫과 (내림 오차 안에서) 같다", () => {
    for (const feePercent of [3, 5]) {
      for (const size of [2, 3, 4, 5, 6]) {
        const participants = ["s", ...Array.from({ length: size - 1 }, (_, i) => `m${i}`)];
        const result = computeSettlement({ sellerUid: "s", participants, saleAmount: 1_234_567_890, feePercent });
        const memberNet = (result.amounts.m0 * (100 - feePercent)) / 100;
        expect(Math.abs(result.sellerAmount - memberNet)).toBeLessThan(100 * size);
        expect(result.amounts.m0 % 100).toBe(0);
        // 판매자 몫 + 정산금 합계 = 실수령액
        const paid = Object.values(result.amounts).reduce((sum, amount) => sum + amount, 0);
        expect(result.sellerAmount + paid).toBe(result.netAmount);
      }
    }
  });

  it("수수료 5%면 실수령액이 95%다", () => {
    const result = computeSettlement({ ...base, saleAmount: 100_000_000, feePercent: 5 });
    expect(result.netAmount).toBe(95_000_000);
    // 95,000,000 ÷ 1.95 = 48,717,948.7…
    expect(result.amounts.a).toBe(48_717_900);
  });

  it("비율을 주면 수수료를 뗀 실수령이 그 비율대로 나뉜다", () => {
    const result = computeSettlement({
      sellerUid: "s",
      participants: ["s", "a", "b"],
      saleAmount: 300_000_000,
      feePercent: 3,
      weights: { s: 2, a: 1, b: 1 },
    });
    expect(result.uniform).toBe(true);
    expect(result.weights).toEqual({ s: 2, a: 1, b: 1 });
    const memberNet = result.amounts.a * 0.97;
    // 판매자 : 파티원 = 2 : 1
    expect(result.sellerAmount / memberNet).toBeCloseTo(2, 4);

    const uneven = computeSettlement({
      sellerUid: "s",
      participants: ["s", "a", "b"],
      saleAmount: 300_000_000,
      feePercent: 3,
      weights: { a: 3 },
    });
    expect(uneven.uniform).toBe(false);
    expect(uneven.amounts.a / uneven.amounts.b).toBeCloseTo(3, 4);
  });

  it("큰 금액에서도 정밀도를 잃지 않는다", () => {
    const result = computeSettlement({
      sellerUid: "s",
      participants: ["s", "a", "b", "c", "d", "e"],
      saleAmount: 999_999_999_999,
      feePercent: 5,
      weights: { s: 100, a: 100, b: 100, c: 100, d: 100, e: 100 },
    });
    // 949,999,999,999 ÷ 5.95 = 159,663,865,546.05…
    expect(result.netAmount).toBe(949_999_999_999);
    expect(result.amounts.a).toBe(159_663_865_500);
  });

  it("혼자 간 경우 받을 사람이 없고 판매자가 전부 갖는다", () => {
    const result = computeSettlement({ sellerUid: "s", participants: ["s"], saleAmount: 1000, feePercent: 5 });
    expect(result).toMatchObject({ amounts: {}, sellerAmount: 950, netAmount: 950 });
  });
});
