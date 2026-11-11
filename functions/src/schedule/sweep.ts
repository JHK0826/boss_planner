import { Timestamp, type Firestore } from "firebase-admin/firestore";
import type { Confirmed } from "./model";

/**
 * 시간이 지나서 바뀌어야 하는 일정 상태를 정리한다. 30분마다 실행한다.
 * - LOCKED인데 예정 시각이 지남 → VERIFYING (앱이 결과를 묻기 시작한다)
 * - 주기가 끝났는데 확정하지 못함: OPEN → SKIPPED, RETRY → EXPIRED
 */
export async function sweepSchedules(db: Firestore, nowMs: number): Promise<{ verifying: number; closed: number }> {
  const result = { verifying: 0, closed: 0 };
  const active = await db.collectionGroup("schedules").where("state", "in", ["LOCKED", "OPEN", "RETRY"]).get();

  for (const doc of active.docs) {
    await db.runTransaction(async (tx) => {
      const schedule = (await tx.get(doc.ref)).data();
      if (!schedule) return;
      const periodEnded = (schedule.periodEnd as Timestamp).toMillis() <= nowMs;
      if (schedule.state === "LOCKED" && (schedule.confirmed as Confirmed).end.toMillis() <= nowMs) {
        tx.update(doc.ref, { state: "VERIFYING", updatedAt: Timestamp.now() });
        result.verifying++;
      } else if (schedule.state === "OPEN" && periodEnded) {
        tx.update(doc.ref, { state: "SKIPPED", skippedReason: "PERIOD_ENDED", updatedAt: Timestamp.now() });
        result.closed++;
      } else if (schedule.state === "RETRY" && periodEnded) {
        tx.update(doc.ref, { state: "EXPIRED", expiredReason: "PERIOD_ENDED", updatedAt: Timestamp.now() });
        result.closed++;
      }
    });
  }
  return result;
}
