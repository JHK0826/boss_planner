import { describe, expect, it } from "vitest";
import { periodColumns, routineKey, weekdayColumns } from "../src/lib/grid";
import { durationLabel, korean, meso } from "../src/lib/money";
import { dateTime, range, rowLabel, weekStart } from "../src/lib/time";

const kst = (iso: string) => Date.parse(`${iso}+09:00`);

describe("시간 표시", () => {
  it("KST 기준으로 쓴다", () => {
    expect(dateTime(kst("2026-11-14T20:00:00"))).toBe("11/14(토) 20:00");
    expect(range(kst("2026-11-14T20:00:00"), kst("2026-11-14T20:40:00"))).toBe("11/14(토) 20:00 ~ 20:40");
    expect(rowLabel(43)).toBe("21:30");
    expect(rowLabel(48)).toBe("24:00");
  });

  it("주간 주기 시작은 가장 최근 목요일 00:00", () => {
    expect(weekStart(kst("2026-11-18T23:59:00"))).toBe(kst("2026-11-12T00:00:00"));
    expect(weekStart(kst("2026-11-19T00:00:00"))).toBe(kst("2026-11-19T00:00:00"));
  });
});

describe("시간표 열", () => {
  it("주간 7일, 열마다 48칸 (Android periodColumns와 같음)", () => {
    const columns = periodColumns(kst("2026-11-12T00:00:00"), kst("2026-11-19T00:00:00"));
    expect(columns.map((c) => c.weekday)).toEqual([4, 5, 6, 7, 1, 2, 3]);
    expect(columns[0]).toMatchObject({ title: "목", subtitle: "11/12" });
    expect(columns[0].slotIds[0]).toBe("20261112-0000");
    expect(columns[6].slotIds[47]).toBe("20261118-2330");
    expect(periodColumns(kst("2027-02-01T00:00:00"), kst("2027-03-01T00:00:00"))).toHaveLength(28);
  });

  it("고정 불가 시간 칸 ID", () => {
    expect(routineKey(1, 0)).toBe("D1-0000");
    expect(routineKey(7, 43)).toBe("D7-2130");
    expect(weekdayColumns()[6].slotIds[47]).toBe("D7-2330");
  });
});

describe("금액·시간 표시", () => {
  it("메소와 억·만 단위", () => {
    expect(meso(49_238_500)).toBe("49,238,500메소");
    expect(korean(49_238_500)).toBe("4923만 8500");
    expect(korean(1_234_567_890)).toBe("12억 3456만 7890");
    expect(korean(100_000_000)).toBe("1억");
  });

  it("소요 시간", () => {
    expect(durationLabel(40)).toBe("40분");
    expect(durationLabel(60)).toBe("1시간");
    expect(durationLabel(90)).toBe("1시간 30분");
  });
});
