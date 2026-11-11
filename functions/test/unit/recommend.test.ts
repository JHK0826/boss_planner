import { describe, expect, it } from "vitest";
import { recommendStarts, unanimousCandidates } from "../../src/domain/recommend";

const range = (from: number, to: number) => Array.from({ length: to - from }, (_, i) => from + i);
/** 주어진 구간만 비어 있게 만드는 blocked 목록 */
const onlyFree = (total: number, ...free: [number, number][]) =>
  range(0, total).filter((i) => !free.some(([from, to]) => i >= from && i < to));

describe("recommendStarts", () => {
  it("전원이 비는 구간 중 소요 시간 이상인 구간의 시작을 빠른 순으로 준다", () => {
    const a = onlyFree(48, [4, 8], [20, 30], [40, 44]);
    const b = onlyFree(48, [5, 8], [20, 26], [40, 48]);
    // 공통: [5,8) 길이 3, [20,26) 길이 6, [40,44) 길이 4 → 소요 4칸
    expect(recommendStarts({ totalSlots: 48, durationSlots: 4, blocked: [a, b], earliestSlot: 0 })).toEqual([20, 40]);
  });

  it("각 구간의 첫 블록을 먼저, 그다음 두 번째 블록을 추천한다", () => {
    const blocked = onlyFree(48, [0, 6], [10, 12], [20, 26]);
    const result = recommendStarts({ totalSlots: 48, durationSlots: 2, blocked: [blocked], earliestSlot: 0, limit: 10 });
    expect(result).toEqual([0, 10, 20, 2, 22, 4, 24]);
  });

  it("지난 시간은 추천하지 않는다", () => {
    expect(recommendStarts({ totalSlots: 48, durationSlots: 2, blocked: [[]], earliestSlot: 45 })).toEqual([45]);
    expect(recommendStarts({ totalSlots: 48, durationSlots: 2, blocked: [[]], earliestSlot: 47 })).toEqual([]);
  });

  it("이미 추천한 후보는 다음 라운드에서 빠진다", () => {
    const input = { totalSlots: 12, durationSlots: 2, blocked: [[]], earliestSlot: 0 };
    const first = recommendStarts(input);
    expect(first).toEqual([0, 2, 4]);
    const second = recommendStarts({ ...input, alreadyOffered: first });
    expect(second).toEqual([6, 8, 10]);
    expect(recommendStarts({ ...input, alreadyOffered: [...first, ...second] })).toEqual([]);
  });

  it("겹치는 시간이 없으면 빈 목록이다", () => {
    const a = range(0, 24);
    const b = range(24, 48);
    expect(recommendStarts({ totalSlots: 48, durationSlots: 1, blocked: [a, b], earliestSlot: 0 })).toEqual([]);
  });

  it("범위를 벗어난 칸 번호는 무시한다", () => {
    expect(recommendStarts({ totalSlots: 4, durationSlots: 4, blocked: [[-1, 4, 1.5, NaN]], earliestSlot: 0 })).toEqual([0]);
  });
});

describe("unanimousCandidates", () => {
  it("전원이 동의한 후보만 고른다", () => {
    expect(unanimousCandidates(3, [[0, 2], [2], [1, 2]])).toEqual([2]);
    expect(unanimousCandidates(3, [[0], [1]])).toEqual([]);
  });

  it("투표하지 않은 사람이 있으면 아직 결정하지 않는다", () => {
    expect(unanimousCandidates(3, [[0], undefined])).toBeNull();
    expect(unanimousCandidates(3, [])).toBeNull();
  });
});
