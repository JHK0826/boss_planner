import { describe, expect, it } from "vitest";
import { currentPeriod, isCycleStartDay, slotIdFromMs, slotIdToMs, slotIndex } from "../../src/domain/time";

const kst = (iso: string) => Date.parse(`${iso}+09:00`);

describe("currentPeriod", () => {
  it("주간 주기는 목요일 00:00 KST에 시작해 7일이다", () => {
    // 2026-11-11은 수요일, 2026-11-12는 목요일
    const wednesday = currentPeriod("WEEKLY", kst("2026-11-11T23:59:59"));
    expect(wednesday.id).toBe("W-20261105");
    expect(wednesday.endMs).toBe(kst("2026-11-12T00:00:00"));

    const thursday = currentPeriod("WEEKLY", kst("2026-11-12T00:00:00"));
    expect(thursday.id).toBe("W-20261112");
    expect(thursday.startMs).toBe(kst("2026-11-12T00:00:00"));
    expect(thursday.totalSlots).toBe(336);
    expect(thursday.inputDeadlineMs).toBe(kst("2026-11-13T00:00:00"));
  });

  it("UTC 날짜가 아니라 KST 날짜로 판단한다", () => {
    // UTC로는 아직 수요일 15:30이지만 KST로는 목요일 00:30
    expect(currentPeriod("WEEKLY", Date.parse("2026-11-11T15:30:00Z")).id).toBe("W-20261112");
  });

  it("월간 주기는 1일부터 말일까지다", () => {
    const feb = currentPeriod("MONTHLY", kst("2027-02-15T12:00:00"));
    expect(feb.id).toBe("M-202702");
    expect(feb.totalSlots).toBe(28 * 48);
    const dec = currentPeriod("MONTHLY", kst("2026-12-31T23:59:00"));
    expect(dec.endMs).toBe(kst("2027-01-01T00:00:00"));
  });
});

describe("isCycleStartDay", () => {
  it("주간은 목요일 하루, 월간은 1일 하루만 참이다", () => {
    expect(isCycleStartDay("WEEKLY", kst("2026-11-12T23:59:59"))).toBe(true);
    expect(isCycleStartDay("WEEKLY", kst("2026-11-13T00:00:00"))).toBe(false);
    expect(isCycleStartDay("MONTHLY", kst("2026-12-01T10:00:00"))).toBe(true);
    expect(isCycleStartDay("MONTHLY", kst("2026-12-03T10:00:00"))).toBe(false);
  });
});

describe("slot", () => {
  it("slotId와 시각을 서로 바꾼다", () => {
    const ms = kst("2026-11-12T20:30:00");
    expect(slotIdFromMs(ms)).toBe("20261112-2030");
    expect(slotIdToMs("20261112-2030")).toBe(ms);
  });

  it("형식이 틀리거나 없는 날짜는 거른다", () => {
    for (const bad of ["20261112-2015", "20261131-2000", "2026-11-12", "20261112-2430", ""]) {
      expect(slotIdToMs(bad)).toBeNull();
    }
  });

  it("주기 밖의 칸은 번호가 없다", () => {
    const period = currentPeriod("WEEKLY", kst("2026-11-12T10:00:00"));
    expect(slotIndex(period, "20261112-0000")).toBe(0);
    expect(slotIndex(period, "20261118-2330")).toBe(335);
    expect(slotIndex(period, "20261119-0000")).toBeNull();
    expect(slotIndex(period, "20261111-2330")).toBeNull();
  });
});
