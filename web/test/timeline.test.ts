import { describe, expect, it } from "vitest";
import { routineKey } from "../src/lib/grid";
import type { Raid } from "../src/lib/model";
import { partyColors, raidTimeline, TIMELINE_BREAK, timelineSegments } from "../src/lib/timeline";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
// 2026-11-26(목) 00:00 KST
const WEEK = Date.parse("2026-11-26T00:00:00+09:00");
const at = (day: number, hour: number) => WEEK + day * DAY + hour * HOUR;
const raid = (partyId: string, day: number, hour: number, hours = 1): Raid => ({
  partyId,
  partyName: `${partyId}팟`,
  bosses: [{ name: "스우", difficulty: "HARD" }],
  startMs: at(day, hour),
  endMs: at(day, hour + hours),
});
const close = (value: number, expected: number) => expect(value).toBeCloseTo(expected, 6);

describe("시간표 타임라인", () => {
  it("레이드가 없으면 18~24시 한 구간이다", () => {
    const timeline = raidTimeline([], WEEK, new Set(), WEEK);
    expect(timeline.segments).toEqual([{ fromHour: 18, toHour: 24 }]);
    expect(timeline.bars).toEqual([]);
    expect(timeline.ticks.map((t) => t.label)).toEqual(["18", "19", "20", "21", "22", "23", "00"]);
  });

  it("레이드 앞뒤로 1시간을 두고, 막대는 시작한 날 줄의 시각 비율에 놓인다", () => {
    const timeline = raidTimeline([raid("a", 0, 20), raid("b", 2, 22)], WEEK, new Set(), WEEK);
    // 19~24는 5시간이라, 최소 폭 6시간을 맞추려 앞으로 1시간 늘린다
    expect(timeline.segments).toEqual([{ fromHour: 18, toHour: 24 }]);
    expect(timeline.bars.map((b) => b.row)).toEqual([0, 2]);
    close(timeline.bars[1].left, 4 / 6);
    close(timeline.bars[1].width, 1 / 6);
  });

  it("축은 최소 6시간이다 (24시까지 늘리고, 모자라면 앞으로)", () => {
    expect(timelineSegments([[21, 22]])).toEqual([{ fromHour: 18, toHour: 24 }]);
    expect(timelineSegments([[10, 11]])).toEqual([{ fromHour: 9, toHour: 15 }]);
    const timeline = raidTimeline([raid("a", 0, 20), raid("a", 1, 21)], WEEK, new Set(), WEEK);
    const [segment] = timeline.segments;
    expect(segment.toHour - segment.fromHour).toBe(6);
    close(timeline.bars[0].left, 2 / 6);
    close(timeline.bars[0].width, 1 / 6);
  });

  it("어느 요일에도 레이드가 없는 2시간 넘는 빈 시간은 빗금 한 칸으로 접는다", () => {
    const timeline = raidTimeline([raid("a", 2, 10), raid("b", 2, 20), raid("c", 0, 21)], WEEK, new Set(), WEEK);
    expect(timeline.segments).toEqual([
      { fromHour: 9, toHour: 12 },
      { fromHour: 19, toHour: 23 },
    ]);
    expect(timeline.breaks).toHaveLength(1);
    const unit = (1 - TIMELINE_BREAK) / 7;
    close(timeline.breaks[0].left, 3 * unit);
    // 20시 막대는 빗금을 건너뛴 자리
    const evening = timeline.bars.find((b) => b.raid.partyId === "b")!;
    close(evening.left, 3 * unit + TIMELINE_BREAK + unit);
    // 접은 곳 바로 앞 눈금(12)은 빼고, 뒤 구간 첫 눈금(19)부터
    expect(timeline.ticks.map((t) => t.label)).toEqual(["09", "10", "11", "19", "20", "21", "22", "23"]);
  });

  it("2시간 미만으로 떨어진 구간은 잇는다", () => {
    expect(timelineSegments([[18, 19], [21, 22]])).toEqual([{ fromHour: 17, toHour: 23 }]);
  });

  it("자정을 넘는 레이드는 시작한 날 줄에 그리고 축이 24시를 넘는다", () => {
    const timeline = raidTimeline([raid("a", 5, 23.5)], WEEK, new Set(), WEEK);
    expect(timeline.bars[0].row).toBe(5);
    expect(timeline.segments[timeline.segments.length - 1].toHour).toBe(25);
    expect(timeline.ticks.at(-1)?.label).toBe("01");
  });

  it("다음 주 시작을 주면 다음 주 레이드만 그리고, 같은 파티는 두 주에서 같은 색이다", () => {
    const raids = [raid("b", 0, 20), raid("a", 7, 20), raid("b", 8, 21)];
    const thisWeek = raidTimeline(raids, WEEK, new Set(), WEEK);
    const nextWeek = raidTimeline(raids, WEEK + 7 * DAY, new Set(), WEEK);
    expect(thisWeek.bars.map((b) => b.raid.partyId)).toEqual(["b"]);
    expect(nextWeek.bars.map((b) => b.row)).toEqual([0, 1]);
    const color = partyColors(raids).get("b");
    expect(thisWeek.bars[0].colorIndex).toBe(color);
    expect(nextWeek.bars.find((b) => b.raid.partyId === "b")?.colorIndex).toBe(color);
    expect(nextWeek.parties.map((p) => p.partyId)).toEqual(["a", "b"]);
    expect(nextWeek.now).toBeNull();
  });

  it("고정 불가 시간은 이어진 칸을 한 구간으로 합치고, 24시 이후는 다음 요일로 본다", () => {
    // 목(4) 18:00~20:00, 금(5) 00:00~00:30
    const routine = new Set([routineKey(4, 36), routineKey(4, 37), routineKey(4, 38), routineKey(4, 39), routineKey(5, 0)]);
    const timeline = raidTimeline([raid("a", 0, 23.5)], WEEK, routine, WEEK);
    // 23:30~00:30 레이드 → 축 19~25
    expect(timeline.segments).toEqual([{ fromHour: 19, toHour: 25 }]);
    const thursday = timeline.routine.filter((s) => s.row === 0);
    expect(thursday).toHaveLength(2);
    close(thursday[0].left, 0);
    close(thursday[0].width, 1 / 6); // 19~20
    close(thursday[1].left, 5 / 6); // 다음 날 00:00~00:30
    close(thursday[1].width, 0.5 / 6);
  });

  it("지금 시각은 오늘 줄의 축 위에 놓이고, 축 밖이면 없다", () => {
    const raids = [raid("a", 0, 20)];
    const now = raidTimeline(raids, WEEK, new Set(), at(1, 21));
    expect(now.now?.row).toBe(1);
    close(now.now!.left, 3 / 6);
    expect(raidTimeline(raids, WEEK, new Set(), at(1, 9)).now).toBeNull();
    expect(raidTimeline(raids, WEEK, new Set(), at(0, 21)).bars[0].past).toBe(true);
  });
});
