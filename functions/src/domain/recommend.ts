/**
 * 추천 시간 계산 (순수 함수).
 *
 * 1. 가능한 시작 시각을 모두 찾는다. 전원이 소요 시간 내내 비어 있어야 한다.
 *    불가 시간과 다른 파티의 확정 시간(busy)은 호출하는 쪽에서 합쳐 blocked로 넘긴다. 둘은 같은 판정이다.
 *    이미 지난 시간과 최소 여유 시간 안쪽은 쓰지 않는다(earliestSlot).
 * 2. 시작 시각마다 점수를 매긴다. 높을수록 먼저 추천한다.
 *      + 파티 선호 시간대 안에 온전히 들어감
 *      + 파티원의 다른 확정 레이드 바로 앞이나 뒤 (한 번 접속에 몰아서 돌 수 있음)
 *      − 파티원이 겹치는 다른 파티가 투표 중인 후보와 겹침 (나중에 한쪽이 거절당해 다시 투표하게 됨)
 *      + 정각에 시작
 *      + 주기 앞쪽 날짜 (미클리어 때 다시 잡을 여유가 남음)
 * 3. 요일마다 가장 좋은 시각을 하나씩 고르고, 자리가 남으면 요일마다 두 번째, 세 번째를 채운다.
 *    같은 날의 후보끼리는 시간이 겹치지 않는다.
 */

export const SLOTS_PER_DAY = 48;
export const MAX_CANDIDATES = 6;

const SCORE_PREFERRED = 100;
const SCORE_ADJACENT_PER_MEMBER = 15;
const SCORE_ADJACENT_MAX = 60;
const SCORE_PENDING_OVERLAP = -60;
const SCORE_ON_THE_HOUR = 5;
const SCORE_PER_DAY = -1;

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
  /** 파티 선호 시간대에 속하는 칸 */
  preferred?: Iterable<number>;
  limit?: number;
}

/** 추천 후보의 시작 칸 번호 목록 (시간순) */
export function recommendStarts(input: RecommendInput): number[] {
  const { totalSlots, durationSlots, limit = MAX_CANDIDATES } = input;
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
  const preferred = input.preferred ? new Set(input.preferred) : null;

  const score = (start: number): number => {
    const slots = Array.from({ length: durationSlots }, (_, i) => start + i);
    let total = SCORE_PER_DAY * Math.floor(start / SLOTS_PER_DAY);
    if (start % 2 === 0) total += SCORE_ON_THE_HOUR;
    if (preferred && slots.every((slot) => preferred.has(slot))) total += SCORE_PREFERRED;
    if (slots.some((slot) => pending.has(slot))) total += SCORE_PENDING_OVERLAP;
    const adjacent = busy.filter((member) => member.has(start - 1) || member.has(start + durationSlots)).length;
    return total + Math.min(adjacent * SCORE_ADJACENT_PER_MEMBER, SCORE_ADJACENT_MAX);
  };

  // 요일별로 가능한 시작 시각을 점수순으로 모은다.
  const byDay = new Map<number, { start: number; score: number }[]>();
  let run = 0;
  for (let i = totalSlots - 1; i >= 0; i--) {
    run = free[i] ? run + 1 : 0;
    if (run >= durationSlots && i >= Math.max(input.earliestSlot, 0) && !offered.has(i)) {
      const day = Math.floor(i / SLOTS_PER_DAY);
      if (!byDay.has(day)) byDay.set(day, []);
      byDay.get(day)!.push({ start: i, score: score(i) });
    }
  }

  // 요일 안에서: 점수 높은 것부터, 앞서 고른 것과 겹치지 않게 차례로 고른다.
  const picksByDay = [...byDay.entries()].map(([day, options]) => {
    options.sort((a, b) => b.score - a.score || a.start - b.start);
    const picks: { start: number; score: number }[] = [];
    for (const option of options) {
      if (picks.every((picked) => Math.abs(picked.start - option.start) >= durationSlots)) picks.push(option);
    }
    return { day, picks };
  });
  // 가장 좋은 후보가 있는 요일부터
  picksByDay.sort((a, b) => b.picks[0].score - a.picks[0].score || a.day - b.day);

  const chosen: number[] = [];
  for (let rank = 0; chosen.length < limit; rank++) {
    const atRank = picksByDay.filter((day) => day.picks.length > rank);
    if (atRank.length === 0) break;
    for (const day of atRank) {
      if (chosen.length < limit) chosen.push(day.picks[rank].start);
    }
  }
  return chosen.sort((a, b) => a - b);
}

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
    const weekday = ((firstWeekday - 1 + day) % 7) + 1;
    if (!window.days.includes(weekday)) continue;
    for (let row = window.startRow; row < window.endRow; row++) slots.push(day * SLOTS_PER_DAY + row);
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
