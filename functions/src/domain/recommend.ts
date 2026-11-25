/**
 * 추천 시간 계산 (순수 함수).
 *
 * 1. 가능한 시작 시각을 모두 찾는다. 전원이 소요 시간 내내 비어 있어야 한다.
 *    불가 시간과 다른 파티의 확정 시간(busy)은 호출하는 쪽에서 합쳐 blocked로 넘긴다. 둘은 같은 판정이다.
 *    이미 지난 시간과 최소 여유 시간 안쪽은 쓰지 않는다(earliestSlot).
 * 2. 시작 시각마다 점수를 매긴다. 높을수록 먼저 추천한다.
 *      + 파티 선호 시간대 안에 온전히 들어감
 *      + 파티원의 다른 레이드 바로 앞이나 뒤 (한 번 접속에 몰아서 돌 수 있음). 파티원마다 가장 높은 하나만 준다.
 *          확정 레이드: 같은 캐릭터 20 > 다른 캐릭터 15
 *          투표 중인 다른 파티 후보: 같은 캐릭터 12 > 다른 캐릭터 8
 *        같은 캐릭터면 캐릭터를 바꾸지 않고 이어 돌 수 있다. 다른 파티 후보는 보통 요일마다 하나씩이라,
 *        어느 후보로 확정되든 이어서 돌 시각이 남는다. 다른 사람의 레이드는 상관없다.
 *      + 이 파티가 평소 레이드하던 요일·시각 (최근 레이드마다, ±30분)
 *      − 생활 시간대 밖: 새벽(02~08시)은 크게, 평일 낮(08~18시)·주말 아침(08~10시)은 조금,
 *        자정 넘어서(00~02시)는 아주 조금. 선호 시간대 안이면 보정하지 않는다.
 *        불가 시간표는 불가/가능 두 가지라, 자는 시간을 표시하지 않아도 새벽이 뽑히지 않게 한다.
 *      − 파티원이 겹치는 다른 파티가 투표 중인 후보와 겹침 (나중에 한쪽이 거절당해 다시 투표하게 됨)
 *      + 정각에 시작
 *      + 주기 앞쪽 날짜 (미클리어 때 다시 잡을 여유가 남음)
 * 3. 고르는 방식
 *      spread (투표): 요일마다 가장 좋은 시각을 하나씩 고르고, 자리가 남으면 요일마다 두 번째, 세 번째를 채운다.
 *                     같은 날의 후보끼리는 시간이 겹치지 않는다. 결과는 시간순.
 *      ranked (자동 지정): 요일과 상관없이 점수순으로, 서로 겹치지 않게 고른다. 결과는 순위순.
 */

export const SLOTS_PER_DAY = 48;
export const MAX_CANDIDATES = 6;
/** 자동 지정에서 보여 줄 순위 후보 수 (1위로 확정하고, 파티장은 나머지로 바꿀 수 있다) */
export const RANKED_CANDIDATES = 3;

const SCORE_PREFERRED = 100;
const SCORE_ADJACENT_SAME_CHARACTER = 20;
const SCORE_ADJACENT_PER_MEMBER = 15;
const SCORE_PENDING_ADJACENT_SAME_CHARACTER = 12;
const SCORE_PENDING_ADJACENT_PER_MEMBER = 8;
const SCORE_ADJACENT_MAX = 60;
const SCORE_USUAL_PER_RAID = 10;
const SCORE_USUAL_MAX = 30;
const SCORE_PENDING_OVERLAP = -60;
const SCORE_ON_THE_HOUR = 5;
const SCORE_PER_DAY = -1;

/** 생활 시간대 보정 (comfortSlots가 칸마다 넣는 값) */
export const COMFORT_LATE_NIGHT = -60;
export const COMFORT_DAYTIME = -20;
export const COMFORT_MIDNIGHT = -10;
/** 자정 넘어서: 00:00 ~ 02:00 (늦게 도는 파티가 많아 조금만 뒤로) */
const MIDNIGHT_ROWS = [0, 4] as const;
/** 새벽: 02:00 ~ 08:00 */
const LATE_NIGHT_ROWS = [4, 16] as const;
/** 평일 낮: 08:00 ~ 18:00 */
const WEEKDAY_DAYTIME_ROWS = [16, 36] as const;
/** 주말 아침: 08:00 ~ 10:00 */
const WEEKEND_MORNING_ROWS = [16, 20] as const;

/** 후보에 붙는 이유. 화면이 문구로 바꿔 보여 준다 (웹 lib/recommendReasons.ts, Android RecommendReasons.kt) */
export type ReasonCode =
  | "PREFERRED"
  | "ADJACENT_SAME_CHARACTER"
  | "ADJACENT"
  | "ADJACENT_PENDING"
  | "USUAL_TIME"
  | "LATE_NIGHT"
  | "DAYTIME"
  | "MIDNIGHT"
  | "PENDING_OVERLAP";

export interface RecommendInput {
  totalSlots: number;
  /** 보스 소요 시간을 덮는 30분 칸 수 */
  durationSlots: number;
  /** 파티원별로 쓸 수 없는 칸 번호 (불가 시간 + 다른 파티 확정 시간) */
  blocked: Iterable<number>[];
  /** 이 칸부터 추천할 수 있다 (현재 시각 + 최소 여유 시간 이후의 첫 칸) */
  earliestSlot: number;
  /** 이미 추천했던 시작 칸. 다음 라운드에서 제외한다 */
  alreadyOffered?: Iterable<number>;
  /** 파티원별 다른 파티 확정 레이드 칸. 그 앞뒤에 붙는 시각을 우선한다 */
  busy?: Iterable<number>[];
  /** 파티원이 겹치는 다른 파티가 투표 중인 후보가 차지한 칸 */
  pending?: Iterable<number>;
  /** 파티원별 다른 파티의 투표 중 후보 칸 (busy와 같은 파티원 순서). 그 앞뒤에 붙는 시각을 조금 우선한다 */
  pendingByMember?: Iterable<number>[];
  /** busy 중 그 파티원이 이 파티와 같은 캐릭터로 잡은 칸 (busy와 같은 순서). 그 앞뒤를 더 우선한다 */
  busySameCharacter?: Iterable<number>[];
  /** pendingByMember 중 같은 캐릭터로 들어간 파티의 칸 (busy와 같은 순서) */
  pendingSameCharacter?: Iterable<number>[];
  /** 파티 선호 시간대에 속하는 칸 */
  preferred?: Iterable<number>;
  /** 칸마다 생활 시간대 보정 (comfortSlots). 시각의 보정은 그 레이드가 걸친 칸 중 가장 나쁜 값 */
  comfort?: readonly number[];
  /** 이 파티가 평소 레이드를 시작한 칸 (usualStartSlots). 같은 칸이 여러 번 나오면 레이드 수만큼 센다 */
  usualStarts?: Iterable<number>;
  /** spread(투표, 기본) 또는 ranked(자동 지정) */
  mode?: "spread" | "ranked";
  /** 최대 후보 수. 기본은 spread 6개, ranked 3개 */
  limit?: number;
}

export interface RankedStart {
  start: number;
  score: number;
  reasons: ReasonCode[];
}

/**
 * 추천 후보와 점수, 이유.
 * spread면 시간순, ranked면 순위순(점수가 같으면 이른 시각)이다.
 */
export function rankStarts(input: RecommendInput): RankedStart[] {
  const { totalSlots, durationSlots } = input;
  const mode = input.mode ?? "spread";
  const limit = input.limit ?? (mode === "ranked" ? RANKED_CANDIDATES : MAX_CANDIDATES);
  if (durationSlots <= 0 || totalSlots <= 0 || limit <= 0) return [];

  const free = new Array<boolean>(totalSlots).fill(true);
  for (const member of input.blocked) {
    for (const index of member) {
      if (Number.isInteger(index) && index >= 0 && index < totalSlots) free[index] = false;
    }
  }
  const offered = new Set(input.alreadyOffered ?? []);
  const busy = (input.busy ?? []).map((member) => new Set(member));
  const pending = new Set(input.pending ?? []);
  const pendingByMember = (input.pendingByMember ?? []).map((member) => new Set(member));
  const busySameCharacter = (input.busySameCharacter ?? []).map((member) => new Set(member));
  const pendingSameCharacter = (input.pendingSameCharacter ?? []).map((member) => new Set(member));
  const memberCount = Math.max(busy.length, pendingByMember.length, busySameCharacter.length, pendingSameCharacter.length);
  const preferred = input.preferred ? new Set(input.preferred) : null;
  const comfort = input.comfort;
  const usual = new Map<number, number>();
  for (const index of input.usualStarts ?? []) usual.set(index, (usual.get(index) ?? 0) + 1);

  const evaluate = (start: number): RankedStart => {
    const slots = Array.from({ length: durationSlots }, (_, i) => start + i);
    const reasons: ReasonCode[] = [];
    let total = SCORE_PER_DAY * Math.floor(start / SLOTS_PER_DAY);
    if (start % 2 === 0) total += SCORE_ON_THE_HOUR;
    if (preferred && slots.every((slot) => preferred.has(slot))) {
      total += SCORE_PREFERRED;
      reasons.push("PREFERRED");
    }

    // 파티원마다 가장 높은 하나: 확정·같은 캐릭터 20 > 확정 15 > 투표 중·같은 캐릭터 12 > 투표 중 8
    const touches = (set: Set<number> | undefined) => !!set && (set.has(start - 1) || set.has(start + durationSlots));
    let adjacent = 0;
    let best = 0;
    for (let member = 0; member < memberCount; member++) {
      const points = touches(busySameCharacter[member])
        ? SCORE_ADJACENT_SAME_CHARACTER
        : touches(busy[member])
          ? SCORE_ADJACENT_PER_MEMBER
          : touches(pendingSameCharacter[member])
            ? SCORE_PENDING_ADJACENT_SAME_CHARACTER
            : touches(pendingByMember[member])
              ? SCORE_PENDING_ADJACENT_PER_MEMBER
              : 0;
      adjacent += points;
      best = Math.max(best, points);
    }
    total += Math.min(adjacent, SCORE_ADJACENT_MAX);
    if (best === SCORE_ADJACENT_SAME_CHARACTER) reasons.push("ADJACENT_SAME_CHARACTER");
    else if (best === SCORE_ADJACENT_PER_MEMBER) reasons.push("ADJACENT");
    else if (best > 0) reasons.push("ADJACENT_PENDING");

    // 평소 레이드 시각: 시작이 ±30분 안인 지난 레이드마다
    const usualCount = (usual.get(start - 1) ?? 0) + (usual.get(start) ?? 0) + (usual.get(start + 1) ?? 0);
    if (usualCount > 0) {
      total += Math.min(usualCount * SCORE_USUAL_PER_RAID, SCORE_USUAL_MAX);
      reasons.push("USUAL_TIME");
    }

    // 생활 시간대: 레이드가 걸친 칸 중 가장 나쁜 값
    if (comfort) {
      const worst = Math.min(0, ...slots.map((slot) => comfort[slot] ?? 0));
      if (worst < 0) {
        total += worst;
        reasons.push(worst <= COMFORT_LATE_NIGHT ? "LATE_NIGHT" : worst <= COMFORT_DAYTIME ? "DAYTIME" : "MIDNIGHT");
      }
    }

    if (slots.some((slot) => pending.has(slot))) {
      total += SCORE_PENDING_OVERLAP;
      reasons.push("PENDING_OVERLAP");
    }
    return { start, score: total, reasons };
  };

  // 가능한 시작 시각 (뒤에서부터 연속으로 비어 있는 칸 수를 세어 찾는다)
  const options: RankedStart[] = [];
  let run = 0;
  for (let i = totalSlots - 1; i >= 0; i--) {
    run = free[i] ? run + 1 : 0;
    if (run >= durationSlots && i >= Math.max(input.earliestSlot, 0) && !offered.has(i)) options.push(evaluate(i));
  }
  const byScore = (a: RankedStart, b: RankedStart) => b.score - a.score || a.start - b.start;
  const apart = (a: RankedStart, b: RankedStart) => Math.abs(a.start - b.start) >= durationSlots;

  if (mode === "ranked") {
    const picks: RankedStart[] = [];
    for (const option of options.sort(byScore)) {
      if (picks.length >= limit) break;
      if (picks.every((picked) => apart(picked, option))) picks.push(option);
    }
    return picks;
  }

  // spread: 요일 안에서 점수 높은 것부터, 앞서 고른 것과 겹치지 않게 차례로 고른다.
  const byDay = new Map<number, RankedStart[]>();
  for (const option of options) {
    const day = Math.floor(option.start / SLOTS_PER_DAY);
    if (!byDay.has(day)) byDay.set(day, []);
    byDay.get(day)!.push(option);
  }
  const picksByDay = [...byDay.entries()].map(([day, dayOptions]) => {
    const picks: RankedStart[] = [];
    for (const option of dayOptions.sort(byScore)) {
      if (picks.every((picked) => apart(picked, option))) picks.push(option);
    }
    return { day, picks };
  });
  // 가장 좋은 후보가 있는 요일부터
  picksByDay.sort((a, b) => b.picks[0].score - a.picks[0].score || a.day - b.day);

  const chosen: RankedStart[] = [];
  for (let rank = 0; chosen.length < limit; rank++) {
    const atRank = picksByDay.filter((day) => day.picks.length > rank);
    if (atRank.length === 0) break;
    for (const day of atRank) {
      if (chosen.length < limit) chosen.push(day.picks[rank]);
    }
  }
  return chosen.sort((a, b) => a.start - b.start);
}

/** 추천 후보의 시작 칸 번호 목록 (spread면 시간순, ranked면 순위순) */
export function recommendStarts(input: RecommendInput): number[] {
  return rankStarts(input).map((option) => option.start);
}

/** 주기의 day번째 날의 요일: 1(월) ~ 7(일) */
const weekdayOf = (firstWeekday: number, day: number) => ((firstWeekday - 1 + day) % 7) + 1;

/**
 * 선호 시간대에 속하는 칸 번호. 주기의 모든 날짜에 대해, 요일이 맞으면 그 시간 범위의 칸을 넣는다.
 * @param firstWeekday 주기 첫날의 요일: 1(월) ~ 7(일)
 */
export function preferredSlots(
  window: { days: number[]; startRow: number; endRow: number },
  totalSlots: number,
  firstWeekday: number,
): number[] {
  const slots: number[] = [];
  for (let day = 0; day * SLOTS_PER_DAY < totalSlots; day++) {
    if (!window.days.includes(weekdayOf(firstWeekday, day))) continue;
    for (let row = window.startRow; row < window.endRow; row++) slots.push(day * SLOTS_PER_DAY + row);
  }
  return slots;
}

/**
 * 생활 시간대 보정: 칸마다 점수. 선호 시간대 안의 칸은 0.
 * - 새벽(02~08시) −60
 * - 평일(월~금) 낮(08~18시)·주말 아침(08~10시) −20
 * - 자정 넘어서(00~02시) −10
 * - 그 밖(평일 18~24시, 주말 10~24시) 0
 * @param firstWeekday 주기 첫날의 요일: 1(월) ~ 7(일)
 */
export function comfortSlots(totalSlots: number, firstWeekday: number, preferred?: Iterable<number>): number[] {
  const inPreferred = new Set(preferred ?? []);
  const within = (row: number, [from, to]: readonly [number, number]) => row >= from && row < to;
  const result = new Array<number>(Math.max(totalSlots, 0)).fill(0);
  for (let index = 0; index < totalSlots; index++) {
    if (inPreferred.has(index)) continue;
    const row = index % SLOTS_PER_DAY;
    const weekend = weekdayOf(firstWeekday, Math.floor(index / SLOTS_PER_DAY)) >= 6;
    if (within(row, LATE_NIGHT_ROWS)) result[index] = COMFORT_LATE_NIGHT;
    else if (within(row, MIDNIGHT_ROWS)) result[index] = COMFORT_MIDNIGHT;
    else if (within(row, weekend ? WEEKEND_MORNING_ROWS : WEEKDAY_DAYTIME_ROWS)) result[index] = COMFORT_DAYTIME;
  }
  return result;
}

/**
 * 지난 레이드 시작 시각(요일·하루 안의 칸)을 이 주기의 같은 요일·칸 번호로 옮긴다.
 * 월간 주기처럼 같은 요일이 여러 번 있으면 모두 넣는다.
 */
export function usualStartSlots(
  past: readonly { weekday: number; row: number }[],
  totalSlots: number,
  firstWeekday: number,
): number[] {
  const slots: number[] = [];
  for (let day = 0; day * SLOTS_PER_DAY < totalSlots; day++) {
    const weekday = weekdayOf(firstWeekday, day);
    for (const raid of past) {
      const index = day * SLOTS_PER_DAY + raid.row;
      if (raid.weekday === weekday && index < totalSlots) slots.push(index);
    }
  }
  return slots;
}

/** 전원이 동의한 후보 번호. 한 명이라도 이번 라운드 투표가 없으면 null */
export function unanimousCandidates(candidateCount: number, votes: (number[] | undefined)[]): number[] | null {
  if (votes.length === 0 || votes.some((vote) => vote === undefined)) return null;
  const result: number[] = [];
  for (let index = 0; index < candidateCount; index++) {
    if (votes.every((vote) => vote!.includes(index))) result.push(index);
  }
  return result;
}
