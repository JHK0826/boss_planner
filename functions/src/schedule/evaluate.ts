import { createHash } from "node:crypto";
import { FieldPath, Timestamp, type Firestore, type QueryDocumentSnapshot } from "firebase-admin/firestore";
import { partyCrystalValue } from "../domain/autoPriority";
import { bossesOf } from "../domain/bosses";
import { activeMemberUids, type MercenaryLike } from "../domain/mercenary";
import { comfortSlots, preferredSlots, rankStarts, unanimousCandidates, usualStartSlots } from "../domain/recommend";
import { UNIT_MS, kstWeekday, slotIdFromMs, slotIdToMs, unitIdToMs } from "../domain/time";
import { completedAtOf, findHigherPriorityReadyNeighbor } from "./autoNeighbors";
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
  | "auto-confirmed"
  /** 투표 없이 자동 지정: 같은 파티원이 있는, 우선순위가 더 높은 자동 지정 파티가 먼저 확정하도록 미뤘다 */
  | "deferred";

export interface EvaluateOptions {
  /**
   * 입력이 그대로여도, 이번 라운드에 아무도 투표하지 않았으면 후보를 다시 계산한다.
   * 파티원이 겹치는 다른 파티가 확정했을 때 그 시간에 맞춰 다시 고르려고 쓴다(refresh.ts).
   * 다시 계산해도 같거나 남는 시각이 없으면 그대로 둔다("unchanged").
   */
  refreshIfUnvoted?: boolean;
  /**
   * 자동 지정 파티끼리의 우선순위를 보지 않고 확정한다. 미룬 지 오래된 일정을 정리 작업이 확정할 때 쓴다(autoWake.ts).
   */
  ignorePriority?: boolean;
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
  // 자동 지정 파티는 같은 파티원이 있는 다른 자동 지정 파티와 확정 순서를 맞춘다(domain/autoPriority.ts).
  const auto = first.auto;
  const [pending, usual, deferTo] = await Promise.all([
    loadPendingSlots(db, partyId, first.memberUids, first.memberCharacterIds, first.period, nowMs),
    loadRecentRaidStarts(db, partyId, periodId),
    auto && !options.ignorePriority
      ? findHigherPriorityReadyNeighbor(db, { partyId, ...auto }, first.memberUids, first.period.startMs, nowMs)
      : Promise.resolve(null),
  ]);
  const second = await attempt(db, partyId, periodId, nowMs, { pending, usual, deferTo }, refresh);
  return typeof second === "string" ? second : "not-open";
}

interface NeedsPending {
  memberUids: string[];
  memberCharacterIds: (string | undefined)[];
  period: { startMs: number; totalSlots: number };
  /** 지금 확정할 자동 지정 파티면 우선순위 비교에 쓸 값 (제출 완료 시각, 결정석 값) */
  auto: { completedAtMs: number; crystalValue: number } | null;
}

/** 트랜잭션 밖에서 미리 읽어 두는 참고용 값: 다른 파티의 투표 중 후보, 이 파티의 최근 레이드 시각 */
interface Context {
  pending: PendingSlots;
  usual: RaidStart[];
  /** 먼저 확정해야 하는 다른 자동 지정 파티. 있으면 이 파티는 확정을 미룬다 */
  deferTo: string | null;
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
    // 추천은 10분 칸으로 계산한다. 21:00~21:20 레이드 바로 뒤를 21:20에 잡을 수 있게 하려는 것이다.
    // totalSlots는 주기의 10분 칸 수다.
    const period = {
      startMs: (schedule.periodStart as Timestamp).toMillis(),
      totalSlots: ((schedule.periodEnd as Timestamp).toMillis() - (schedule.periodStart as Timestamp).toMillis()) / UNIT_MS,
    };
    const durationMs = ((schedule.durationMinutes as number | undefined) ?? (schedule.durationSlots as number) * 30) * 60 * 1000;
    const durationUnits = Math.ceil(durationMs / UNIT_MS);
    const round = (schedule.round as number) ?? 0;
    const candidates = (schedule.candidates as Candidate[]) ?? [];

    const unavailableSnap = await tx.get(scheduleRef.collection("unavailable"));
    const unavailable = new Map(unavailableSnap.docs.map((doc) => [doc.id, doc.data()]));

    const clear = { candidates: [], unanimous: [], offeredSlotIds: [], inputsKey: null, autoDeferredAt: null, autoDeferredFor: null };
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
    if (context === null) {
      const completedAtMs = autoAssign && confirmable ? completedAtOf(unavailable, memberUids) : null;
      const auto = completedAtMs === null ? null : { completedAtMs, crystalValue: partyCrystalValue(bossesOf(party)) };
      return { memberUids, memberCharacterIds, period, auto };
    }
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
    const inPeriod = (index: number) => Number.isInteger(index) && index >= 0 && index < period.totalSlots;
    const unitOf = (ms: number) => (ms - period.startMs) / UNIT_MS;
    // 불가 시간은 30분 칸이라 10분 칸 3개로 편다.
    const unavailableUnits = (slotIds: string[]) =>
      slotIds.flatMap((id) => {
        const ms = slotIdToMs(id);
        if (ms === null) return [];
        const first = unitOf(ms);
        return [first, first + 1, first + 2].filter(inPeriod);
      });
    // 후보 시작 칸 ID(10분 단위)
    const startUnits = (ids: string[]) =>
      ids.map((id) => unitIdToMs(id)).flatMap((ms) => (ms === null ? [] : [unitOf(ms)])).filter(inPeriod);
    // busy는 문서 ID가 아니라 남은 레이드 시간으로 칸을 구한다(0.11.2 전 확정은 30분 칸마다 문서라 ID로는 알 수 없다).
    const raidUnits = (docs: QueryDocumentSnapshot[]) => {
      const units = new Set<number>();
      for (const doc of docs) {
        let start = (doc.get("start") as Timestamp | undefined)?.toMillis();
        let end = (doc.get("end") as Timestamp | undefined)?.toMillis();
        if (start === undefined || end === undefined) {
          // 시간이 없는 문서는 ID의 칸을 막는다(정각·30분이면 30분 칸, 아니면 10분).
          const at = unitIdToMs(doc.id);
          if (at === null) continue;
          start = at;
          end = at + (slotIdToMs(doc.id) === null ? UNIT_MS : 3 * UNIT_MS);
        }
        for (let index = Math.floor(unitOf(start)); index < Math.ceil(unitOf(end)); index++) if (inPeriod(index)) units.add(index);
      }
      return [...units];
    };
    const busy = busySnaps.map((snap) => raidUnits(snap.docs));
    // busy 중 이 파티와 같은 캐릭터로 잡힌 레이드 (예전 busy에는 characterId가 없어 다른 캐릭터로 본다)
    const busySameCharacter = busySnaps.map((snap, i) =>
      raidUnits(snap.docs.filter((doc) => !!memberCharacterIds[i] && doc.get("characterId") === memberCharacterIds[i])),
    );
    const blocked = memberUids.map((uid, i) => [...unavailableUnits(slotsOf(uid)), ...busy[i]]);

    // 생활 시간대 보정과 평소 레이드 시각 (선호 시간대 안은 보정하지 않는다)
    const firstWeekday = kstWeekday(period.startMs);
    const preferred = preferredWindow ? preferredSlots(preferredWindow, period.totalSlots, firstWeekday, 10) : undefined;
    const comfort = comfortSlots(period.totalSlots, firstWeekday, preferred, 10);
    const usualStarts = usualStartSlots(usual, period.totalSlots, firstWeekday, 10);

    const recommend = (leadMinutes: number) =>
      rankStarts({
        totalSlots: period.totalSlots,
        durationSlots: durationUnits,
        slotMinutes: 10,
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
        earliestSlot: Math.ceil((nowMs + leadMinutes * 60 * 1000 - period.startMs) / UNIT_MS),
        alreadyOffered: autoAssign ? [] : startUnits(alreadyOffered),
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

    const startMsOf = (index: number) => period.startMs + index * UNIT_MS;
    const next: Candidate[] = ranked.map(({ start, score, reasons }) => ({
      slotId: slotIdFromMs(startMsOf(start)),
      start: Timestamp.fromMillis(startMsOf(start)),
      end: Timestamp.fromMillis(startMsOf(start) + durationMs),
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
      autoDeferredAt: null,
      autoDeferredFor: null,
      updatedAt: Timestamp.now(),
    };

    if (autoAssign && confirmable && context.deferTo) {
      // 우선순위가 더 높은 파티가 먼저 확정한다. 그 파티가 확정되면(또는 끝나면) 깨어나 그 시간을 피해 확정한다.
      // 미룬 시각은 처음 미뤘을 때 그대로 둔다(오래 미뤄지면 정리 작업이 확정한다).
      tx.update(scheduleRef, {
        ...update,
        autoDeferredAt: (schedule.autoDeferredAt as Timestamp | null | undefined) ?? Timestamp.fromMillis(nowMs),
        autoDeferredFor: context.deferTo,
      });
      return "deferred";
    }

    if (autoAssign && confirmable) {
      // 1위부터 차례로, 그 시간 칸에 다른 레이드가 없는 첫 후보로 이 트랜잭션에서 확정한다.
      // 위에서 busy를 같은 트랜잭션으로 읽어 뺐으므로 보통 1위가 바로 확정된다.
      for (const candidate of next) {
        if ((await readBusyConflicts(tx, db, memberUids, candidate.start.toMillis(), candidate.end.toMillis())).length > 0) continue;
        writeLock(tx, db, { party, partyId, periodId, scheduleRef, candidate, memberUids, confirmedBy: "AUTO", extra: update });
        return "auto-confirmed";
      }
    }

    tx.update(scheduleRef, update);
    if (autoAssign) return refreshing ? "refreshed" : confirmable ? "recommended" : "waiting-auto";
    return inputsChanged ? "recommended" : refreshing ? "refreshed" : "next-round";
  });
}
