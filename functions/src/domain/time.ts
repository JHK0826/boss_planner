/**
 * 주기·시간 칸 계산. 모든 기준은 KST(UTC+9, 서머타임 없음)이다.
 *
 * - 시간 칸(slot)은 30분 단위이고 ID는 KST 기준 "YYYYMMDD-HHmm"이다.
 * - 주간 주기는 목요일 00:00 ~ 다음 목요일 00:00, 월간 주기는 1일 00:00 ~ 다음 달 1일 00:00이다.
 */

export type Cycle = "WEEKLY" | "MONTHLY";

export const SLOT_MS = 30 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const THURSDAY = 4;

export interface Period {
  id: string;
  cycle: Cycle;
  /** 주기 시작 (포함), epoch ms */
  startMs: number;
  /** 주기 끝 (제외), epoch ms */
  endMs: number;
  /** 불가 시간 입력 마감 (제외). 주기 시작일 23:59까지 = 시작 + 24시간 */
  inputDeadlineMs: number;
  totalSlots: number;
}

const pad = (n: number, width = 2) => String(n).padStart(width, "0");

/** KST 벽시계 값을 UTC 필드로 읽을 수 있게 옮긴 Date */
function kstDate(ms: number): Date {
  return new Date(ms + KST_OFFSET_MS);
}

function fromKst(year: number, monthIndex: number, day: number, hour = 0, minute = 0): number {
  return Date.UTC(year, monthIndex, day, hour, minute) - KST_OFFSET_MS;
}

function ymd(ms: number): string {
  const d = kstDate(ms);
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}`;
}

export function currentPeriod(cycle: Cycle, nowMs: number): Period {
  const d = kstDate(nowMs);
  let startMs: number;
  let endMs: number;
  let id: string;
  if (cycle === "WEEKLY") {
    const daysSinceThursday = (d.getUTCDay() - THURSDAY + 7) % 7;
    startMs = fromKst(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - daysSinceThursday);
    endMs = startMs + 7 * DAY_MS;
    id = `W-${ymd(startMs)}`;
  } else {
    startMs = fromKst(d.getUTCFullYear(), d.getUTCMonth(), 1);
    endMs = fromKst(d.getUTCFullYear(), d.getUTCMonth() + 1, 1);
    id = `M-${ymd(startMs).slice(0, 6)}`;
  }
  return {
    id,
    cycle,
    startMs,
    endMs,
    inputDeadlineMs: startMs + DAY_MS,
    totalSlots: (endMs - startMs) / SLOT_MS,
  };
}

/** 주기 시작일(주간: 목요일, 월간: 1일)인가. 파티 구성 변경이 허용되는 날이다. */
export function isCycleStartDay(cycle: Cycle, nowMs: number): boolean {
  const period = currentPeriod(cycle, nowMs);
  return nowMs < period.startMs + DAY_MS;
}

export function slotIdFromMs(ms: number): string {
  const d = kstDate(ms);
  return `${ymd(ms)}-${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}`;
}

/** 형식이 틀리거나 30분 단위가 아니면 null */
export function slotIdToMs(slotId: string): number | null {
  const match = /^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})$/.exec(slotId);
  if (!match) return null;
  const [year, month, day, hour, minute] = match.slice(1).map(Number);
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || (minute !== 0 && minute !== 30)) return null;
  const ms = fromKst(year, month - 1, day, hour, minute);
  // 11월 31일처럼 넘어가는 날짜는 거른다.
  return slotIdFromMs(ms) === slotId ? ms : null;
}

/** 주기 안에서의 칸 번호. 주기 밖이면 null */
export function slotIndex(period: Pick<Period, "startMs" | "totalSlots">, slotId: string): number | null {
  const ms = slotIdToMs(slotId);
  if (ms === null) return null;
  const index = (ms - period.startMs) / SLOT_MS;
  return index >= 0 && index < period.totalSlots ? index : null;
}

export function slotMs(period: Pick<Period, "startMs">, index: number): number {
  return period.startMs + index * SLOT_MS;
}

/** KST 기준 요일: 1(월) ~ 7(일) */
export function kstWeekday(ms: number): number {
  return ((kstDate(ms).getUTCDay() + 6) % 7) + 1;
}

/** ms가 속한 KST 날짜의 00:00 */
export function startOfKstDay(ms: number): number {
  const d = kstDate(ms);
  return fromKst(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

/** KST 날짜 "YYYY-MM-DD" (NEXON API의 date 파라미터 형식) */
export function kstDateString(ms: number): string {
  const d = kstDate(ms);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/** [startMs, endMs) 구간에 걸친 시간 칸 ID */
export function slotIdsBetween(startMs: number, endMs: number): string[] {
  const ids: string[] = [];
  for (let ms = startMs; ms < endMs; ms += SLOT_MS) ids.push(slotIdFromMs(ms));
  return ids;
}
