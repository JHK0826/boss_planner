import { describe, expect, it } from "vitest";
import { GUIDE, guideBlocks } from "../src/lib/guide";

describe("사용 가이드", () => {
  it("기본 사용 흐름, 기능별 설명, 자주 묻는 질문 세 묶음이다", () => {
    expect(GUIDE.map((s) => s.title)).toEqual(["기본 사용 흐름", "기능별 설명", "자주 묻는 질문"]);
  });

  it("섹션·항목 id가 겹치지 않고, 제목과 본문이 비어 있지 않다", () => {
    const ids = GUIDE.flatMap((s) => [s.id, ...s.items.map((i) => `${s.id}/${i.id}`)]);
    expect(new Set(ids).size).toBe(ids.length);
    const itemIds = GUIDE.flatMap((s) => s.items.map((i) => i.id));
    expect(new Set(itemIds).size).toBe(itemIds.length);
    for (const section of GUIDE) {
      expect(section.items.length).toBeGreaterThan(0);
      for (const item of section.items) {
        expect(item.title.trim()).not.toBe("");
        expect(item.body.length).toBeGreaterThan(0);
        // 첫 줄은 요약 문단이고, 빈 줄이나 "-"만 있는 줄은 없다
        expect(item.body[0].startsWith("- ")).toBe(false);
        for (const line of item.body) expect(line.replace(/^- /, "").trim()).not.toBe("");
      }
    }
  });

  it("본문은 문단과, 이어진 점 항목 묶음으로 나뉜다", () => {
    expect(guideBlocks(["요약", "- 하나", "- 둘", "다음 문단", "- 셋"])).toEqual([
      { kind: "paragraph", text: "요약" },
      { kind: "list", items: ["하나", "둘"] },
      { kind: "paragraph", text: "다음 문단" },
      { kind: "list", items: ["셋"] },
    ]);
  });
});
