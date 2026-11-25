import { createHash } from "node:crypto";
import { FieldPath, Timestamp, type Firestore } from "firebase-admin/firestore";
import { activeMemberUids, type MercenaryLike } from "../domain/mercenary";
import { comfortSlots, preferredSlots, rankStarts, unanimousCandidates, usualStartSlots } from "../domain/recommend";
import { SLOT_MS, kstWeekday, slotIdFromMs, slotIdsBetween, slotIndex, slotMs } from "../domain/time";
import { readBusyConflicts, writeLock } from "./confirm";
import { loadRecentRaidStarts, type RaidStart } from "./history";
import { DEFAULT_MIN_LEAD_MINUTES, type AssignMode, type Candidate, type PreferredWindow } from "./model";
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
  | "unchanged"
  /** 투표 없이 자동 지정: 주기 시작 전이라 1위를 보여 주며 기다린다 */
  | "waiting-auto"
  /** 투표 없이 자동 지정: 1위로 확정했다 */
  | "auto-confirmed";

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
 *
 * 투표 없이 자동 지정하는 파티(party.autoAssign)는 투표를 보지 않는다.
 * - 주기가 시작했으면 전원이 내는 즉시, 지금 시각·busy로 다시 계산해 점수 1위로 같은 트랜잭션에서 확정한다.
 * - 주기 시작 전(미리 연 다음 주)이면 순위 후보만 저장해 두고, 목요일 전환(open.ts)에서 확정한다.
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
  const [pending, usual] = await Promise.all([
    loadPendingSlots(db, partyId, first.memberUids, first.memberCharacterIds, first.period, nowMs),
    loadRecentRaidStarts(db, partyId, periodId),
  ]);
  const second = await attempt(db, partyId, periodId, nowMs, { pending, usual }, refresh);
  return typeof second === "string" ? second : "not-open";
}

interface NeedsPending {
  memberUids: string[];
  memberCharacterIds: (string | undefined)[];
  period: { startMs: number; totalSlots: number };
}

/** 트랜잭션 밖에서 미리 읽어 두는 참고용 값: 다른 파티의 투표 중 후보, 이 파티의 최근 레이드 시각 */
interface Context {
  pending: PendingSlots;
  usual: RaidStart[];
}

function attempt(
  db: Firestore,
  partyId: string,
  periodId: string,
  nowMs: number,
  context: Context | null,
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

    // 이번 주기에 용병으로 대체한 파티원은 입력·투표·추천에서 뺀다(용병은 시간 제약이 없다).
    const memberUids = activeMemberUids(party.memberUids as string[], schedule.mercenaries as MercenaryLike[] | undefined).sort();
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
    // 추천 설정(선호 시간대, 최소 여유 시간, 자동 지정)이 바뀌어도 후보를 다시 계산해야 하므로 함께 넣는다.
    // 설정을 따로 정하지 않은 파티는 예전과 같은 키가 나오게 한다. 자동 지정은 켠 파티만 키에 넣는다.
    const preferredWindow = (party.preferredWindow as PreferredWindow | null | undefined) ?? null;
    const minLeadMinutes = (party.minLeadMinutes as number | undefined) ?? DEFAULT_MIN_LEAD_MINUTES;
    const autoAssign = party.autoAssign === true;
    const assignMode: AssignMode = autoAssign ? "AUTO" : "VOTE";
    // 주기가 시작했으면 확정할 수 있다. 미리 연 다음 주는 목요일 00:00부터다(confirm.ts와 같은 규칙).
    const confirmable = period.startMs <= nowMs;
    const memberInputs = memberUids.map((uid) => [uid, slotsOf(uid)]);
    const settings = autoAssign ? { preferredWindow, minLeadMinutes, autoAssign } : { preferredWindow, minLeadMinutes };
    const hasSettings = preferredWindow !== null || party.minLeadMinutes !== undefined || autoAssign;
    const inputsKey = createHash("sha256")
      .update(JSON.stringify(hasSettings ? [memberInputs, settings] : memberInputs))
      .digest("hex");
    const inputsChanged = schedule.inputsKey !== inputsKey;

    let alreadyOffered: string[] = [];
    // 아무도 투표하지 않은 후보를 다른 파티 확정에 맞춰 다시 고르는 중
    let refreshing = false;
    if (autoAssign) {
      // 투표는 보지 않는다. 주기가 시작했으면 언제든 지금 기준으로 다시 계산해 바로 확정한다.
      // 주기 시작 전이면 입력이 바뀌었거나 다른 파티가 확정했을 때만 예정 후보를 다시 고른다.
      if (!confirmable && !inputsChanged) {
        if (!refresh) return "waiting-auto";
        refreshing = true;
      }
    } else if (!inputsChanged) {
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
    if (context === null) return { memberUids, memberCharacterIds, period };
    const { pending, usual } = context;

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

    // 생활 시간대 보정과 평소 레이드 시각 (선호 시간대 안은 보정하지 않는다)
    const firstWeekday = kstWeekday(period.startMs);
    const preferred = preferredWindow ? preferredSlots(preferredWindow, period.totalSlots, firstWeekday) : undefined;
    const comfort = comfortSlots(period.totalSlots, firstWeekday, preferred);
    const usualStarts = usualStartSlots(usual, period.totalSlots, firstWeekday);

    const recommend = (leadMinutes: number) =>
      rankStarts({
        totalSlots: period.totalSlots,
        durationSlots,
        blocked,
        busy,
        busySameCharacter,
        pending: pending.all,
        pendingByMember: pending.byMember,
        pendingSameCharacter: pending.sameCharacterByMember,
        preferred,
        comfort,
        usualStarts,
        // 자동 지정은 요일과 상관없이 점수순, 투표는 요일을 섞는다.
        mode: autoAssign ? "ranked" : "spread",
        earliestSlot: Math.ceil((nowMs + leadMinutes * 60 * 1000 - period.startMs) / SLOT_MS),
        alreadyOffered: autoAssign ? [] : toIndexes(alreadyOffered),
      });
    // 최소 여유 시간을 지키면 남는 시각이 없을 때는(주기 막바지 등) 여유 시간 없이 다시 찾는다.
    let ranked = recommend(minLeadMinutes);
    if (ranked.length === 0 && minLeadMinutes > 0) ranked = recommend(0);

    // 다시 고르는 중에는 남는 시각이 없어도 일정을 끝내지 않는다. 겹치는 후보는 확정 때 충돌 검사가 막는다.
    if (refreshing && ranked.length === 0) return "unchanged";

    if (ranked.length === 0) {
      // 처음 조율이면 그 주 미사용(SKIPPED), 재조정 중이면 더 잡을 시간이 없으므로 EXPIRED
      const reason = autoAssign || inputsChanged ? "NO_COMMON_TIME" : "NO_AGREEMENT";
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

    const next: Candidate[] = ranked.map(({ start, score, reasons }) => ({
      slotId: slotIdFromMs(slotMs(period, start)),
      start: Timestamp.fromMillis(slotMs(period, start)),
      end: Timestamp.fromMillis(slotMs(period, start) + durationMs),
      score,
      reasons,
    }));
    const sameAsNow =
      next.length === candidates.length &&
      next.every((c, i) => c.slotId === candidates[i].slotId && c.end.toMillis() === (candidates[i].end as Timestamp).toMillis());
    if (refreshing && sameAsNow) return "unchanged";

    const update = {
      candidates: next,
      offeredSlotIds: autoAssign ? next.map((c) => c.slotId) : [...alreadyOffered, ...next.map((c) => c.slotId)],
      unanimous: [],
      inputsKey,
      round: round + 1,
      // 화면이 투표 화면을 보여 줄지, 자동 지정 순위를 보여 줄지 가른다
      assignMode,
      // 알림 문구를 가르는 데 쓴다
      recommendReason: inputsChanged ? "inputs" : refreshing ? "neighbor" : "next-round",
      updatedAt: Timestamp.now(),
    };

    if (autoAssign && confirmable) {
      // 1위부터 차례로, 그 시간 칸에 다른 레이드가 없는 첫 후보로 이 트랜잭션에서 확정한다.
      // 위에서 busy를 같은 트랜잭션으로 읽어 뺐으므로 보통 1위가 바로 확정된다.
      for (const candidate of next) {
        const slotIds = slotIdsBetween(candidate.start.toMillis(), candidate.end.toMillis());
        if ((await readBusyConflicts(tx, db, memberUids, slotIds)).length > 0) continue;
        writeLock(tx, db, { party, partyId, periodId, scheduleRef, candidate, memberUids, confirmedBy: "AUTO", extra: update });
        return "auto-confirmed";
      }
    }

    tx.update(scheduleRef, update);
    if (autoAssign) return refreshing ? "refreshed" : confirmable ? "recommended" : "waiting-auto";
    return inputsChanged ? "recommended" : refreshing ? "refreshed" : "next-round";
  });
}
