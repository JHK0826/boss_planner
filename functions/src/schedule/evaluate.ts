import { createHash } from "node:crypto";
import { FieldPath, Timestamp, type Firestore } from "firebase-admin/firestore";
import { preferredSlots, recommendStarts, unanimousCandidates } from "../domain/recommend";
import { SLOT_MS, kstWeekday, slotIdFromMs, slotIndex, slotMs } from "../domain/time";
import { DEFAULT_MIN_LEAD_MINUTES, type Candidate, type PreferredWindow } from "./model";
import { loadPendingSlots } from "./pending";

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
 * - 전원이 제출했고 입력(불가 시간, 파티원, 추천 설정)이 바뀌었으면 후보를 새로 계산한다.
 *   겹치는 시간이 없으면 SKIPPED.
 * - 입력이 그대로면 투표를 본다. 전원이 투표했는데 전원 동의 후보가 없으면 다음 후보로
 *   넘어가고, 더 줄 후보가 없으면 SKIPPED.
 */
export async function evaluateSchedule(
  db: Firestore,
  partyId: string,
  periodId: string,
  nowMs: number,
): Promise<EvaluateResult> {
  // 후보를 새로 계산해야 할 때만 다른 파티의 투표 중 후보를 읽는다. 처음에는 읽지 않고 시도한 뒤,
  // 계산이 필요하다고 나오면 읽어서 다시 시도한다.
  const first = await attempt(db, partyId, periodId, nowMs, null);
  if (typeof first === "string") return first;
  const pending = await loadPendingSlots(db, partyId, first.memberUids, first.period, nowMs);
  const second = await attempt(db, partyId, periodId, nowMs, pending);
  return typeof second === "string" ? second : "not-open";
}

interface NeedsPending {
  memberUids: string[];
  period: { startMs: number; totalSlots: number };
}

function attempt(
  db: Firestore,
  partyId: string,
  periodId: string,
  nowMs: number,
  pending: number[] | null,
): Promise<EvaluateResult | NeedsPending> {
  const partyRef = db.doc(`parties/${partyId}`);
  const scheduleRef = partyRef.collection("schedules").doc(periodId);

  return db.runTransaction(async (tx): Promise<EvaluateResult | NeedsPending> => {
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
    // 추천 설정(선호 시간대, 최소 여유 시간)이 바뀌어도 후보를 다시 계산해야 하므로 함께 넣는다.
    // 설정을 따로 정하지 않은 파티는 예전과 같은 키가 나오게 한다.
    const preferredWindow = (party.preferredWindow as PreferredWindow | null | undefined) ?? null;
    const minLeadMinutes = (party.minLeadMinutes as number | undefined) ?? DEFAULT_MIN_LEAD_MINUTES;
    const memberInputs = memberUids.map((uid) => [uid, slotsOf(uid)]);
    const hasSettings = preferredWindow !== null || party.minLeadMinutes !== undefined;
    const inputsKey = createHash("sha256")
      .update(JSON.stringify(hasSettings ? [memberInputs, { preferredWindow, minLeadMinutes }] : memberInputs))
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

    // 여기부터는 후보를 새로 계산한다.
    if (pending === null) return { memberUids, period };

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
    const busy = busySnaps.map((snap) => toIndexes(snap.docs.map((doc) => doc.id)));
    const blocked = memberUids.map((uid, i) => [...toIndexes(slotsOf(uid)), ...busy[i]]);

    const recommend = (leadMinutes: number) =>
      recommendStarts({
        totalSlots: period.totalSlots,
        durationSlots,
        blocked,
        busy,
        pending,
        preferred: preferredWindow
          ? preferredSlots(preferredWindow, period.totalSlots, kstWeekday(period.startMs))
          : undefined,
        earliestSlot: Math.ceil((nowMs + leadMinutes * 60 * 1000 - period.startMs) / SLOT_MS),
        alreadyOffered: toIndexes(alreadyOffered),
      });
    // 최소 여유 시간을 지키면 남는 시각이 없을 때는(주기 막바지 등) 여유 시간 없이 다시 찾는다.
    let starts = recommend(minLeadMinutes);
    if (starts.length === 0 && minLeadMinutes > 0) starts = recommend(0);

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
