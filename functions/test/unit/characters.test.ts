import { describe, expect, it } from "vitest";
import { characterIdFromOcid, toPublicCharacters, toSecretCharacters } from "../../src/characters";

const list = [
  { ocid: "ocid-low", character_name: "나", world_name: "루나", character_class: "히어로", character_level: 200 },
  { ocid: "ocid-high", character_name: "가", world_name: "스카니아", character_class: "비숍", character_level: 280 },
];

describe("characters", () => {
  it("characterId는 ocid마다 고정이고 ocid를 드러내지 않는다", () => {
    const id = characterIdFromOcid("ocid-high");
    expect(id).toMatch(/^[0-9a-f]{24}$/);
    expect(id).toBe(characterIdFromOcid("ocid-high"));
    expect(id).not.toBe(characterIdFromOcid("ocid-low"));
  });

  it("앱에 내려 주는 목록에는 ocid가 없고 레벨 높은 순이다", () => {
    const publicList = toPublicCharacters(toSecretCharacters(list));
    expect(publicList.map((c) => c.name)).toEqual(["가", "나"]);
    expect(JSON.stringify(publicList)).not.toContain("ocid");
  });
});
