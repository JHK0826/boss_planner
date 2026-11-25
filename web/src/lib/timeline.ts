// 시간표 탭의 가로 타임라인 배치 (Android data/Timeline.kt와 같은 규칙).
// 요일(목~수)이 줄, 가로축이 시각이다. 레이드가 없는 시간은 접어 한 화면에 들어오게 한다.
import { routineKey } from "./grid";
import type { Raid } from "./model";
import { DAY_MS, SLOT_MS, startOfDay, weekday } from "./time";

const HOUR_MS = 2 * SLOT_MS;
/** 접은 빈 시간(빗금 한 칸)이 차지하는 폭 */
export const TIMELINE_BREAK = 0.05;
/** 이만큼 넘게 비면 접는다(시간) */
const FOLD_HOURS = 2;
/** 축의 최소 시간 합 */
const MIN_HOURS = 6;
/** 파티 색 개수 */
export const PARTY_COLORS = 6;

/** 축의 한 구간 [fromHour, toHour). 날 시작부터의 시(24 넘으면 다음 날 새벽) */
export interface TimelineSegment {
  fromHour: number;
  toHour: number;
}

export interface TimelineBar {
  raid: Raid;
  /** 0(목) ~ 6(수) */
  row: number;
  /** 축 대비 위치·폭 (0~1) */
  left: number;
  width: number;
  colorIndex: number;
  past: boolean;
}

/** 줄 위의 가로 구간 (고정 불가 시간, 접은 빈 시간) */
export interface TimelineSpan {
  row: number;
  left: number;
  width: number;
}

export interface RaidTimeline {
  /** 줄마다 그날 00:00 */
  dayStarts: number[];
  segments: TimelineSegment[];
  /** 접은 빈 시간 (모든 줄에 같은 자리) */
  breaks: { left: number; width: number }[];
  ticks: { left: number; label: string }[];
  /** 구간 안의 정각 세로선 */
  gridLines: number[];
  bars: TimelineBar[];
  routine: TimelineSpan[];
  /** 지금 시각. 이 주가 아니거나 축 밖이면 null */
  now: { row: number; left: number } | null;
  /** 이 주에 나온 파티 (색 순서) */
  parties: { partyId: string; partyName: string; colorIndex: number }[];
  /** 시 → 가로 위치(0~1) */
  x: (hour: number) => number;
}

/** 파티 ID → 색 번호. 받은 레이드 전체로 정해, 이번 주와 다음 주에서 같은 파티는 같은 색이다. */
export function partyColors(raids: Raid[]): Map<string, number> {
  const ids = [...new Set(raids.map((raid) => raid.partyId))].sort();
  return new Map(ids.map((id, index) => [id, index % PARTY_COLORS]));
}

/** 레이드가 있는 시각(앞뒤 1시간 여유)을 합친 축 구간. 2시간 넘게 빈 곳은 나눈다. */
export function timelineSegments(hours: [number, number][]): TimelineSegment[] {
  if (hours.length === 0) return [{ fromHour: 18, toHour: 24 }];
  const spans = hours
    .map(([start, end]) => ({
      fromHour: Math.max(0, Math.floor(start) - 1),
      // 자정 전에 끝나면 24에서 자르고, 자정을 넘으면 그 끝까지 둔다.
      toHour: Math.min(Math.ceil(end) + 1, Math.max(24, Math.ceil(end))),
    }))
    .sort((a, b) => a.fromHour - b.fromHour);
  const segments: TimelineSegment[] = [];
  for (const span of spans) {
    const last = segments[segments.length - 1];
    if (last && span.fromHour - last.toHour < FOLD_HOURS) last.toHour = Math.max(last.toHour, span.toHour);
    else segments.push({ ...span });
  }
  // 너무 좁으면 마지막 구간을 뒤로(24까지), 그래도 모자라면 첫 구간을 앞으로 늘린다.
  let missing = MIN_HOURS - segments.reduce((sum, s) => sum + s.toHour - s.fromHour, 0);
  if (missing > 0) {
    const last = segments[segments.length - 1];
    const grow = Math.min(missing, Math.max(0, Math.max(24, last.toHour) - last.toHour));
    last.toHour += grow;
    missing -= grow;
  }
  if (missing > 0) {
    const first = segments[0];
    const grow = Math.min(missing, first.fromHour);
    first.fromHour -= grow;
    missing -= grow;
  }
  if (missing > 0) segments[segments.length - 1].toHour += missing;
  return segments;
}

/** 구간 목록으로 시 → 가로 위치(0~1). 접은 곳 안의 시각은 앞 구간 끝으로 붙인다. */
export function timelineX(segments: TimelineSegment[]): (hour: number) => number {
  const total = segments.reduce((sum, s) => sum + s.toHour - s.fromHour, 0);
  const unit = (1 - TIMELINE_BREAK * (segments.length - 1)) / total;
  return (hour) => {
    let offset = 0;
    for (let i = 0; i < segments.length; i++) {
      const { fromHour, toHour } = segments[i];
      if (hour <= toHour || i === segments.length - 1) return offset + (Math.min(Math.max(hour, fromHour), toHour) - fromHour) * unit;
      offset += (toHour - fromHour) * unit + TIMELINE_BREAK;
    }
    return offset;
  };
}

const pad = (n: number) => String(n).padStart(2, "0");
const hoursOf = (raid: Raid, dayStart: number): [number, number] => {
  const start = (raid.startMs - dayStart) / HOUR_MS;
  return [start, start + (raid.endMs - raid.startMs) / HOUR_MS];
};

/**
 * @param raids 받아 온 확정 일정 전체 (색을 정하는 데 쓴다)
 * @param weekStartMs 보고 있는 주의 목요일 00:00
 * @param routine 고정 불가 시간 키 (`routineKey`)
 */
export function raidTimeline(raids: Raid[], weekStartMs: number, routine: Set<string>, nowMs: number): RaidTimeline {
  const dayStarts = Array.from({ length: 7 }, (_, i) => weekStartMs + i * DAY_MS);
  const colors = partyColors(raids);
  // 시작한 날 줄에 그린다. 자정을 넘는 레이드는 그날 줄에서 24시를 넘긴다.
  const inWeek = raids
    .filter((raid) => raid.startMs >= weekStartMs && raid.startMs < weekStartMs + 7 * DAY_MS)
    .map((raid) => {
      const row = Math.floor((raid.startMs - weekStartMs) / DAY_MS);
      return { raid, row, hours: hoursOf(raid, dayStarts[row]) };
    });

  const segments = timelineSegments(inWeek.map((r) => r.hours));
  const x = timelineX(segments);
  const total = segments.reduce((sum, s) => sum + s.toHour - s.fromHour, 0);
  const step = total <= 8 ? 1 : 2;

  const ticks: RaidTimeline["ticks"] = [];
  const gridLines: number[] = [];
  segments.forEach((segment, i) => {
    // 접은 곳 바로 앞 눈금은 뒤 구간 첫 눈금과 겹치므로 뺀다.
    const lastTick = i < segments.length - 1 ? segment.toHour - 1 : segment.toHour;
    for (let h = segment.fromHour; h <= lastTick; h += step) ticks.push({ left: x(h), label: pad(h % 24) });
    for (let h = segment.fromHour + 1; h < segment.toHour; h++) gridLines.push(x(h));
  });
  const breaks = segments.slice(0, -1).map((segment) => ({ left: x(segment.toHour), width: TIMELINE_BREAK }));

  const bars: TimelineBar[] = inWeek.map(({ raid, row, hours: [start, end] }) => ({
    raid,
    row,
    left: x(start),
    width: x(end) - x(start),
    colorIndex: colors.get(raid.partyId) ?? 0,
    past: raid.endMs <= nowMs,
  }));

  // 고정 불가 시간: 축 위 30분 칸마다 실제 시각의 요일·행으로 본다 (24시 이후는 다음 요일).
  const routineSpans: TimelineSpan[] = [];
  dayStarts.forEach((dayStart, row) => {
    for (const { fromHour, toHour } of segments) {
      let from: number | null = null;
      for (let h = fromHour; h <= toHour; h += 0.5) {
        const at = dayStart + h * HOUR_MS;
        const on = h < toHour && routine.has(routineKey(weekday(at), Math.floor((at - startOfDay(at)) / SLOT_MS)));
        if (on && from === null) from = h;
        if (!on && from !== null) {
          routineSpans.push({ row, left: x(from), width: x(h) - x(from) });
          from = null;
        }
      }
    }
  });

  let now: RaidTimeline["now"] = null;
  if (nowMs >= weekStartMs && nowMs < weekStartMs + 7 * DAY_MS) {
    const row = Math.floor((nowMs - weekStartMs) / DAY_MS);
    const hour = (nowMs - dayStarts[row]) / HOUR_MS;
    if (segments.some((s) => hour >= s.fromHour && hour <= s.toHour)) now = { row, left: x(hour) };
  }

  const seen = new Map<string, RaidTimeline["parties"][number]>();
  for (const { raid } of inWeek) {
    if (!seen.has(raid.partyId)) seen.set(raid.partyId, { partyId: raid.partyId, partyName: raid.partyName, colorIndex: colors.get(raid.partyId) ?? 0 });
  }
  // 색을 정한 순서(파티 ID 순)
  const parties = [...seen.values()].sort((a, b) => (a.partyId < b.partyId ? -1 : a.partyId > b.partyId ? 1 : 0));

  return { dayStarts, segments, breaks, ticks, gridLines, bars, routine: routineSpans, now, parties, x };
}
