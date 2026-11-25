import { BOSS_CATALOG } from "@shared/domain/bosses";
import { describe, expect, it } from "vitest";
import { BOSS_IMAGE_SLUGS, bossImage } from "../src/lib/bossImages";

describe("보스 이미지", () => {
  it("파티로 갈 수 있는 보스마다 이미지 이름이 있고, 이미지가 없는 보스는 매그너스뿐이다", () => {
    for (const boss of BOSS_CATALOG) expect(BOSS_IMAGE_SLUGS[boss.name], boss.name).toBeTruthy();
    const missing = BOSS_CATALOG.filter((boss) => !bossImage(boss.name)).map((boss) => boss.name);
    expect(missing).toEqual(["매그너스"]);
  });

  it("이름의 띄어쓰기는 보지 않는다", () => {
    expect(bossImage("가디언엔젤슬라임")).toBe(bossImage("가디언 엔젤 슬라임"));
    expect(bossImage("스우")).toMatch(/lotus/);
    expect(bossImage("없는 보스")).toBeUndefined();
  });
});
