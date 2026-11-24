/**
 * 보스 결정석 가격표 (메소). 내 캐릭터 탭의 예상 수익과 수익 기록에 쓴다.
 *
 * - 게임 안 "강렬한 힘의 결정 가격" 목록에서 옮겼다(2026-11).
 * - 키는 "보스 이름|난이도". 이름·난이도 표기는 bosses.ts의 BOSS_CATALOG와 같다(난이도는 대문자 코드).
 *   이름을 찾을 때 띄어쓰기는 보지 않는다(게임 목록은 "블러디 퀸", 스케줄러 API는 "블러디퀸").
 * - 패치로 가격이 바뀌면 이 표만 고쳐 Functions를 배포하면 된다. 앱은 서버가 계산한 값을 받으므로 다시 설치하지 않아도 된다.
 * - 표에 없는 보스는 가격 미등록으로 보고 수익을 0으로 센다.
 */

import type { Difficulty } from "./bosses";

export const CRYSTAL_PRICES: Record<string, number> = {
  "자쿰|CHAOS": 4_040_000,
  "매그너스|HARD": 4_280_000,
  "파풀라투스|CHAOS": 6_550_000,
  "피에르|CHAOS": 4_080_000,
  "반반|CHAOS": 4_070_000,
  "블러디퀸|CHAOS": 4_070_000,
  "벨룸|CHAOS": 4_640_000,
  "스우|NORMAL": 8_350_000,
  "스우|HARD": 48_900_000,
  "스우|EXTREME": 545_000_000,
  "데미안|NORMAL": 8_750_000,
  "데미안|HARD": 46_400_000,
  "가디언 엔젤 슬라임|NORMAL": 12_700_000,
  "가디언 엔젤 슬라임|CHAOS": 71_300_000,
  "루시드|EASY": 14_900_000,
  "루시드|NORMAL": 17_800_000,
  "루시드|HARD": 59_700_000,
  "윌|EASY": 16_100_000,
  "윌|NORMAL": 20_500_000,
  "윌|HARD": 73_200_000,
  "더스크|NORMAL": 22_000_000,
  "더스크|CHAOS": 66_300_000,
  "진 힐라|NORMAL": 67_600_000,
  "진 힐라|HARD": 100_000_000,
  "듄켈|NORMAL": 23_700_000,
  "듄켈|HARD": 89_600_000,
  "검은 마법사|HARD": 465_000_000,
  "검은 마법사|EXTREME": 5_680_000_000,
  "선택받은 세렌|NORMAL": 167_000_000,
  "선택받은 세렌|HARD": 302_000_000,
  "선택받은 세렌|EXTREME": 1_840_000_000,
  "감시자 칼로스|EASY": 238_000_000,
  "감시자 칼로스|NORMAL": 479_000_000,
  "감시자 칼로스|CHAOS": 1_230_000_000,
  "감시자 칼로스|EXTREME": 4_104_000_000,
  "카링|EASY": 320_000_000,
  "카링|NORMAL": 593_000_000,
  "카링|HARD": 1_560_000_000,
  "카링|EXTREME": 4_845_000_000,
  "림보|NORMAL": 995_000_000,
  "림보|HARD": 2_385_000_000,
  "림보|EXTREME": 7_500_000_000,
  "발드릭스|NORMAL": 1_320_000_000,
  "발드릭스|HARD": 3_078_000_000,
  "발드릭스|EXTREME": 9_600_000_000,
  "최초의 대적자|EASY": 261_000_000,
  "최초의 대적자|NORMAL": 532_000_000,
  "최초의 대적자|HARD": 1_390_000_000,
  "최초의 대적자|EXTREME": 4_712_000_000,
  "찬란한 흉성|NORMAL": 576_000_000,
  "찬란한 흉성|HARD": 2_678_000_000,
  "유피테르|NORMAL": 1_560_000_000,
  "유피테르|HARD": 5_387_000_000,
  "벨로나|EASY": 396_000_000,
  "벨로나|NORMAL": 824_000_000,
  "벨로나|HARD": 2_950_000_000,
};

/** 이름의 띄어쓰기와 난이도의 대소문자를 무시한 비교용 키 */
const normalizedKey = (name: string, difficulty: string) => `${name.replace(/\s+/g, "")}|${difficulty.toUpperCase()}`;

/** 가격이 없으면 null */
export function crystalPrice(name: string, difficulty: string, prices: Record<string, number> = CRYSTAL_PRICES): number | null {
  const wanted = normalizedKey(name, difficulty);
  for (const [key, price] of Object.entries(prices)) {
    const [entryName, entryDifficulty] = key.split("|");
    if (entryName && entryDifficulty && normalizedKey(entryName, entryDifficulty) === wanted) {
      return price > 0 ? price : null;
    }
  }
  return null;
}

/** 앱에 내려 주는 형태 */
export function crystalPriceList(prices: Record<string, number> = CRYSTAL_PRICES): { name: string; difficulty: Difficulty; price: number }[] {
  return Object.entries(prices).flatMap(([key, price]) => {
    const [name, difficulty] = key.split("|");
    return name && difficulty && price > 0 ? [{ name, difficulty: difficulty as Difficulty, price }] : [];
  });
}
