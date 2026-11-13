import { createHash } from "node:crypto";
import { FieldPath, Timestamp, type Firestore } from "firebase-admin/firestore";
import { recommendStarts, unanimousCandidates } from "../domain/recommend";
import { SLOT_MS, slotIdFromMs, slotIndex, slotMs } from "../domain/time";
import type { Candidate } from "./model";

export type EvaluateResult =
  | "not-open"
  | "waiting-inputs"
  | "recommended"
  | "skipped"
  | "waiting-votes"
  | "unanimous"
  | "next-round";

/**
 * OPEN·RETRY 상태 일정의 입력과 투표를 보고 다음 단계로 넘긴다. 불가 시간·투표가 바뀌거나
 * 파티 구성이 바뀔 때마다 부른다. 여러 번 불러도 결과가 같다.
 *
 * - 전원이 제출하지 않았으면 후보를 비운다.
 * - 전원이 제출했고 입력이 바뀌었으면 후보를 새로 계산한다. 겹치는 시간이 없으면 SKIPPED.
 * - 입력이 그대로면 투표를 본다. 전원이 투표했는데 전원 동의 후보가 없으면 다음 후보 3개로
 *   넘어가고, 더 줄 후보가 없으면 SKIPPED.
 */
export async function evaluateSchedule(
  db: Firestore,
  partyId: string,
  periodId: string,
  nowMs: number,
): Promise<EvaluateResult> {
  const partyRef = db.doc(`parties/${partyId}`);
  const scheduleRef = partyRef.collection("schedules").doc(periodId);

  return db.runTransaction(async (tx): Promise<EvaluateResult> => {
    const [partySnap, scheduleSnap] = await Promise.all([tx.get(partyRef), tx.get(scheduleRef)]);
    const schedule = scheduleSnap.data();
    const party = partySnap.data();
    // RETRY(미클리어 후 재조정)도 OPEN과 같은 절차를 밟는다.
    if (!party || !schedule || (schedule.state !== "OPEN" && schedule.state !== "RETRY")) return "not-open";

    const memberUids = [...(party.memberUids as string[])].sort();
    const period = {
      startMs: (schedule.periodStart as Timestamp).toMillis(),
      totalSlots: ((schedule.periodEnd as Timestamp).toMillis() - (schedule.periodStart as Timestamp).toMillis()) / SLOT_MS,
    };
    const durationSlots = schedule.durationSlots as number;
    const durationMs = ((schedule.durationMinutes as number | undefined) ?? durationSlots * 30) * 60 * 1000;
    const round = (schedule.round as number) ?? 0;
    const candidates = (schedule.candidates as Candidate[]) ?? [];

    const unavailableSnap = await tx.get(scheduleRef.collection("unavailable"));
    const unavailable = new Map(unavailableSnap.docs.map((doc) => [doc.id, doc.data()]));

    const clear = { candidates: [], unanimous: [], offeredSlotIds: [], inputsKey: null };
    if (!memberUids.every((uid) => unavailable.get(uid)?.submitted === true)) {
      if (candidates.length > 0 || schedule.inputsKey !== null) {
        tx.update(scheduleRef, { ...clear, round: round + 1, updatedAt: Timestamp.now() });
      }
      return "waiting-inputs";
    }

    const slotsOf = (uid: string): string[] =>
      ((unavailable.get(uid)?.slots as unknown[]) ?? []).filter((s): s is string => typeof s === "string").sort();
    const inputsKey = createHash("sha256")
      .update(JSON.stringify(memberUids.map((uid) => [uid, slotsOf(uid)])))
      .digest("hex");
    const inputsChanged = schedule.inputsKey !== inputsKey;

    let alreadyOffered: string[] = [];
    if (!inputsChanged) {
      if (candidates.length === 0) return "waiting-votes";
      const votesSnap = await tx.get(scheduleRef.collection("votes"));
      const votes = new Map(votesSnap.docs.map((doc) => [doc.id, doc.data()]));
      const agreed = unanimousCandidates(
        candidates.length,
        memberUids.map((uid) => {
          const vote = votes.get(uid);
          return vote?.round === round && Array.isArray(vote.agreed) ? (vote.agreed as number[]) : undefined;
        }),
      );
      const previous = (schedule.unanimous as number[]) ?? [];
      if (agreed === null || agreed.length > 0) {
        const next = agreed ?? [];
        if (next.join() !== previous.join()) tx.update(scheduleRef, { unanimous: next, updatedAt: Timestamp.now() });
        return agreed === null ? "waiting-votes" : "unanimous";
      }
      // 전원이 투표했지만 전원 동의 후보가 없다 → 다음 후보
      alreadyOffered = (schedule.offeredSlotIds as string[]) ?? [];
    }

    // 다른 파티에서 확정된 시간(busy)은 불가 시간과 같은 판정으로 뺀다.
    const periodEndMs = (schedule.periodEnd as Timestamp).toMillis();
    const busySnaps = await Promise.all(
      memberUids.map((uid) =>
        tx.get(
          db
            .collection(`users/${uid}/busy`)
            .where(FieldPath.documentId(), ">=", slotIdFromMs(period.startMs))
            .where(FieldPath.documentId(), "<", slotIdFromMs(periodEndMs)),
        ),
      ),
    );
    const toIndexes = (slotIds: string[]) =>
      slotIds.map((id) => slotIndex(period, id)).filter((index): index is number => index !== null);
    const blocked = memberUids.map((uid, i) => [
      ...toIndexes(slotsOf(uid)),
      ...toIndexes(busySnaps[i].docs.map((doc) => doc.id)),
    ]);

    const starts = recommendStarts({
      totalSlots: period.totalSlots,
      durationSlots,
      blocked,
      earliestSlot: Math.ceil((nowMs - period.startMs) / SLOT_MS),
      alreadyOffered: toIndexes(alreadyOffered),
    });

    if (starts.length === 0) {
      // 처음 조율이면 그 주 미사용(SKIPPED), 재조정 중이면 더 잡을 시간이 없으므로 EXPIRED
      const reason = inputsChanged ? "NO_COMMON_TIME" : "NO_AGREEMENT";
      tx.update(scheduleRef, {
        ...clear,
        inputsKey,
        ...(schedule.state === "RETRY"
          ? { state: "EXPIRED", expiredReason: reason }
          : { state: "SKIPPED", skippedReason: reason }),
        round: round + 1,
        updatedAt: Timestamp.now(),
      });
      return "skipped";
    }

    const next: Candidate[] = starts.map((index) => ({
      slotId: slotIdFromMs(slotMs(period, index)),
      start: Timestamp.fromMillis(slotMs(period, index)),
      end: Timestamp.fromMillis(slotMs(period, index) + durationMs),
    }));
    tx.update(scheduleRef, {
      candidates: next,
      offeredSlotIds: [...alreadyOffered, ...next.map((c) => c.slotId)],
      unanimous: [],
      inputsKey,
      round: round + 1,
      updatedAt: Timestamp.now(),
    });
    return inputsChanged ? "recommended" : "next-round";
  });
}
