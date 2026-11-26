import { Timestamp, type DocumentData, type Firestore } from "firebase-admin/firestore";
import { currentPeriod } from "../domain/time";
import { evaluateSchedule } from "./evaluate";
import { otherPartiesOf } from "./pending";

/** 이만큼 미뤄진 자동 지정 일정은 우선순위를 보지 않고 확정한다 */
export const DEFER_TIMEOUT_MS = 5 * 60_000;

/**
 * 한 파티의 일정이 조율을 끝내면(확정·미사용·종료), 같은 파티원이 있는 다른 파티 중 이 파티 때문에 확정을 미뤘던
 * 같은 때의 자동 지정 일정을 다시 평가한다. 확정됐으면 그 시간은 빠지고 바로 앞뒤가 우선된다.
 * @returns 다시 평가한 파티 ID
 */
export async function wakeDeferredNeighbors(db: Firestore, partyId: string, schedule: DocumentData, nowMs: number): Promise<string[]> {
  const party = (await db.doc(`parties/${partyId}`).get()).data();
  const memberUids = (party?.memberUids as string[] | undefined) ?? [];
  const periodStartMs = (schedule.periodStart as Timestamp | undefined)?.toMillis();
  if (memberUids.length === 0 || periodStartMs === undefined) return [];

  const others = await otherPartiesOf(db, partyId, memberUids);
  const woken: string[] = [];
  await Promise.all(
    [...others].map(async ([otherId, { cycle }]) => {
      const periodId = currentPeriod(cycle, Math.max(periodStartMs, nowMs)).id;
      const other = (await db.doc(`parties/${otherId}/schedules/${periodId}`).get()).data();
      if (!other?.autoDeferredAt || (other.state !== "OPEN" && other.state !== "RETRY")) return;
      await evaluateSchedule(db, otherId, periodId, nowMs);
      woken.push(otherId);
    }),
  );
  return woken;
}

/**
 * 30분마다: 미룬 지 5분이 넘은 자동 지정 일정을 우선순위를 보지 않고 확정한다.
 * 앞선 파티의 계산이 실패했거나, 세 파티가 서로를 앞세우는 드문 경우에도 멈추지 않게 한다.
 * @returns 확정을 다시 시도한 일정 수
 */
export async function releaseStaleDeferrals(db: Firestore, nowMs: number): Promise<number> {
  // 미룬 지 5분 넘은 일정만 조회한다(보통 0건). 일정 전부를 읽지 않도록 autoDeferredAt 컬렉션 그룹 인덱스를 쓴다.
  const stale = await db
    .collectionGroup("schedules")
    .where("autoDeferredAt", "<=", Timestamp.fromMillis(nowMs - DEFER_TIMEOUT_MS))
    .get();
  let released = 0;
  for (const doc of stale.docs) {
    const state = doc.get("state") as string | undefined;
    if (state !== "OPEN" && state !== "RETRY") continue;
    const partyId = doc.ref.parent.parent!.id;
    await evaluateSchedule(db, partyId, doc.id, nowMs, { ignorePriority: true }).catch((error) =>
      console.error("releaseStaleDeferrals failed", partyId, (error as Error).message),
    );
    released++;
  }
  return released;
}
