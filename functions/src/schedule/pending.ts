import type { DocumentData, Firestore, Timestamp } from "firebase-admin/firestore";
import { replacedUids, type MercenaryLike } from "../domain/mercenary";
import { UNIT_MS, currentPeriod, type Cycle } from "../domain/time";
import type { Candidate } from "./model";

export interface OtherParty {
  cycle: Cycle;
  /** 넘겨준 memberUids에서 그 파티에도 있는 파티원의 위치 */
  memberIndexes: number[];
  /** 그 파티의 members (파티원별 캐릭터 등) */
  members: Record<string, DocumentData | undefined>;
}

/** 파티원이 속한 다른 파티 */
export async function otherPartiesOf(db: Firestore, partyId: string, memberUids: string[]): Promise<Map<string, OtherParty>> {
  const others = new Map<string, OtherParty>();
  const memberships = await Promise.all(
    memberUids.map((uid) => db.collection("parties").where("memberUids", "array-contains", uid).get()),
  );
  memberships.forEach((snapshot, memberIndex) => {
    for (const party of snapshot.docs) {
      if (party.id === partyId) continue;
      const entry = others.get(party.id) ?? {
        cycle: party.get("cycle") as Cycle,
        memberIndexes: [],
        members: (party.get("members") as OtherParty["members"] | undefined) ?? {},
      };
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
  /** 파티원별: 그중 그 파티원이 이 파티와 같은 캐릭터로 들어간 파티의 칸 (더 큰 가산점) */
  sameCharacterByMember: number[][];
}

/**
 * 파티원이 겹치는 다른 파티가 지금 투표 중인 후보가 차지한 칸 번호를 모은다.
 *
 * - 두 파티가 같은 시간을 추천받으면 나중에 확정하는 쪽이 충돌로 거절당해 다시 투표해야 한다.
 *   그래서 추천할 때 이 칸들을 뒤로 미룬다. 확정된 시간과 달리 아예 빼지는 않는다.
 * - 반대로 그 후보 바로 앞뒤는 조금 우선한다. 어느 후보로 확정되든 이어서 돌 수 있는 시각이 남게 하려는 것이다.
 *   그 파티에 같은 캐릭터로 들어가 있으면 캐릭터를 바꾸지 않고 이어 돌 수 있어 더 우선한다.
 *
 * 참고용 값이라 트랜잭션 밖에서 읽는다(조금 오래된 값이어도 괜찮다).
 */
export async function loadPendingSlots(
  db: Firestore,
  partyId: string,
  memberUids: string[],
  /** 이 파티에서 각 파티원의 캐릭터 (memberUids와 같은 순서) */
  memberCharacterIds: (string | undefined)[],
  /** totalSlots는 10분 칸 수 */
  period: { startMs: number; totalSlots: number },
  nowMs: number,
): Promise<PendingSlots> {
  const others = await otherPartiesOf(db, partyId, memberUids);
  const all = new Set<number>();
  const byMember = memberUids.map(() => new Set<number>());
  const sameCharacterByMember = memberUids.map(() => new Set<number>());
  await Promise.all(
    [...others].map(async ([otherId, { cycle, memberIndexes, members }]) => {
      // 추천하는 주기와 같은 때의 일정을 본다(미리 연 다음 주 일정이면 다른 파티의 다음 주 일정).
      const schedule = await db.doc(`parties/${otherId}/schedules/${currentPeriod(cycle, Math.max(period.startMs, nowMs)).id}`).get();
      const state = schedule.get("state") as string | undefined;
      if (state !== "OPEN" && state !== "RETRY") return;
      // 그 파티에서 이번 주기를 용병으로 대체한 파티원은 그 파티 레이드에 가지 않으므로 상관없다.
      const replaced = replacedUids(schedule.get("mercenaries") as MercenaryLike[] | undefined);
      const involved = memberIndexes.filter((i) => !replaced.has(memberUids[i]));
      if (involved.length === 0) return;
      const sameCharacter = involved.filter((i) => {
        const mine = memberCharacterIds[i];
        return !!mine && members[memberUids[i]]?.characterId === mine;
      });
      for (const candidate of (schedule.get("candidates") as Candidate[] | undefined) ?? []) {
        // 10분 칸 번호 (evaluate의 추천 칸과 같은 단위)
        const first = Math.floor(((candidate.start as Timestamp).toMillis() - period.startMs) / UNIT_MS);
        const last = Math.floor(((candidate.end as Timestamp).toMillis() - 1 - period.startMs) / UNIT_MS);
        for (let index = Math.max(first, 0); index <= last && index < period.totalSlots; index++) {
          all.add(index);
          for (const memberIndex of involved) byMember[memberIndex].add(index);
          for (const memberIndex of sameCharacter) sameCharacterByMember[memberIndex].add(index);
        }
      }
    }),
  );
  return {
    all: [...all],
    byMember: byMember.map((slots) => [...slots]),
    sameCharacterByMember: sameCharacterByMember.map((slots) => [...slots]),
  };
}
