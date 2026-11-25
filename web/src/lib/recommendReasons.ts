// 추천 후보의 이유 코드 → 문구. 서버 functions/src/domain/recommend.ts의 ReasonCode, Android ui/RecommendReasons.kt와 같다.

const LABELS: Record<string, string> = {
  PREFERRED: "선호 시간대",
  ADJACENT_SAME_CHARACTER: "같은 캐릭터 레이드와 이어서",
  ADJACENT: "다른 레이드와 이어서",
  ADJACENT_PENDING: "다른 파티 후보와 이어서",
  USUAL_TIME: "평소 레이드 시간",
  LATE_NIGHT: "새벽",
  DAYTIME: "낮·아침 시간",
  MIDNIGHT: "자정 넘어서",
  PENDING_OVERLAP: "다른 파티 후보와 겹침",
};

/** 이유 코드를 "선호 시간대 · 평소 레이드 시간"처럼 붙인 문구. 모르는 코드는 뺀다 */
export function reasonText(reasons: readonly string[]): string {
  return reasons
    .map((code) => LABELS[code])
    .filter((label): label is string => !!label)
    .join(" · ");
}
