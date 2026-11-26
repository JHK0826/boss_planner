import { afterEach, describe, expect, it, vi } from "vitest";
import type { CharacterScheduler } from "../src/lib/model";
import { dataAt, isFresh, loadSavedScheduler, partyKeyOf, saveScheduler, SCHEDULER_TTL_MS, type SavedScheduler } from "../src/lib/schedulerCache";

// 단위 테스트는 Node에서 돌아 localStorage가 없으므로 메모리로 대신한다.
const store = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (key: string) => store.get(key) ?? null,
  setItem: (key: string, value: string) => void store.set(key, String(value)),
  removeItem: (key: string) => void store.delete(key),
  clear: () => store.clear(),
});

const kst = (iso: string) => Date.parse(`${iso}+09:00`);
const SAT = kst("2026-11-28T12:00:00");
const state = (fetchedAtMs: number | null): CharacterScheduler => ({ bosses: [], fetchedAtMs, error: null });
const saved = (over: Partial<SavedScheduler> = {}): SavedScheduler => ({
  savedAt: SAT,
  characterKey: "c1,c2",
  partyKey: "p1:2,p2:3",
  characters: { c1: state(SAT), c2: state(SAT - 10 * 60_000) },
  ...over,
});
const current = (nowMs: number, over: Partial<{ characterKey: string; partyKey: string | null }> = {}) => ({
  characterKey: "c1,c2",
  partyKey: "p1:2,p2:3",
  nowMs,
  ...over,
});

describe("게임 스케줄러 기기 저장", () => {
  afterEach(() => localStorage.clear());

  it("받은 시각은 캐릭터 중 가장 오래된 값이고, 없으면 저장한 시각이다", () => {
    expect(dataAt(saved())).toBe(SAT - 10 * 60_000);
    expect(dataAt(saved({ characters: { c1: state(null) } }))).toBe(SAT);
  });

  it("받은 지 1시간 안이면 그대로 쓰고, 지나면 다시 받는다", () => {
    const oldest = SAT - 10 * 60_000;
    expect(isFresh(saved(), current(oldest + SCHEDULER_TTL_MS - 1))).toBe(true);
    expect(isFresh(saved(), current(oldest + SCHEDULER_TTL_MS))).toBe(false);
  });

  it("주(목요일)나 달(1일)이 바뀌면 1시간 안이어도 다시 받는다", () => {
    const wed = kst("2026-11-25T23:40:00");
    expect(isFresh(saved({ characters: { c1: state(wed) } }), current(kst("2026-11-26T00:10:00")))).toBe(false);
    const nov30 = kst("2026-11-30T23:40:00"); // 월요일, 같은 주지만 달이 바뀜
    expect(isFresh(saved({ characters: { c1: state(nov30) } }), current(kst("2026-12-01T00:10:00")))).toBe(false);
  });

  it("캐릭터나 파티 구성이 다르면 다시 받는다 (파티 목록을 아직 못 받았으면 구성은 보지 않음)", () => {
    expect(isFresh(saved(), current(SAT + 60_000, { characterKey: "c1" }))).toBe(false);
    expect(isFresh(saved(), current(SAT + 60_000, { partyKey: "p1:3,p2:3" }))).toBe(false);
    expect(isFresh(saved(), current(SAT + 60_000, { partyKey: null }))).toBe(true);
  });

  it("파티 구성 서명은 파티 ID와 인원을 정렬해 잇는다", () => {
    expect(partyKeyOf([{ id: "b", memberUids: ["x", "y"] }, { id: "a", memberUids: ["x"] }])).toBe("a:1,b:2");
    expect(partyKeyOf(undefined)).toBeNull();
  });

  it("uid별로 저장하고 읽으며, 깨진 값은 무시한다", () => {
    expect(loadSavedScheduler("u1")).toBeNull();
    saveScheduler("u1", saved());
    expect(loadSavedScheduler("u1")).toEqual(saved());
    expect(loadSavedScheduler("u2")).toBeNull();
    localStorage.setItem("scheduler:u3", "{깨짐");
    expect(loadSavedScheduler("u3")).toBeNull();
  });
});
