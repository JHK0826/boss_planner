/**
 * 파티로 갈 수 있는 주간·월간 보스 목록. 앱은 getBossCatalog로 이 목록을 받아 쓴다.
 *
 * - 이름과 난이도는 NEXON 스케줄러 API의 boss_contents 값과 같아야 05:00 자동 클리어 확인이 된다
 *   (2026-11 기준 API 응답에서 가져옴).
 * - 시즌 보스는 솔로 전용이라 넣지 않는다.
 * - 새 보스가 나오면 여기에만 추가하고 Functions를 배포하면 된다. 앱은 다시 설치하지 않아도 된다.
 */

import type { Cycle } from "./time";

export type Difficulty = "EASY" | "NORMAL" | "HARD" | "CHAOS" | "EXTREME";

export interface BossCatalogEntry {
  name: string;
  difficulties: Difficulty[];
  cycle: Cycle;
}

export interface PartyBoss {
  name: string;
  difficulty: Difficulty;
}

const weekly = (name: string, ...difficulties: Difficulty[]): BossCatalogEntry => ({ name, difficulties, cycle: "WEEKLY" });

export const BOSS_CATALOG: BossCatalogEntry[] = [
  weekly("자쿰", "CHAOS"),
  weekly("매그너스", "HARD"),
  weekly("파풀라투스", "CHAOS"),
  weekly("피에르", "CHAOS"),
  weekly("반반", "CHAOS"),
  weekly("블러디퀸", "CHAOS"),
  weekly("벨룸", "CHAOS"),
  weekly("스우", "NORMAL", "HARD", "EXTREME"),
  weekly("데미안", "NORMAL", "HARD"),
  weekly("가디언 엔젤 슬라임", "NORMAL", "CHAOS"),
  weekly("루시드", "EASY", "NORMAL", "HARD"),
  weekly("윌", "EASY", "NORMAL", "HARD"),
  weekly("더스크", "NORMAL", "CHAOS"),
  weekly("진 힐라", "NORMAL", "HARD"),
  weekly("듄켈", "NORMAL", "HARD"),
  { name: "검은 마법사", difficulties: ["HARD", "EXTREME"], cycle: "MONTHLY" },
  weekly("선택받은 세렌", "NORMAL", "HARD", "EXTREME"),
  weekly("감시자 칼로스", "EASY", "NORMAL", "CHAOS", "EXTREME"),
  weekly("카링", "EASY", "NORMAL", "HARD", "EXTREME"),
  weekly("림보", "NORMAL", "HARD", "EXTREME"),
  weekly("발드릭스", "NORMAL", "HARD", "EXTREME"),
  weekly("최초의 대적자", "EASY", "NORMAL", "HARD", "EXTREME"),
  weekly("찬란한 흉성", "NORMAL", "HARD"),
  weekly("유피테르", "NORMAL", "HARD"),
  weekly("벨로나", "EASY", "NORMAL", "HARD"),
];

/** 한 파티에 묶을 수 있는 보스 수 (캐릭터당 주간 보스 클리어 한도) */
export const MAX_BOSSES_PER_PARTY = 12;
/** 보스 하나에 잡는 시간. 보스 전투 제한 시간이 최대 20분이다. */
export const MINUTES_PER_BOSS = 20;

export type BossSelection =
  | { ok: true; bosses: PartyBoss[]; cycle: Cycle }
  | { ok: false; reason: "empty" | "too-many" | "unknown-boss" | "bad-difficulty" | "duplicate" | "mixed-cycle" };

/**
 * 파티에 묶을 보스 선택을 검사한다.
 * 목록에 있는 보스·난이도여야 하고, 같은 보스를 두 번 넣을 수 없으며,
 * 주간 보스와 월간 보스는 주기가 달라 한 파티에 섞을 수 없다.
 */
export function validateBossSelection(input: unknown): BossSelection {
  if (!Array.isArray(input) || input.length === 0) return { ok: false, reason: "empty" };
  if (input.length > MAX_BOSSES_PER_PARTY) return { ok: false, reason: "too-many" };

  const bosses: PartyBoss[] = [];
  const cycles = new Set<Cycle>();
  for (const item of input as { name?: unknown; difficulty?: unknown }[]) {
    const entry = BOSS_CATALOG.find((boss) => boss.name === item?.name);
    if (!entry) return { ok: false, reason: "unknown-boss" };
    if (!entry.difficulties.includes(item.difficulty as Difficulty)) return { ok: false, reason: "bad-difficulty" };
    if (bosses.some((boss) => boss.name === entry.name)) return { ok: false, reason: "duplicate" };
    bosses.push({ name: entry.name, difficulty: item.difficulty as Difficulty });
    cycles.add(entry.cycle);
  }
  if (cycles.size > 1) return { ok: false, reason: "mixed-cycle" };
  return { ok: true, bosses, cycle: [...cycles][0] };
}

/** 파티 문서에서 보스 목록을 읽는다. 보스가 하나뿐이던 예전 형식(bossName, difficulty)도 받는다. */
export function bossesOf(party: { bosses?: unknown; bossName?: unknown; difficulty?: unknown }): PartyBoss[] {
  if (Array.isArray(party.bosses)) return party.bosses as PartyBoss[];
  if (typeof party.bossName === "string") {
    return [{ name: party.bossName, difficulty: party.difficulty as Difficulty }];
  }
  return [];
}
