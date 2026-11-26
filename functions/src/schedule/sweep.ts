import { Timestamp, type DocumentData, type Firestore } from "firebase-admin/firestore";
import type { Confirmed } from "./model";

/**
 * 시간이 지나서 바뀌어야 하는 일정 상태를 정리한다. 30분마다 실행한다.
 * - LOCKED인데 예정 시각이 지남 → VERIFYING (앱이 결과를 묻기 시작한다)
 * - 주기가 끝났는데 확정하지 못함: OPEN → SKIPPED, RETRY → EXPIRED
 */
export async function sweepSchedules(db: Firestore, nowMs: number): Promise<{ verifying: number; closed: number }> {
  const result = { verifying: 0, closed: 0 };
  const active = await db.collectionGroup("schedules").where("state", "in", ["LOCKED", "OPEN", "RETRY"]).get();

  // 조회한 값으로 먼저 거르고, 바꿔야 하는 일정만 트랜잭션으로 다시 읽어 확인한다 (30분마다 도는 작업이라 읽기를 줄인다).
  for (const doc of active.docs.filter((d) => change(d.data(), nowMs) !== null)) {
    await db.runTransaction(async (tx) => {
      const schedule = (await tx.get(doc.ref)).data();
      const next = schedule ? change(schedule, nowMs) : null;
      if (!next) return;
      tx.update(doc.ref, { ...next, updatedAt: Timestamp.now() });
      if (next.state === "VERIFYING") result.verifying++;
      else result.closed++;
    });
  }
  return result;
}

/** 지금 시각에 이 일정이 넘어가야 할 상태. 그대로면 null */
function change(schedule: DocumentData, nowMs: number): DocumentData | null {
  const periodEnded = (schedule.periodEnd as Timestamp).toMillis() <= nowMs;
  if (schedule.state === "LOCKED" && (schedule.confirmed as Confirmed).end.toMillis() <= nowMs) return { state: "VERIFYING" };
  if (schedule.state === "OPEN" && periodEnded) return { state: "SKIPPED", skippedReason: "PERIOD_ENDED" };
  if (schedule.state === "RETRY" && periodEnded) return { state: "EXPIRED", expiredReason: "PERIOD_ENDED" };
  return null;
}
