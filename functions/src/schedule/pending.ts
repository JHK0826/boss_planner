import type { Firestore, Timestamp } from "firebase-admin/firestore";
import { SLOT_MS, currentPeriod, type Cycle } from "../domain/time";
import type { Candidate } from "./model";

/**
 * 파티원이 겹치는 다른 파티가 지금 투표 중인 후보가 차지한 칸 번호를 모은다.
 *
 * 두 파티가 같은 시간을 추천받으면 나중에 확정하는 쪽이 충돌로 거절당해 다시 투표해야 한다.
 * 그래서 추천할 때 이 칸들을 뒤로 미룬다. 확정된 시간과 달리 아예 빼지는 않는다.
 * 참고용 값이라 트랜잭션 밖에서 읽는다(조금 오래된 값이어도 괜찮다).
 */
export async function loadPendingSlots(
  db: Firestore,
  partyId: string,
  memberUids: string[],
  period: { startMs: number; totalSlots: number },
  nowMs: number,
): Promise<number[]> {
  const others = new Map<string, Cycle>();
  const memberships = await Promise.all(
    memberUids.map((uid) => db.collection("parties").where("memberUids", "array-contains", uid).get()),
  );
  for (const snapshot of memberships) {
    for (const party of snapshot.docs) {
      if (party.id !== partyId) others.set(party.id, party.get("cycle") as Cycle);
    }
  }

  const slots = new Set<number>();
  await Promise.all(
    [...others].map(async ([otherId, cycle]) => {
      const schedule = await db.doc(`parties/${otherId}/schedules/${currentPeriod(cycle, nowMs).id}`).get();
      const state = schedule.get("state") as string | undefined;
      if (state !== "OPEN" && state !== "RETRY") return;
      for (const candidate of (schedule.get("candidates") as Candidate[] | undefined) ?? []) {
        const first = Math.floor(((candidate.start as Timestamp).toMillis() - period.startMs) / SLOT_MS);
        const last = Math.floor(((candidate.end as Timestamp).toMillis() - 1 - period.startMs) / SLOT_MS);
        for (let index = Math.max(first, 0); index <= last && index < period.totalSlots; index++) slots.add(index);
      }
    }),
  );
  return [...slots];
}
