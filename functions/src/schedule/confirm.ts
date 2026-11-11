import { Timestamp, type DocumentData, type Firestore, type Transaction } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/v2/https";
import { unanimousCandidates } from "../domain/recommend";
import { slotIdsBetween } from "../domain/time";
import type { Candidate, Confirmed } from "./model";

type Data = Record<string, unknown> | undefined | null;

export function requireString(data: Data, field: string): string {
  const value = data?.[field];
  if (typeof value !== "string" || value.length < 1 || value.length > 128) {
    throw new HttpsError("invalid-argument", `${field} 값이 올바르지 않습니다.`, { field });
  }
  return value;
}

/** 확정된 시간의 busy 문서를 지운다. 변경 승인·재조정 때 쓴다. */
export function releaseBusy(tx: Transaction, db: Firestore, schedule: DocumentData): void {
  const confirmed = schedule.confirmed as Confirmed | null;
  if (!confirmed) return;
  const slotIds = slotIdsBetween(confirmed.start.toMillis(), confirmed.end.toMillis());
  for (const uid of confirmed.memberUids) {
    for (const slotId of slotIds) tx.delete(db.doc(`users/${uid}/busy/${slotId}`));
  }
}

/**
 * 파티장이 전원 동의 후보 하나를 확정한다.
 *
 * 한 트랜잭션에서 ① 일정이 아직 OPEN/RETRY인지, ② 그 후보에 전원이 동의했는지,
 * ③ 파티원 전원의 busy에 겹치는 칸이 없는지 확인한 뒤 LOCKED로 바꾸고 busy를 기록한다.
 * busy 문서 ID가 시간 칸마다 고정이라, 같은 사람이 속한 두 파티가 동시에 확정하면
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

    const memberUids = party.memberUids as string[];
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

    const slotIds = slotIdsBetween(startMs, endMs);
    const busyRefs = memberUids.flatMap((member) => slotIds.map((slotId) => db.doc(`users/${member}/busy/${slotId}`)));
    const busySnaps = await tx.getAll(...busyRefs);
    const conflictUids = [...new Set(busySnaps.filter((snap) => snap.exists).map((snap) => snap.ref.parent.parent!.id))];
    if (conflictUids.length > 0) {
      const names = conflictUids.map((member) => {
        const info = party.members?.[member];
        return info?.displayName || info?.characterName || "파티원";
      });
      throw new HttpsError(
        "failed-precondition",
        `다른 파티 일정과 겹칩니다: ${names.join(", ")}. 다른 후보를 확정하거나 다시 투표해 주세요.`,
        { reason: "conflict", conflictUids },
      );
    }

    const busy = {
      partyId,
      periodId,
      partyName: party.name,
      bossName: party.bossName,
      difficulty: party.difficulty,
      start: candidate.start,
      end: candidate.end,
    };
    for (const ref of busyRefs) tx.create(ref, busy);
    const confirmed: Confirmed = { slotId: candidate.slotId, start: candidate.start, end: candidate.end, memberUids };
    tx.update(scheduleRef, {
      state: "LOCKED",
      confirmed,
      confirmedAt: Timestamp.now(),
      changeRequest: null,
      unanimous: agreed,
      updatedAt: Timestamp.now(),
    });
    return { slotId: candidate.slotId };
  });
}
