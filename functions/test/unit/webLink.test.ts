import { describe, expect, it } from "vitest";
import { webPartyLink } from "../../src/notify/send";

describe("웹앱 알림 링크", () => {
  it("Hosting 기본 도메인의 파티 화면을 가리킨다", () => {
    expect(webPartyLink("abc123", "boss-planner-21e72")).toBe("https://boss-planner-21e72.web.app/parties/abc123");
  });

  it("프로젝트 ID를 모르면 링크를 붙이지 않는다", () => {
    expect(webPartyLink("abc123", "")).toBeUndefined();
  });
});
