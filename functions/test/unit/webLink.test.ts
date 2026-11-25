import { describe, expect, it } from "vitest";
import { webAppUrl, webPartyLink } from "../../src/notify/send";

describe("웹앱 알림 링크", () => {
  it("설정한 웹앱 주소(WEB_APP_URL)를 먼저 쓴다", () => {
    expect(webAppUrl({ WEB_APP_URL: "https://bossplanner.web.app/", GCLOUD_PROJECT: "boss-planner-21e72" })).toBe("https://bossplanner.web.app");
  });

  it("설정이 없으면 Hosting 기본 도메인", () => {
    expect(webAppUrl({ GCLOUD_PROJECT: "boss-planner-21e72" })).toBe("https://boss-planner-21e72.web.app");
    expect(webAppUrl({})).toBeUndefined();
  });

  it("그 파티 화면을 가리키고, 주소를 모르면 링크를 붙이지 않는다", () => {
    expect(webPartyLink("abc123", "https://bossplanner.web.app")).toBe("https://bossplanner.web.app/parties/abc123");
    expect(webPartyLink("abc123", undefined)).toBeUndefined();
  });
});
