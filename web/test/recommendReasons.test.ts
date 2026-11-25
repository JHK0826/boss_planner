import { describe, expect, it } from "vitest";
import { reasonText } from "../src/lib/recommendReasons";

describe("추천 이유 문구", () => {
  it("코드를 문구로 바꿔 잇고, 모르는 코드는 뺀다", () => {
    expect(reasonText(["PREFERRED", "USUAL_TIME"])).toBe("선호 시간대 · 평소 레이드 시간");
    expect(reasonText(["ADJACENT_SAME_CHARACTER", "LATE_NIGHT", "NEW_CODE"])).toBe("같은 캐릭터 레이드와 이어서 · 새벽");
    expect(reasonText([])).toBe("");
  });
});
