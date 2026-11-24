export const REGION = "asia-northeast3"; // 서울
export const TIME_ZONE = "Asia/Seoul";

/**
 * NEXON에서 받은 데이터는 30일 안에 다시 받아야 한다(NEXON Open API 데이터 갱신 의무).
 * 매일 05시 작업이 한 번에 처리하는 수를 제한하므로 여유를 두고 25일이 지나면 다시 받는다.
 */
export const CHARACTER_REFRESH_AFTER_MS = 25 * 24 * 60 * 60 * 1000;
/** 캐릭터 목록(ocid)을 앱에서 열 때 다시 받는 기준 */
export const CHARACTER_LIST_TTL_MS = CHARACTER_REFRESH_AFTER_MS;
/** 캐릭터 기본 정보 캐시 유지 시간 */
export const CHARACTER_INFO_TTL_MS = 24 * 60 * 60 * 1000;
