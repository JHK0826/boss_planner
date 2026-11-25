/**
 * 투표 없이 자동 지정하는 파티끼리의 확정 순서 (순수 함수).
 *
 * 같은 사람이 들어간 두 자동 지정 파티가 동시에 확정할 수 있으면, 우선순위가 높은 파티가 먼저 확정하고
 * 다른 파티는 미뤘다가 그 시간을 피해 확정한다.
 * 1. 제출 완료 시각이 1분 이상 차이 나면 먼저 끝낸 파티가 먼저
 * 2. 1분 안이면 동시로 보고, 결정석 값(묶은 보스 가격 합)이 큰 파티가 먼저
 * 3. 그래도 같으면 파티 ID 순 (항상 같은 결과)
 */
import { crystalPrice } from "./crystals";

/** 이 시간 안에 제출을 끝낸 파티들은 동시로 본다 */
export const AUTO_TIE_WINDOW_MS = 60_000;

export interface AutoPriority {
  partyId: string;
  /** 참여 파티원 전원이 제출을 끝낸 시각 (마지막 제출의 서버 시각) */
  completedAtMs: number;
  /** 묶은 보스의 결정석 가격 합 */
  crystalValue: number;
}

/** 묶은 보스의 결정석 가격 합. 가격표에 없는 보스는 0. 인원수로 나누지 않는다 */
export function partyCrystalValue(bosses: readonly { name: string; difficulty: string }[], prices?: Record<string, number>): number {
  return bosses.reduce((sum, boss) => sum + (crystalPrice(boss.name, boss.difficulty, prices) ?? 0), 0);
}

/** a가 b보다 먼저 확정해야 하면 음수, 나중이면 양수 */
export function compareAutoPriority(a: AutoPriority, b: AutoPriority): number {
  const gap = a.completedAtMs - b.completedAtMs;
  if (Math.abs(gap) >= AUTO_TIE_WINDOW_MS) return gap;
  if (a.crystalValue !== b.crystalValue) return b.crystalValue - a.crystalValue;
  return a.partyId < b.partyId ? -1 : a.partyId > b.partyId ? 1 : 0;
}
