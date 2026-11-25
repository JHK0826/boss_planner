import { createHash } from "node:crypto";
import { FieldPath, Timestamp, type Firestore } from "firebase-admin/firestore";
import { preferredSlots, recommendStarts, unanimousCandidates } from "../domain/recommend";
import { SLOT_MS, kstWeekday, slotIdFromMs, slotIndex, slotMs } from "../domain/time";
import { DEFAULT_MIN_LEAD_MINUTES, type Candidate, type PreferredWindow } from "./model";
import { loadPendingSlots, type PendingSlots } from "./pending";

export type EvaluateResult =
  | "not-open"
  | "waiting-inputs"
  | "recommended"
  | "skipped"
  | "waiting-votes"
  | "unanimous"
  | "next-round"
  | "refreshed"
  | "unchanged";

export interface EvaluateOptions {
  /**
   * 입력이 그대로여도, 이번 라운드에 아무도 투표하지 않았으면 후보를 다시 계산한다.
   * 파티원이 겹치는 다른 파티가 확정했을 때 그 시간에 맞춰 다시 고르려고 쓴다(refresh.ts).
   * 다시 계산해도 같거나 남는 시각이 없으면 그대로 둔다("unchanged").
   */
  refreshIfUnvoted?: boolean;
}

/**
 * OPEN·RETRY 상태 일정의 입력과 투표를 보고 다음 단계로 넘긴다. 불가 시간·투표가 바뀌거나
 * 파티 구성이 바뀔 때마다 부른다. 여러 번 불러도 결과가 같다.
 *
 * - 전원이 제출하지 않았으면 후보를 비운다.
 * - 전원이 제출했고 입력(불가 시간, 파티원, 추천 설정)이 바뀌었으면 후보를 새로 계산한다.
 *   겹치는 시간이 없으면 SKIPPED.
 * - 입력이 그대로면 투표를 본다. 전원이 투표했는데 전원 동의 후보가 없으면 다음 후보로
 *   넘어가고, 더 줄 후보가 없으면 SKIPPED.
 * - refreshIfUnvoted: 아무도 투표하지 않았으면 같은 입력으로 후보를 다시 고른다(다른 파티 확정 반영).
 */
export async function evaluateSchedule(
  db: Firestore,
  partyId: string,
  periodId: string,
  nowMs: number,
  options: EvaluateOptions = {},
): Promise<EvaluateResult> {
  // 후보를 새로 계산해야 할 때만 다른 파티의 투표 중 후보를 읽는다. 처음에는 읽지 않고 시도한 뒤,
  // 계산이 필요하다고 나오면 읽어서 다시 시도한다.
  const refresh = options.refreshIfUnvoted === true;
  const first = await attempt(db, partyId, periodId, nowMs, null, refresh);
  if (typeof first === "string") return first;
  const pending = await loadPendingSlots(db, partyId, first.memberUids, first.memberCharacterIds, first.period, nowMs);
  const second = await attempt(db, partyId, periodId, nowMs, pending, refresh);
  return typeof second === "string" ? second : "not-open";
}

interface NeedsPending {
  memberUids: string[];
  memberCharacterIds: (string | undefined)[];
  period: { startMs: number; totalSlots: number };
}

function attempt(
  db: Firestore,
  partyId: string,
  periodId: string,
  nowMs: number,
  pending: PendingSlots | null,
  refresh: boolean,
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
    // 아무도 투표하지 않은 후보를 다른 파티 확정에 맞춰 다시 고르는 중
    let refreshing = false;
    if (!inputsChanged) {
      if (candidates.length === 0) return "waiting-votes";
      const votesSnap = await tx.get(scheduleRef.collection("votes"));
      const votes = new Map(votesSnap.docs.map((doc) => [doc.id, doc.data()]));
      const roundVotes = memberUids.map((uid) => {
        const vote = votes.get(uid);
        return vote?.round === round && Array.isArray(vote.agreed) ? (vote.agreed as number[]) : undefined;
      });
      if (refresh && roundVotes.every((vote) => vote === undefined)) {
        // 지금 후보는 아무도 투표하지 않았으므로 다시 나와도 된다.
        refreshing = true;
        const current = new Set(candidates.map((candidate) => candidate.slotId));
        alreadyOffered = ((schedule.offeredSlotIds as string[]) ?? []).filter((slotId) => !current.has(slotId));
      } else {
        const agreed = unanimousCandidates(candidates.length, roundVotes);
        const previous = (schedule.unanimous as number[]) ?? [];
        if (agreed === null || agreed.length > 0) {
          const next = agreed ?? [];
          if (next.join() !== previous.join()) tx.update(scheduleRef, { unanimous: next, updatedAt: Timestamp.now() });
          return agreed === null ? "waiting-votes" : "unanimous";
        }
        // 전원이 투표했지만 전원 동의 후보가 없다 → 다음 후보
        alreadyOffered = (schedule.offeredSlotIds as string[]) ?? [];
      }
    }

    // 여기부터는 후보를 새로 계산한다.
    // 이 파티에 넣은 파티원별 캐릭터. 이어 돌기에서 같은 캐릭터를 더 우선한다.
    const memberCharacterIds = memberUids.map(
      (uid) => (party.members as Record<string, { characterId?: string } | undefined> | undefined)?.[uid]?.characterId,
    );
    if (pending === null) return { memberUids, memberCharacterIds, period };

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
    // busy 중 이 파티와 같은 캐릭터로 잡힌 레이드 (예전 busy에는 characterId가 없어 다른 캐릭터로 본다)
    const busySameCharacter = busySnaps.map((snap, i) =>
      toIndexes(
        snap.docs
          .filter((doc) => !!memberCharacterIds[i] && doc.get("characterId") === memberCharacterIds[i])
          .map((doc) => doc.id),
      ),
    );
    const blocked = memberUids.map((uid, i) => [...toIndexes(slotsOf(uid)), ...busy[i]]);

    const recommend = (leadMinutes: number) =>
      recommendStarts({
        totalSlots: period.totalSlots,
        durationSlots,
        blocked,
        busy,
        busySameCharacter,
        pending: pending.all,
        pendingByMember: pending.byMember,
        pendingSameCharacter: pending.sameCharacterByMember,
        preferred: preferredWindow
          ? preferredSlots(preferredWindow, period.totalSlots, kstWeekday(period.startMs))
          : undefined,
        earliestSlot: Math.ceil((nowMs + leadMinutes * 60 * 1000 - period.startMs) / SLOT_MS),
        alreadyOffered: toIndexes(alreadyOffered),
      });
    // 최소 여유 시간을 지키면 남는 시각이 없을 때는(주기 막바지 등) 여유 시간 없이 다시 찾는다.
    let starts = recommend(minLeadMinutes);
    if (starts.length === 0 && minLeadMinutes > 0) starts = recommend(0);

    // 다시 고르는 중에는 남는 시각이 없어도 일정을 끝내지 않는다. 겹치는 후보는 확정 때 충돌 검사가 막는다.
    if (refreshing && starts.length === 0) return "unchanged";

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
    const sameAsNow =
      next.length === candidates.length &&
      next.every((c, i) => c.slotId === candidates[i].slotId && c.end.toMillis() === (candidates[i].end as Timestamp).toMillis());
    if (refreshing && sameAsNow) return "unchanged";

    tx.update(scheduleRef, {
      candidates: next,
      offeredSlotIds: [...alreadyOffered, ...next.map((c) => c.slotId)],
      unanimous: [],
      inputsKey,
      round: round + 1,
      // 알림 문구를 가르는 데 쓴다
      recommendReason: inputsChanged ? "inputs" : refreshing ? "neighbor" : "next-round",
      updatedAt: Timestamp.now(),
    });
    return inputsChanged ? "recommended" : refreshing ? "refreshed" : "next-round";
  });
}
