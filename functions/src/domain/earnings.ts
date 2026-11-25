/**
 * 내 캐릭터의 보스 스케줄러와 수익 계산 (순수 함수).
 *
 * - 결정석 수익: 클리어한 보스마다 "결정석 가격 ÷ 인원수"(메소, 내림)를 더한다.
 * - 인원수: 그 캐릭터가 그 보스로 들어간 앱의 파티 인원. 없으면 혼자(1)로 본다.
 * - 정산금: 받는 사람은 경매장 수수료를 뗀 실제 수령액, 판매자는 정산이 끝났을 때 남는 몫.
 */

import { crystalPrice } from "./crystals";
import { currentPeriod } from "./time";

export type BossCycle = "WEEKLY" | "MONTHLY";

/** 스케줄러에 등록한 보스 하나 */
export interface SchedulerBoss {
  name: string;
  /** 대문자 코드: EASY | NORMAL | HARD | CHAOS | EXTREME */
  difficulty: string;
  cycle: BossCycle;
  cleared: boolean;
}

/** NEXON 스케줄러 응답의 boss_contents 항목 (플래그는 문자열 "true"/"false") */
export interface BossContentLike {
  content_name: string;
  difficulty: string;
  cycle: string;
  registration_flag?: string;
  complete_flag: string;
}

/** 스케줄러에 등록한 주간·월간 보스만 고른다(일간 보스 제외). 응답 순서를 지킨다. */
export function registeredBosses(contents: BossContentLike[]): SchedulerBoss[] {
  return contents.flatMap((c) => {
    if (c.registration_flag !== "true") return [];
    const cycle: BossCycle | null = c.cycle === "bossWeekly" ? "WEEKLY" : c.cycle === "bossMonthly" ? "MONTHLY" : null;
    if (!cycle) return [];
    return [{ name: c.content_name, difficulty: c.difficulty.toUpperCase(), cycle, cleared: c.complete_flag === "true" }];
  });
}

/** 인원수를 찾는 데 필요한 파티 정보 */
export interface PartyForSize {
  memberUids: string[];
  members: Record<string, { characterId?: string } | undefined>;
  bosses: { name: string }[];
  /** 그 주기에 파티장이 추가한 임시 용병 수. 레이드 인원에 더한다 */
  extraMercenaries?: number;
}

/** 그 캐릭터가 그 보스로 들어간 파티의 인원(임시 용병 포함). 없으면 1 */
export function partySizeFor(parties: PartyForSize[], uid: string, characterId: string, bossName: string): number {
  const party = parties.find(
    (p) => p.memberUids.includes(uid) && p.members[uid]?.characterId === characterId && p.bosses.some((b) => b.name === bossName),
  );
  return party ? Math.max(1, party.memberUids.length + (party.extraMercenaries ?? 0)) : 1;
}

/** 칩 하나에 보여 줄 값 */
export interface PricedBoss extends SchedulerBoss {
  partySize: number;
  /** 결정석 가격. 미등록이면 null */
  price: number | null;
  /** 내 몫 = 가격 ÷ 인원수 (내림). 미등록이면 0 */
  share: number;
}

export function priceBosses(
  bosses: SchedulerBoss[],
  parties: PartyForSize[],
  uid: string,
  characterId: string,
  prices?: Record<string, number>,
): PricedBoss[] {
  return bosses.map((boss) => {
    const partySize = partySizeFor(parties, uid, characterId, boss.name);
    const price = crystalPrice(boss.name, boss.difficulty, prices);
    return { ...boss, partySize, price, share: price === null ? 0 : Math.floor(price / partySize) };
  });
}

export interface CrystalSummary {
  crystalValue: number;
  crystalCount: number;
}

/** 클리어한 보스의 결정석 합계 (주간 또는 월간) */
export function clearedSummary(bosses: PricedBoss[], cycle: BossCycle): CrystalSummary {
  const cleared = bosses.filter((b) => b.cycle === cycle && b.cleared);
  return { crystalValue: cleared.reduce((sum, b) => sum + b.share, 0), crystalCount: cleared.length };
}

/** 수익 기록 문서 ID: 주간 "W-yyyyMMdd"(목요일 시작), 월간 "M-yyyyMM" */
export const weekIdOf = (ms: number) => currentPeriod("WEEKLY", ms).id;
export const monthIdOf = (ms: number) => currentPeriod("MONTHLY", ms).id;

/** 주간 기록이 속한 달: 시작일(목요일)의 달. "W-20261126" → "M-202611" */
export const monthOfWeekId = (weekId: string) => `M-${weekId.slice(2, 8)}`;

/** 정산 계산에 필요한 값 */
export interface SettlementForShares {
  sellerUid: string;
  feePercent?: number | null;
  sellerAmount?: number | null;
  completed?: boolean;
}

/**
 * 한 정산에서 사람마다 실제로 번 돈.
 * - 받는 사람: 수령 확인한 뒤에만. 경매장에 정산금 가격으로 올려 팔면 수수료를 한 번 더 떼므로 그만큼 뺀다.
 * - 판매자: 정산이 끝난 뒤에만. 판매액에서 수수료를 떼고 나눠 준 뒤 남은 몫.
 */
export function settlementShares(
  settlement: SettlementForShares,
  entries: { uid: string; amount: number; status: string }[],
): Record<string, number> {
  const fee = typeof settlement.feePercent === "number" ? settlement.feePercent : 0;
  const shares: Record<string, number> = {};
  for (const entry of entries) {
    if (entry.status === "RECEIVED") shares[entry.uid] = Math.floor((entry.amount * (100 - fee)) / 100);
  }
  if (settlement.completed && typeof settlement.sellerAmount === "number") {
    shares[settlement.sellerUid] = settlement.sellerAmount;
  }
  return shares;
}
