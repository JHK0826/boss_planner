import { HttpsError } from "firebase-functions/v2/https";
import { NexonApiError } from "./client";

/** NEXON 에러를 앱에 보여 줄 수 있는 callable 에러로 바꾼다. */
export function toHttpsError(error: unknown): HttpsError {
  if (error instanceof HttpsError) return error;
  if (error instanceof NexonApiError) {
    switch (error.kind) {
      case "invalid-key":
        return new HttpsError("invalid-argument", "유효하지 않은 API Key입니다.", { reason: "invalid-key" });
      case "rate-limited":
        return new HttpsError("resource-exhausted", "NEXON API 호출 한도를 넘었습니다. 잠시 후 다시 시도해 주세요.", {
          reason: "rate-limited",
        });
      case "maintenance":
        return new HttpsError("unavailable", "메이플스토리 또는 NEXON API가 점검 중입니다.", {
          reason: "maintenance",
        });
      case "server":
      case "network":
        return new HttpsError("unavailable", "NEXON API에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.", {
          reason: error.kind,
        });
      case "bad-request":
        return new HttpsError("failed-precondition", "NEXON API가 요청을 거절했습니다.", {
          reason: "bad-request",
          code: error.code,
        });
    }
  }
  return new HttpsError("internal", "알 수 없는 오류가 발생했습니다.");
}
