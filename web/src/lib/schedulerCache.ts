// 내 캐릭터 탭의 게임 스케줄러를 이 기기에 저장해 두고, 앱을 다시 열면 바로 보여 준다 (Android data/SchedulerCache.kt와 같은 규칙).
// 저장한 값이 아직 새것이면 서버를 부르지 않는다. 서버도 같은 시간(1시간) 동안 NEXON을 다시 부르지 않는다.
import { currentPeriod } from "@shared/domain/time";
import type { CharacterScheduler } from "./model";

/** 이 시간 안에 받은 값이면 서버를 다시 부르지 않는다 (서버의 SCHEDULER_CACHE_MS와 같음) */
export const SCHEDULER_TTL_MS = 60 * 60 * 1000;

export interface SavedScheduler {
  savedAt: number;
  /** 골라 둔 캐릭터 ID를 이은 값 */
  characterKey: string;
  /** 파티 구성(파티 ID·인원). 인원수(H/3)가 바뀌었는지 본다. 파티 목록을 아직 못 받았으면 null */
  partyKey: string | null;
  characters: Record<string, CharacterScheduler>;
}

/** 파티 구성 서명: 파티 ID와 파티원 수 */
export const partyKeyOf = (parties: { id: string; memberUids: string[] }[] | undefined): string | null =>
  parties
    ? parties
        .map((p) => `${p.id}:${p.memberUids.length}`)
        .sort()
        .join(",")
    : null;

/** 저장한 값이 받아 온 시각 (캐릭터 중 가장 오래된 값). 받은 시각이 없으면 저장한 시각 */
export function dataAt(saved: SavedScheduler): number {
  const times = Object.values(saved.characters).flatMap((c) => (c.fetchedAtMs ? [c.fetchedAtMs] : []));
  return times.length > 0 ? Math.min(...times) : saved.savedAt;
}

/**
 * 저장한 값을 그대로 써도 되는가: 같은 캐릭터·같은 파티 구성이고, 받은 지 1시간 안이며,
 * 그 사이 주(목요일)나 달(1일)이 바뀌지 않았다(클리어가 초기화됨).
 */
export function isFresh(saved: SavedScheduler, current: { characterKey: string; partyKey: string | null; nowMs: number }): boolean {
  if (saved.characterKey !== current.characterKey) return false;
  if (saved.partyKey !== null && current.partyKey !== null && saved.partyKey !== current.partyKey) return false;
  const at = dataAt(saved);
  if (current.nowMs - at >= SCHEDULER_TTL_MS) return false;
  return (
    currentPeriod("WEEKLY", at).id === currentPeriod("WEEKLY", current.nowMs).id &&
    currentPeriod("MONTHLY", at).id === currentPeriod("MONTHLY", current.nowMs).id
  );
}

const storageKey = (uid: string) => `scheduler:${uid}`;

/** 저장한 값. 없거나 읽을 수 없으면(사생활 보호 모드 등) null */
export function loadSavedScheduler(uid: string): SavedScheduler | null {
  try {
    const raw = localStorage.getItem(storageKey(uid));
    if (!raw) return null;
    const value = JSON.parse(raw) as SavedScheduler;
    return typeof value?.savedAt === "number" && typeof value.characterKey === "string" && value.characters && typeof value.characters === "object"
      ? value
      : null;
  } catch {
    return null;
  }
}

export function saveScheduler(uid: string, saved: SavedScheduler): void {
  try {
    localStorage.setItem(storageKey(uid), JSON.stringify(saved));
  } catch {
    // 저장하지 못해도 다음에 서버에서 받으면 된다.
  }
}
