import { Timestamp, type Firestore } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/v2/https";
import { changeRequestDeadline, slotIdsBetween } from "../domain/time";
import { busyData, conflictError, readBusyConflicts, requireString } from "./confirm";
import type { Candidate, Confirmed } from "./model";

type Data = Record<string, unknown> | undefined | null;

/**
 * 투표 없이 자동으로 정한 일정을 파티장이 다른 순위 후보로 바꾼다.
 *
 * - 원래 시간과 바꿀 시간 모두 변경 요청 마감(레이드 시작 4시간 전) 전이어야 한다.
 * - 참여 파티원이 그 시간에 다른 파티 레이드가 있으면 거절한다. 원래 시간과 겹치는 칸은 이 일정 것이라 괜찮다.
 * - 원래 시간에만 있던 busy는 지우고, 새 시간의 busy를 만든다(겹치는 칸은 덮어쓴다). 투표는 다시 하지 않는다.
 */
export async function switchAssignedCandidate(db: Firestore, uid: string, data: Data, nowMs: number): Promise<{ slotId: string }> {
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
      throw new HttpsError("permission-denied", "파티장만 일정을 바꿀 수 있습니다.", { reason: "not-leader" });
    }
    const confirmed = schedule.confirmed as Confirmed | null | undefined;
    if (schedule.state !== "LOCKED" || schedule.assignMode !== "AUTO" || !confirmed) {
      throw new HttpsError("failed-precondition", "투표 없이 자동으로 정한 확정 일정만 다른 순위로 바꿀 수 있습니다.", {
        reason: "not-auto",
      });
    }
    if (nowMs >= changeRequestDeadline(confirmed.start.toMillis())) {
      throw new HttpsError("failed-precondition", "레이드 시작 4시간 전까지만 바꿀 수 있습니다.", { reason: "deadline-passed" });
    }
    const candidate = ((schedule.candidates as Candidate[] | undefined) ?? [])[candidateIndex];
    if (!candidate) throw new HttpsError("invalid-argument", "없는 후보입니다.", { field: "candidateIndex" });
    if (candidate.slotId === confirmed.slotId) {
      throw new HttpsError("failed-precondition", "이미 이 시간으로 정해져 있습니다.", { reason: "same" });
    }
    if (nowMs >= changeRequestDeadline(candidate.start.toMillis())) {
      throw new HttpsError("failed-precondition", "4시간 안에 시작하는 시간으로는 바꿀 수 없습니다.", { reason: "too-soon" });
    }

    const members = confirmed.memberUids;
    const oldSlots = slotIdsBetween(confirmed.start.toMillis(), confirmed.end.toMillis());
    const newSlots = slotIdsBetween(candidate.start.toMillis(), candidate.end.toMillis());
    const conflictUids = await readBusyConflicts(tx, db, members, newSlots, { partyId, periodId });
    if (conflictUids.length > 0) throw conflictError(party, conflictUids, "다른 순위를 고르거나 일정 변경 요청을 써 주세요.");

    const keep = new Set(newSlots);
    for (const member of members) {
      for (const slotId of oldSlots) {
        if (!keep.has(slotId)) tx.delete(db.doc(`users/${member}/busy/${slotId}`));
      }
      for (const slotId of newSlots) {
        tx.set(db.doc(`users/${member}/busy/${slotId}`), busyData(party, partyId, periodId, candidate, member));
      }
    }
    const next: Confirmed = { slotId: candidate.slotId, start: candidate.start, end: candidate.end, memberUids: members };
    tx.update(scheduleRef, {
      confirmed: next,
      confirmedAt: Timestamp.now(),
      confirmedBy: "LEADER",
      updatedAt: Timestamp.now(),
    });
    return { slotId: candidate.slotId };
  });
}
