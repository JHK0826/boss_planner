import { describe, expect, it } from "vitest";
import { BOSS_CATALOG, bossesOf, validateBossSelection } from "../../src/domain/bosses";

describe("보스 목록", () => {
  it("시즌 보스는 없고, 월간 보스는 검은 마법사뿐이다", () => {
    expect(BOSS_CATALOG.some((boss) => boss.name.includes("시즌"))).toBe(false);
    expect(BOSS_CATALOG.filter((boss) => boss.cycle === "MONTHLY").map((boss) => boss.name)).toEqual(["검은 마법사"]);
    expect(new Set(BOSS_CATALOG.map((boss) => boss.name)).size).toBe(BOSS_CATALOG.length);
  });

  it("선택을 검사하고 주기를 정한다", () => {
    expect(
      validateBossSelection([{ name: "발드릭스", difficulty: "HARD" }, { name: "벨로나", difficulty: "EASY" }]),
    ).toEqual({
      ok: true,
      cycle: "WEEKLY",
      bosses: [{ name: "발드릭스", difficulty: "HARD" }, { name: "벨로나", difficulty: "EASY" }],
    });
    expect(validateBossSelection([{ name: "검은 마법사", difficulty: "EXTREME" }])).toMatchObject({ cycle: "MONTHLY" });
    expect(validateBossSelection("스우")).toEqual({ ok: false, reason: "empty" });
    expect(validateBossSelection([null])).toEqual({ ok: false, reason: "unknown-boss" });
    expect(validateBossSelection(Array(13).fill({ name: "스우", difficulty: "HARD" }))).toEqual({ ok: false, reason: "too-many" });
  });

  it("보스가 하나뿐이던 예전 파티 문서도 읽는다", () => {
    expect(bossesOf({ bossName: "스우", difficulty: "HARD" })).toEqual([{ name: "스우", difficulty: "HARD" }]);
    expect(bossesOf({ bosses: [{ name: "윌", difficulty: "HARD" }] })).toEqual([{ name: "윌", difficulty: "HARD" }]);
    expect(bossesOf({})).toEqual([]);
  });
});
