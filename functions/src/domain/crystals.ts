/**
 * 보스 결정석 가격표 (메소). 내 캐릭터 탭의 예상 수익과 수익 기록에 쓴다.
 *
 * - 키는 "보스 이름|난이도". 이름·난이도 표기는 bosses.ts의 BOSS_CATALOG와 같다(난이도는 대문자 코드).
 * - 패치로 가격이 바뀌면 이 표만 고쳐 Functions를 배포하면 된다. 앱은 getBossCatalog로 받아 쓰므로 다시 설치하지 않아도 된다.
 * - 표에 없는 보스는 가격 미등록으로 보고 수익을 0으로 센다.
 */

import type { Difficulty } from "./bosses";

export const CRYSTAL_PRICES: Record<string, number> = {
  // 예: "스우|HARD": 0,
};

export const crystalKey = (name: string, difficulty: string) => `${name}|${difficulty.toUpperCase()}`;

/** 가격이 없으면 null */
export function crystalPrice(name: string, difficulty: string, prices: Record<string, number> = CRYSTAL_PRICES): number | null {
  const price = prices[crystalKey(name, difficulty)];
  return typeof price === "number" && price > 0 ? price : null;
}

/** 앱에 내려 주는 형태 */
export function crystalPriceList(prices: Record<string, number> = CRYSTAL_PRICES): { name: string; difficulty: Difficulty; price: number }[] {
  return Object.entries(prices).flatMap(([key, price]) => {
    const [name, difficulty] = key.split("|");
    return name && difficulty && price > 0 ? [{ name, difficulty: difficulty as Difficulty, price }] : [];
  });
}
