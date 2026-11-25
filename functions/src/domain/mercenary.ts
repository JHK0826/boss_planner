/**
 * 이번 주기 용병 (순수 함수). 서버와 웹이 같이 쓴다(웹은 @shared로 가져옴). Android는 PartyModels.kt에 같은 규칙이 있다.
 *
 * - 파티원이 "이번 주기 용병으로 대체"를 누르면 replaces에 그 uid가 들어간 용병이 생긴다.
 *   그 주기에는 불가 시간 입력·투표·확정 일정에서 빠진다.
 * - 파티장이 "임시 용병 추가"를 누르면 replaces가 null인 용병이 생겨 그 주기 인원이 한 명 늘어난다.
 * - 용병은 계정·스케줄러가 없는 더미라 시간 제약이 없고, 정산에서는 1인분을 받는다(판매자가 직접 지급).
 */

export const MERCENARY_ID_PREFIX = "merc_";
/** 파티 정원: 파티원 + 그 주기에 파티장이 추가한 임시 용병 */
export const MAX_PARTY_SIZE = 6;
export const MERCENARY_NAME_MAX = 12;

export interface MercenaryLike {
  id: string;
  name: string;
  /** 대체한 파티원 uid. 파티장이 추가한 용병이면 null */
  replaces: string | null;
}

export const isMercenaryId = (id: string): boolean => id.startsWith(MERCENARY_ID_PREFIX);

/** 그 주기에 용병으로 대체된 파티원 */
export function replacedUids(mercenaries: readonly MercenaryLike[] | null | undefined): Set<string> {
  return new Set((mercenaries ?? []).map((merc) => merc.replaces).filter((uid): uid is string => typeof uid === "string"));
}

/** 그 주기에 실제로 참여하는 파티원 (대체된 사람 제외). 순서는 memberUids 그대로 */
export function activeMemberUids(memberUids: readonly string[], mercenaries: readonly MercenaryLike[] | null | undefined): string[] {
  const replaced = replacedUids(mercenaries);
  return memberUids.filter((uid) => !replaced.has(uid));
}

/** 파티장이 추가한 용병 수 (레이드 인원 = 파티원 수 + 이 값) */
export const extraMercenaryCount = (mercenaries: readonly MercenaryLike[] | null | undefined): number =>
  (mercenaries ?? []).filter((merc) => merc.replaces === null).length;

/**
 * 용병을 대체·추가·빼기 할 수 있는 때: 확정 전(OPEN·RETRY), 또는 확정 후 레이드 시작 전.
 * 대체 취소는 확정 전에만 된다(canCancelReplacement).
 */
export function mercenaryEditable(state: string, confirmedStartMs: number | null, nowMs: number): boolean {
  if (state === "OPEN" || state === "RETRY") return true;
  return state === "LOCKED" && confirmedStartMs !== null && nowMs < confirmedStartMs;
}

export const canCancelReplacement = (state: string): boolean => state === "OPEN" || state === "RETRY";

/** 용병 표시 이름: "용병 2", 대체 용병이면 "용병 (비숍 대신)" */
export function mercenaryLabel(merc: MercenaryLike, replacedLabel?: string): string {
  return merc.replaces && replacedLabel ? `${merc.name} (${replacedLabel} 대신)` : merc.name;
}

/** 사용자가 넣은 용병 이름을 다듬는다. 비어 있으면 fallback */
export function cleanMercenaryName(input: unknown, fallback: string): string {
  const name = typeof input === "string" ? input.trim().replace(/\s+/g, " ").slice(0, MERCENARY_NAME_MAX) : "";
  return name || fallback;
}

/** 파티장이 추가하는 용병의 기본 이름: 쓰지 않은 가장 작은 번호 ("용병 1", "용병 2", …) */
export function nextMercenaryName(mercenaries: readonly MercenaryLike[] | null | undefined): string {
  const used = new Set((mercenaries ?? []).map((merc) => merc.name));
  let n = 1;
  while (used.has(`용병 ${n}`)) n++;
  return `용병 ${n}`;
}
