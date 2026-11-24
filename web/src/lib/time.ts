// 시간 표시. 모든 기준은 KST(UTC+9, 서머타임 없음)다. 칸 ID와 주기 계산은 서버 코드를 그대로 쓴다.
import { SLOT_MS, kstWeekday, slotIdFromMs, startOfKstDay } from "@shared/domain/time";

export { SLOT_MS, slotIdFromMs as slotId, startOfKstDay as startOfDay };

export const SLOTS_PER_DAY = 48;
export const DAY_MS = SLOTS_PER_DAY * SLOT_MS;
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];
const pad = (n: number) => String(n).padStart(2, "0");
const kst = (ms: number) => new Date(ms + KST_OFFSET_MS);

/** 요일 번호: 1(월) ~ 7(일) */
export const weekday = (ms: number): number => kstWeekday(ms);
/** "목" */
export const weekdayLabel = (ms: number): string => WEEKDAYS[kst(ms).getUTCDay()];
/** "11/14" */
export const dayLabel = (ms: number): string => `${kst(ms).getUTCMonth() + 1}/${kst(ms).getUTCDate()}`;
/** "20:30" */
export const time = (ms: number): string => `${pad(kst(ms).getUTCHours())}:${pad(kst(ms).getUTCMinutes())}`;
/** "11/14(토) 20:00" */
export const dateTime = (ms: number): string => `${dayLabel(ms)}(${weekdayLabel(ms)}) ${time(ms)}`;
/** "11/14(토) 20:00 ~ 21:00" */
export const range = (startMs: number, endMs: number): string => `${dateTime(startMs)} ~ ${time(endMs)}`;
/** "11/14 (토)" */
export const dayWithWeekday = (ms: number): string => `${dayLabel(ms)} (${weekdayLabel(ms)})`;
/** 하루 안에서 n번째 칸의 시작 시각 "HH:mm" (48이면 "24:00") */
export const rowLabel = (row: number): string => `${pad(Math.floor(row / 2))}:${pad((row % 2) * 30)}`;

/** ms가 속한 주간 주기의 시작: 가장 최근 목요일 00:00 (KST) */
export function weekStart(ms: number): number {
  const today = startOfKstDay(ms);
  const daysSinceThursday = (weekday(ms) - 4 + 7) % 7;
  return today - daysSinceThursday * DAY_MS;
}
