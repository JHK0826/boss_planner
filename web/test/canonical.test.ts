import { describe, expect, it } from "vitest";
import { canonicalTarget } from "../src/lib/canonical";

const NEW = "https://bossplanner.web.app";

describe("대표 주소로 옮기기", () => {
  it("예전 Firebase Hosting 주소는 같은 경로의 새 주소로", () => {
    expect(canonicalTarget("https://boss-planner-21e72.web.app/parties/p1/vote?x=1#top", NEW)).toBe(
      "https://bossplanner.web.app/parties/p1/vote?x=1#top",
    );
    expect(canonicalTarget("https://boss-planner-21e72.firebaseapp.com/", NEW)).toBe("https://bossplanner.web.app/");
  });

  it("이미 새 주소이거나, 개발 서버·설정 없음이면 옮기지 않는다", () => {
    expect(canonicalTarget("https://bossplanner.web.app/parties", NEW)).toBeNull();
    expect(canonicalTarget("http://127.0.0.1:5173/parties", NEW)).toBeNull();
    expect(canonicalTarget("https://boss-planner-21e72.web.app/", "")).toBeNull();
    expect(canonicalTarget("https://boss-planner-21e72.web.app/", "주소 아님")).toBeNull();
  });
});
