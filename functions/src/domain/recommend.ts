/**
 * 추천 시간 계산 (순수 함수).
 *
 * 1. 파티원 전원이 비어 있는 칸을 구한다. 불가 시간과 다른 파티의 확정 시간(busy)은
 *    호출하는 쪽에서 합쳐 blocked로 넘긴다. 둘은 같은 판정이다.
 * 2. 이미 지난 칸은 쓸 수 없다.
 * 3. 연속으로 빈 구간마다 앞에서부터 보스 소요 시간만큼 겹치지 않게 자른다.
 * 4. 각 구간의 첫 번째 블록들을 빠른 순으로, 그다음 두 번째 블록들을 빠른 순으로 늘어놓는다.
 *    붙어 있는 시간 3개가 아니라 서로 다른 시간대가 먼저 추천되게 하기 위해서다.
 */

export interface RecommendInput {
  totalSlots: number;
  /** 보스 소요 시간 (30분 칸 수) */
  durationSlots: number;
  /** 파티원별로 쓸 수 없는 칸 번호 */
  blocked: Iterable<number>[];
  /** 이 칸부터 추천할 수 있다 (현재 시각 이후의 첫 칸) */
  earliestSlot: number;
  /** 이미 추천했던 시작 칸. 다음 라운드에서 제외한다 */
  alreadyOffered?: Iterable<number>;
  limit?: number;
}

/** 추천 후보의 시작 칸 번호 목록 */
export function recommendStarts(input: RecommendInput): number[] {
  const { totalSlots, durationSlots, limit = 3 } = input;
  if (durationSlots <= 0 || totalSlots <= 0) return [];

  const free = new Array<boolean>(totalSlots).fill(true);
  for (let i = 0; i < Math.min(Math.max(input.earliestSlot, 0), totalSlots); i++) free[i] = false;
  for (const member of input.blocked) {
    for (const index of member) {
      if (Number.isInteger(index) && index >= 0 && index < totalSlots) free[index] = false;
    }
  }

  // rank번째 블록끼리 묶는다: blocksByRank[0] = 각 구간의 첫 블록들
  const blocksByRank: number[][] = [];
  let runStart = -1;
  for (let i = 0; i <= totalSlots; i++) {
    const isFree = i < totalSlots && free[i];
    if (isFree && runStart < 0) runStart = i;
    if (!isFree && runStart >= 0) {
      for (let start = runStart, rank = 0; start + durationSlots <= i; start += durationSlots, rank++) {
        (blocksByRank[rank] ??= []).push(start);
      }
      runStart = -1;
    }
  }

  const offered = new Set(input.alreadyOffered ?? []);
  return blocksByRank
    .flat()
    .filter((start) => !offered.has(start))
    .slice(0, limit);
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
