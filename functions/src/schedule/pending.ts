import type { Firestore, Timestamp } from "firebase-admin/firestore";
import { SLOT_MS, currentPeriod, type Cycle } from "../domain/time";
import type { Candidate } from "./model";

/** 파티원이 속한 다른 파티. memberIndexes는 넘겨준 memberUids에서 그 파티에도 있는 파티원의 위치다. */
export async function otherPartiesOf(
  db: Firestore,
  partyId: string,
  memberUids: string[],
): Promise<Map<string, { cycle: Cycle; memberIndexes: number[] }>> {
  const others = new Map<string, { cycle: Cycle; memberIndexes: number[] }>();
  const memberships = await Promise.all(
    memberUids.map((uid) => db.collection("parties").where("memberUids", "array-contains", uid).get()),
  );
  memberships.forEach((snapshot, memberIndex) => {
    for (const party of snapshot.docs) {
      if (party.id === partyId) continue;
      const entry = others.get(party.id) ?? { cycle: party.get("cycle") as Cycle, memberIndexes: [] };
      entry.memberIndexes.push(memberIndex);
      others.set(party.id, entry);
    }
  });
  return others;
}

export interface PendingSlots {
  /** 다른 파티들이 투표 중인 후보가 차지한 칸 전부 (겹침 감점용) */
  all: number[];
  /** 파티원별: 그 파티원이 속한 다른 파티의 투표 중 후보 칸 (앞뒤 가산점용). memberUids와 같은 순서 */
  byMember: number[][];
}

/**
 * 파티원이 겹치는 다른 파티가 지금 투표 중인 후보가 차지한 칸 번호를 모은다.
 *
 * - 두 파티가 같은 시간을 추천받으면 나중에 확정하는 쪽이 충돌로 거절당해 다시 투표해야 한다.
 *   그래서 추천할 때 이 칸들을 뒤로 미룬다. 확정된 시간과 달리 아예 빼지는 않는다.
 * - 반대로 그 후보 바로 앞뒤는 조금 우선한다. 어느 후보로 확정되든 이어서 돌 수 있는 시각이 남게 하려는 것이다.
 *
 * 참고용 값이라 트랜잭션 밖에서 읽는다(조금 오래된 값이어도 괜찮다).
 */
export async function loadPendingSlots(
  db: Firestore,
  partyId: string,
  memberUids: string[],
  period: { startMs: number; totalSlots: number },
  nowMs: number,
): Promise<PendingSlots> {
  const others = await otherPartiesOf(db, partyId, memberUids);
  const all = new Set<number>();
  const byMember = memberUids.map(() => new Set<number>());
  await Promise.all(
    [...others].map(async ([otherId, { cycle, memberIndexes }]) => {
      // 추천하는 주기와 같은 때의 일정을 본다(미리 연 다음 주 일정이면 다른 파티의 다음 주 일정).
      const schedule = await db.doc(`parties/${otherId}/schedules/${currentPeriod(cycle, Math.max(period.startMs, nowMs)).id}`).get();
      const state = schedule.get("state") as string | undefined;
      if (state !== "OPEN" && state !== "RETRY") return;
      for (const candidate of (schedule.get("candidates") as Candidate[] | undefined) ?? []) {
        const first = Math.floor(((candidate.start as Timestamp).toMillis() - period.startMs) / SLOT_MS);
        const last = Math.floor(((candidate.end as Timestamp).toMillis() - 1 - period.startMs) / SLOT_MS);
        for (let index = Math.max(first, 0); index <= last && index < period.totalSlots; index++) {
          all.add(index);
          for (const memberIndex of memberIndexes) byMember[memberIndex].add(index);
        }
      }
    }),
  );
  return { all: [...all], byMember: byMember.map((slots) => [...slots]) };
}
