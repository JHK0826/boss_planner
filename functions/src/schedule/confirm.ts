import { Timestamp, type DocumentData, type DocumentReference, type Firestore, type Transaction } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/v2/https";
import { bossesOf } from "../domain/bosses";
import { activeMemberUids, type MercenaryLike } from "../domain/mercenary";
import { unanimousCandidates } from "../domain/recommend";
import { slotIdsBetween, unitIdsBetween } from "../domain/time";
import type { Candidate, Confirmed } from "./model";

type Data = Record<string, unknown> | undefined | null;

export function requireString(data: Data, field: string): string {
  const value = data?.[field];
  if (typeof value !== "string" || value.length < 1 || value.length > 128) {
    throw new HttpsError("invalid-argument", `${field} 값이 올바르지 않습니다.`, { field });
  }
  return value;
}

/** 확정 시간의 busy 문서 ID. 0.11.2부터는 10분마다, 이전 확정은 30분 칸마다 문서가 있다. */
export function busyIdsOf(confirmed: Pick<Confirmed, "start" | "end" | "busyUnitMinutes">): string[] {
  const startMs = confirmed.start.toMillis();
  const endMs = confirmed.end.toMillis();
  return confirmed.busyUnitMinutes === 10 ? unitIdsBetween(startMs, endMs) : slotIdsBetween(startMs, endMs);
}

/** 확정된 시간의 busy 문서를 지운다. 변경 승인·재조정 때 쓴다. */
export function releaseBusy(tx: Transaction, db: Firestore, schedule: DocumentData): void {
  const confirmed = schedule.confirmed as Confirmed | null;
  if (!confirmed) return;
  const ids = busyIdsOf(confirmed);
  for (const uid of confirmed.memberUids) {
    for (const id of ids) tx.delete(db.doc(`users/${uid}/busy/${id}`));
  }
}

/**
 * [startMs, endMs)에 이미 다른 레이드(busy)가 있는 파티원. 트랜잭션 안에서 읽으므로, 같은 사람이 속한 두 파티가
 * 동시에 확정하면 나중 트랜잭션이 다시 실행되어 충돌로 걸린다.
 *
 * 10분 ID와, 그 구간이 걸친 30분 칸 ID(0.11.2 전 확정의 busy)를 함께 읽고, 문서에 남은 레이드 시간이
 * 실제로 겹칠 때만 충돌로 본다. 21:00~21:20 레이드 바로 뒤 21:20 시작은 겹치지 않는다.
 * @param own 이 파티·주기의 busy는 충돌로 보지 않는다(교체할 때 원래 시간과 겹치는 칸)
 */
export async function readBusyConflicts(
  tx: Transaction,
  db: Firestore,
  memberUids: string[],
  startMs: number,
  endMs: number,
  own?: { partyId: string; periodId: string },
): Promise<string[]> {
  const ids = [...new Set([...unitIdsBetween(startMs, endMs), ...slotIdsBetween(startMs, endMs)])];
  const refs = memberUids.flatMap((member) => ids.map((id) => db.doc(`users/${member}/busy/${id}`)));
  if (refs.length === 0) return [];
  const snaps = await tx.getAll(...refs);
  const others = snaps.filter((snap) => {
    if (!snap.exists || (own && snap.get("partyId") === own.partyId && snap.get("periodId") === own.periodId)) return false;
    const start = (snap.get("start") as Timestamp | undefined)?.toMillis();
    const end = (snap.get("end") as Timestamp | undefined)?.toMillis();
    // 시간이 없는 문서는 안전하게 충돌로 본다.
    return start === undefined || end === undefined || (start < endMs && startMs < end);
  });
  return [...new Set(others.map((snap) => snap.ref.parent.parent!.id))];
}

/** 충돌한 파티원 이름을 넣은 오류 */
export function conflictError(party: DocumentData, conflictUids: string[], hint: string): HttpsError {
  const names = conflictUids.map((member) => {
    const info = party.members?.[member];
    return info?.displayName || info?.characterName || "파티원";
  });
  return new HttpsError("failed-precondition", `다른 파티 일정과 겹칩니다: ${names.join(", ")}. ${hint}`, {
    reason: "conflict",
    conflictUids,
  });
}

/** busy 문서 내용. 이어 돌기 추천에서 같은 캐릭터인지 보려고, 그 파티에 넣은 캐릭터를 함께 남긴다. */
export function busyData(party: DocumentData, partyId: string, periodId: string, candidate: Candidate, member: string): DocumentData {
  return {
    partyId,
    periodId,
    partyName: party.name,
    bosses: bossesOf(party),
    start: candidate.start,
    end: candidate.end,
    characterId: (party.members?.[member]?.characterId as string | undefined) ?? null,
  };
}

/**
 * 후보로 확정한다: 참여 파티원의 busy를 만들고 일정을 LOCKED로 바꾼다.
 * 충돌 검사(readBusyConflicts)는 이 함수를 부르기 전에, 같은 트랜잭션에서 한다.
 */
export function writeLock(
  tx: Transaction,
  db: Firestore,
  args: {
    party: DocumentData;
    partyId: string;
    periodId: string;
    scheduleRef: DocumentReference;
    candidate: Candidate;
    memberUids: string[];
    /** 파티장이 확정(LEADER)했는지, 투표 없이 자동으로 정했는지(AUTO) */
    confirmedBy: "LEADER" | "AUTO";
    /** 일정 문서에 함께 쓸 값 */
    extra?: DocumentData;
  },
): void {
  const { party, partyId, periodId, candidate, memberUids } = args;
  const confirmed: Confirmed = { slotId: candidate.slotId, start: candidate.start, end: candidate.end, memberUids, busyUnitMinutes: 10 };
  for (const member of memberUids) {
    for (const id of busyIdsOf(confirmed)) {
      tx.create(db.doc(`users/${member}/busy/${id}`), busyData(party, partyId, periodId, candidate, member));
    }
  }
  tx.update(args.scheduleRef, {
    state: "LOCKED",
    confirmed,
    confirmedAt: Timestamp.now(),
    confirmedBy: args.confirmedBy,
    changeRequest: null,
    updatedAt: Timestamp.now(),
    ...args.extra,
  });
}

/**
 * 파티장이 전원 동의 후보 하나를 확정한다.
 *
 * 한 트랜잭션에서 ① 일정이 아직 OPEN/RETRY인지, ② 그 후보에 전원이 동의했는지,
 * ③ 파티원 전원의 busy에 겹치는 칸이 없는지 확인한 뒤 LOCKED로 바꾸고 busy를 기록한다.
 * busy 문서 ID가 10분마다 고정이라, 같은 사람이 속한 두 파티가 동시에 확정하면
 * 나중 트랜잭션이 다시 실행되어 충돌로 거절된다.
 */
export async function confirmSchedule(
  db: Firestore,
  uid: string,
  data: Data,
  nowMs: number,
): Promise<{ slotId: string }> {
  const partyId = requireString(data, "partyId");
  const periodId = requireString(data, "periodId");
  const candidateIndex = data?.candidateIndex;
  if (typeof candidateIndex !== "number" || !Number.isInteger(candidateIndex) || candidateIndex < 0) {
    throw new HttpsError("invalid-argument", "candidateIndex 값이 올바르지 않습니다.", { field: "candidateIndex" });
  }

  const partyRef = db.doc(`parties/${partyId}`);
  const scheduleRef = partyRef.collection("schedules").doc(periodId);

  return db.runTransaction(async (tx) => {
    const [partySnap, scheduleSnap] = await Promise.all([tx.get(partyRef), tx.get(scheduleRef)]);
    const party = partySnap.data();
    const schedule = scheduleSnap.data();
    if (!party || !schedule || party.leaderUid !== uid) {
      throw new HttpsError("permission-denied", "파티장만 일정을 확정할 수 있습니다.", { reason: "not-leader" });
    }
    if (schedule.state !== "OPEN" && schedule.state !== "RETRY") {
      throw new HttpsError("failed-precondition", "이미 확정되었거나 종료된 일정입니다.", { reason: "not-open" });
    }
    // 미리 연 다음 주 일정은 입력과 투표만 미리 하고, 확정은 주기가 시작한 뒤에 한다(목요일 가입·탈퇴를 막지 않도록).
    if ((schedule.periodStart as Timestamp).toMillis() > nowMs) {
      throw new HttpsError("failed-precondition", "다음 주 일정은 목요일 00:00부터 확정할 수 있습니다.", {
        reason: "not-started",
      });
    }

    // 이번 주기 참여 파티원 (용병으로 대체한 사람은 투표·일정에서 빠진다)
    const memberUids = activeMemberUids(party.memberUids as string[], schedule.mercenaries as MercenaryLike[] | undefined);
    const candidates = (schedule.candidates as Candidate[]) ?? [];
    const candidate = candidates[candidateIndex];

    // 트리거가 unanimous를 갱신하기 전일 수 있으므로 투표를 직접 다시 센다.
    const votesSnap = await tx.get(scheduleRef.collection("votes"));
    const votes = new Map(votesSnap.docs.map((doc) => [doc.id, doc.data()]));
    const agreed = unanimousCandidates(
      candidates.length,
      memberUids.map((member) => {
        const vote = votes.get(member);
        return vote !== undefined && vote.round === schedule.round && Array.isArray(vote.agreed)
          ? (vote.agreed as number[])
          : undefined;
      }),
    );
    if (!candidate || !agreed?.includes(candidateIndex)) {
      throw new HttpsError("failed-precondition", "전원이 동의한 후보만 확정할 수 있습니다.", {
        reason: "not-unanimous",
      });
    }
    const startMs = candidate.start.toMillis();
    const endMs = candidate.end.toMillis();
    if (startMs <= nowMs) {
      throw new HttpsError("failed-precondition", "이미 지난 시간은 확정할 수 없습니다.", { reason: "past" });
    }

    const conflictUids = await readBusyConflicts(tx, db, memberUids, startMs, endMs);
    if (conflictUids.length > 0) throw conflictError(party, conflictUids, "다른 후보를 확정하거나 다시 투표해 주세요.");

    writeLock(tx, db, {
      party,
      partyId,
      periodId,
      scheduleRef,
      candidate,
      memberUids,
      confirmedBy: "LEADER",
      extra: { unanimous: agreed },
    });
    return { slotId: candidate.slotId };
  });
}
