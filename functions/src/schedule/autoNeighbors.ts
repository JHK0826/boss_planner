import type { DocumentData, Firestore, Timestamp } from "firebase-admin/firestore";
import { compareAutoPriority, partyCrystalValue, type AutoPriority } from "../domain/autoPriority";
import { bossesOf } from "../domain/bosses";
import { activeMemberUids, type MercenaryLike } from "../domain/mercenary";
import { currentPeriod } from "../domain/time";
import { otherPartiesOf } from "./pending";

/**
 * 제출 완료 시각: 참여 파티원 전원이 냈으면 그중 마지막 제출의 서버 시각(updatedAt), 아니면 null.
 * 누가 고쳐서 다시 내면 시각이 늦어져 순서가 다시 매겨진다.
 */
export function completedAtOf(unavailable: Map<string, DocumentData>, participants: string[]): number | null {
  let latest = 0;
  for (const uid of participants) {
    const entry = unavailable.get(uid);
    if (entry?.submitted !== true) return null;
    latest = Math.max(latest, (entry.updatedAt as Timestamp | undefined)?.toMillis() ?? 0);
  }
  return latest;
}

/**
 * 같은 파티원이 있는 다른 자동 지정 파티 중, 지금 확정할 준비가 됐고 이 파티보다 우선순위가 높은 파티.
 * 있으면 그 파티 ID(가장 앞서는 파티), 없으면 null. 참고용 값이라 트랜잭션 밖에서 읽는다.
 *
 * 준비됨: 자동 지정 파티이고, 같은 때의 일정이 조율 중(OPEN·RETRY)이며 주기가 시작했고, 참여 파티원 전원이 냈다.
 */
export async function findHigherPriorityReadyNeighbor(
  db: Firestore,
  self: AutoPriority,
  memberUids: string[],
  periodStartMs: number,
  nowMs: number,
): Promise<string | null> {
  const others = await otherPartiesOf(db, self.partyId, memberUids);
  const ahead: AutoPriority[] = [];
  await Promise.all(
    [...others].map(async ([otherId, { cycle }]) => {
      const party = (await db.doc(`parties/${otherId}`).get()).data();
      if (party?.autoAssign !== true) return;
      const scheduleRef = db.doc(`parties/${otherId}/schedules/${currentPeriod(cycle, Math.max(periodStartMs, nowMs)).id}`);
      const schedule = (await scheduleRef.get()).data();
      if (!schedule || (schedule.state !== "OPEN" && schedule.state !== "RETRY")) return;
      if ((schedule.periodStart as Timestamp).toMillis() > nowMs) return;
      const participants = activeMemberUids(party.memberUids as string[], schedule.mercenaries as MercenaryLike[] | undefined);
      const unavailable = await scheduleRef.collection("unavailable").get();
      const completedAtMs = completedAtOf(new Map(unavailable.docs.map((doc) => [doc.id, doc.data()])), participants);
      if (completedAtMs === null) return;
      const other: AutoPriority = { partyId: otherId, completedAtMs, crystalValue: partyCrystalValue(bossesOf(party)) };
      if (compareAutoPriority(other, self) < 0) ahead.push(other);
    }),
  );
  ahead.sort(compareAutoPriority);
  return ahead[0]?.partyId ?? null;
}
