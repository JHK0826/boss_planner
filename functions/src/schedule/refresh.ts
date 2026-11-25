import type { DocumentData, Firestore, Timestamp } from "firebase-admin/firestore";
import { currentPeriod } from "../domain/time";
import { evaluateSchedule } from "./evaluate";
import { otherPartiesOf } from "./pending";

/**
 * 한 파티가 일정을 확정한 뒤, 파티원이 겹치는 다른 파티의 같은 때 일정을 다시 추천한다.
 *
 * 투표 중인 다른 파티의 후보는 확정 전 시간 기준으로 골라서, 확정된 레이드 바로 앞뒤(이어서 돌기)가
 * 반영되지 않았고 확정 시간과 겹치는 후보가 남아 있을 수 있다. 그래서 그 파티에서 이번 라운드에
 * **아직 아무도 투표하지 않았으면** 후보를 다시 고른다. 이미 누가 투표했으면 그대로 둔다.
 *
 * @returns 후보를 다시 고른 파티 ID 목록
 */
export async function refreshNeighborSchedules(
  db: Firestore,
  partyId: string,
  schedule: DocumentData,
  nowMs: number,
): Promise<string[]> {
  const confirmed = schedule.confirmed as { start: Timestamp; memberUids: string[] } | undefined;
  if (!confirmed) return [];
  const startMs = confirmed.start.toMillis();
  const others = await otherPartiesOf(db, partyId, confirmed.memberUids);

  const refreshed: string[] = [];
  await Promise.all(
    [...others].map(async ([otherId, { cycle }]) => {
      // 확정 시각이 들어가는 그 파티의 일정 (미리 연 다음 주, 월간 일정 포함)
      const periodId = currentPeriod(cycle, startMs).id;
      const other = await db.doc(`parties/${otherId}/schedules/${periodId}`).get();
      const state = other.get("state") as string | undefined;
      if (state !== "OPEN" && state !== "RETRY") return;
      if (((other.get("candidates") as unknown[] | undefined) ?? []).length === 0) return;
      const result = await evaluateSchedule(db, otherId, periodId, nowMs, { refreshIfUnvoted: true });
      if (result === "refreshed") refreshed.push(otherId);
    }),
  );
  return refreshed;
}
