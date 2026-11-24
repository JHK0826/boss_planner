// 30분 단위 시간표의 열 (Android ui/SlotGrid.kt와 같은 규칙).
import { DAY_MS, SLOTS_PER_DAY, SLOT_MS, dayLabel, slotId, weekday, weekdayLabel } from "./time";

/** 시간표의 한 열(하루). slotIds는 00:00부터 30분 칸 48개의 ID다. */
export interface GridColumn {
  title: string;
  subtitle: string;
  /** 요일: 1(월) ~ 7(일) */
  weekday: number;
  slotIds: string[];
}

export const WEEKDAY_NAMES = ["월", "화", "수", "목", "금", "토", "일"];

/** 범위 채우기·선호 시간대에서 고르는 요일 묶음 */
export const DAY_CHOICES: [string, number[]][] = [
  ["매일", [1, 2, 3, 4, 5, 6, 7]],
  ["평일", [1, 2, 3, 4, 5]],
  ["주말", [6, 7]],
  ...WEEKDAY_NAMES.map((name, i): [string, number[]] => [`${name}요일`, [i + 1]]),
];

/** 주기의 날짜별 열 (주간 7일, 월간 28~31일) */
export function periodColumns(startMs: number, endMs: number): GridColumn[] {
  const dayCount = Math.floor((endMs - startMs) / DAY_MS);
  return Array.from({ length: dayCount }, (_, day) => {
    const dayStart = startMs + day * DAY_MS;
    return {
      title: weekdayLabel(dayStart),
      subtitle: dayLabel(dayStart),
      weekday: weekday(dayStart),
      slotIds: Array.from({ length: SLOTS_PER_DAY }, (_, row) => slotId(dayStart + row * SLOT_MS)),
    };
  });
}

/** 고정 불가 시간 칸 ID: "D{요일}-{HHmm}" (요일 1=월 ~ 7=일) */
export const routineKey = (weekdayNumber: number, row: number): string =>
  `D${weekdayNumber}-${String(Math.floor(row / 2)).padStart(2, "0")}${row % 2 ? "30" : "00"}`;

/** 요일 7개(월~일)짜리 열. 고정 불가 시간 편집에 쓴다. */
export const weekdayColumns = (): GridColumn[] =>
  WEEKDAY_NAMES.map((name, i) => ({
    title: name,
    subtitle: "",
    weekday: i + 1,
    slotIds: Array.from({ length: SLOTS_PER_DAY }, (_, row) => routineKey(i + 1, row)),
  }));
