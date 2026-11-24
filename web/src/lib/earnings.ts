// 수익 보기 화면 계산. 기간 ID 규칙은 서버 코드(functions/src/domain/earnings.ts)를 그대로 쓴다.
import { monthIdOf, monthOfWeekId, weekIdOf } from "@shared/domain/earnings";
import type { EarningsRecord, SchedulerBoss } from "./model";

export { monthIdOf, weekIdOf };

/** 난이도 배지 글자 */
export const DIFFICULTY_SHORT: Record<string, string> = { EXTREME: "EX", CHAOS: "C", HARD: "H", NORMAL: "N", EASY: "E" };

/** 이번 주 예상 수익: 등록한 주간 보스 전부 + 이번 달에 아직 안 잡은 월간 보스의 몫 */
export function expectedThisWeek(bosses: SchedulerBoss[]): number {
  return bosses.filter((b) => b.cycle === "WEEKLY" || !b.cleared).reduce((sum, b) => sum + b.share, 0);
}

export interface SettlementLine {
  key: string;
  partyName: string;
  amount: number;
  raidAtMs: number;
}

/** 이번 주에 번 돈: 클리어한 주간 보스의 결정석 + 이번 주 레이드의 정산금 */
export function earnedThisWeek(bosses: SchedulerBoss[], records: EarningsRecord[], characterId: string, nowMs: number) {
  const crystal = bosses.filter((b) => b.cycle === "WEEKLY" && b.cleared).reduce((sum, b) => sum + b.share, 0);
  const week = records.find((r) => r.id === weekIdOf(nowMs));
  const settlements: SettlementLine[] = Object.entries(week?.settlements ?? {})
    .filter(([, s]) => s.characterId === characterId)
    .map(([key, s]) => ({ key, partyName: s.partyName, amount: s.amount, raidAtMs: s.raidAtMs }))
    .sort((a, b) => a.raidAtMs - b.raidAtMs);
  const settlement = settlements.reduce((sum, s) => sum + s.amount, 0);
  return { crystal, settlement, total: crystal + settlement, settlements };
}

export interface MonthEarnings {
  monthId: string;
  /** "2026년 11월" */
  label: string;
  crystal: number;
  settlement: number;
  total: number;
  /** 그 달 기록이 하나라도 있는가 */
  recorded: boolean;
}

/** "M-202611"에서 n달 전 */
function monthsBefore(monthId: string, n: number): string {
  const year = Number(monthId.slice(2, 6));
  const month = Number(monthId.slice(6, 8)) - 1 - n;
  const y = year + Math.floor(month / 12);
  const m = ((month % 12) + 12) % 12;
  return `M-${y}${String(m + 1).padStart(2, "0")}`;
}

/** 최근 n달(이번 달부터)의 결정석·정산금. 주간 기록은 시작일(목요일)이 속한 달로 묶고 월간 결정석을 더한다. */
export function monthlyEarnings(records: EarningsRecord[], characterId: string, nowMs: number, count = 6): MonthEarnings[] {
  const current = monthIdOf(nowMs);
  return Array.from({ length: count }, (_, i) => {
    const monthId = monthsBefore(current, i);
    let crystal = 0;
    let settlement = 0;
    let recorded = false;
    for (const record of records) {
      const inMonth = record.id === monthId || (record.id.startsWith("W-") && monthOfWeekId(record.id) === monthId);
      if (!inMonth) continue;
      const mine = record.characters[characterId];
      if (mine) {
        crystal += mine.crystalValue;
        recorded = true;
      }
      for (const s of Object.values(record.settlements)) {
        if (s.characterId === characterId) {
          settlement += s.amount;
          recorded = true;
        }
      }
    }
    return {
      monthId,
      label: `${monthId.slice(2, 6)}년 ${Number(monthId.slice(6, 8))}월`,
      crystal,
      settlement,
      total: crystal + settlement,
      recorded,
    };
  });
}
