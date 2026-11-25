// 파티 목록의 "내가 할 일". Android app/.../data/PartyStatus.kt와 같은 규칙이다.
import { dateTime } from "./time";
import type { Party, Schedule, SettlementEntry, Unavailable, Vote } from "./model";
import { acceptsInput, isAutoAssigned, isReplaced, participantUids } from "./model";

/** 파티 목록에서 파티 하나의 상태를 정할 때 쓰는 일정 데이터 */
export interface PartySnapshot {
  /** 최근 일정들 (최신순). 첫 번째가 가장 최근 주기다 */
  schedules: Schedule[];
  /** 가장 최근 일정의 불가 시간 (uid → 입력). 입력을 받는 중일 때만 채운다 */
  unavailable: Record<string, Unavailable>;
  /** 가장 최근 일정의 투표 (uid → 투표). 후보가 있을 때만 채운다 */
  votes: Record<string, Vote>;
  /** 정산이 끝나지 않은 일정별 분배금 상태 (periodId → 받을 사람별 상태) */
  settlements: Record<string, SettlementEntry[]>;
}

/**
 * @param needsAction 내가 해야 할 일이면 true, 다른 사람을 기다리거나 알림용이면 false
 * @param moreActions label 말고도 해야 할 일이 몇 건 더 있는가
 * @param todos 해야 할 일 전부 (급한 순). 파티 화면의 탭 배지에 쓴다
 */
export interface PartyStatus {
  label: string;
  needsAction: boolean;
  moreActions: number;
  todos: string[];
}

/** 이번 주 레이드가 끝나 미리 연 다음 주 일정인가 (주기가 아직 시작하지 않음) */
export const isUpcoming = (schedule: Schedule | undefined, nowMs: number): boolean => !!schedule && schedule.periodStartMs > nowMs;

/** 지금 진행 중인 주기의 일정 (미리 연 다음 주 일정이 맨 앞에 있어도 이번 주 것을 찾는다) */
export const currentPeriodSchedule = (schedules: Schedule[], nowMs: number): Schedule | undefined =>
  schedules.find((s) => s.periodStartMs <= nowMs && nowMs < s.periodEndMs);

/** 정산 탭에서 하는 일. 나머지 할 일(불가 시간 입력, 투표, 일정 확정, 결과 기록, 변경 요청 처리)은 투표 탭에서 한다. */
export const SETTLEMENT_TODOS = ["정산금 수령 확인", "정산금 지급"];

/** 파티 화면 하단 탭별로 내가 할 일이 있는가 */
export function tabTodos(status: PartyStatus | null): { vote: boolean; settlement: boolean } {
  const todos = status?.todos ?? [];
  return {
    vote: todos.some((todo) => !SETTLEMENT_TODOS.includes(todo)),
    settlement: todos.some((todo) => SETTLEMENT_TODOS.includes(todo)),
  };
}

export const statusText = (status: PartyStatus): string =>
  status.moreActions > 0 ? `${status.label} 외 ${status.moreActions}건` : status.label;

/**
 * 내가 이 파티에서 지금 해야 할 일. 해야 할 일이 없으면 지금 상황을 알려 주는 문구를 준다.
 * 해야 할 일이 여러 개면 급한 것(결과 기록 → 변경 요청 처리 → 입력 → 투표 → 확정 → 정산) 하나를 보여 준다.
 *
 * @returns 일정 데이터를 아직 못 읽었으면 null
 */
export function partyStatus(uid: string, party: Party, snapshot: PartySnapshot | undefined, nowMs: number): PartyStatus | null {
  if (!snapshot) return null;
  const isLeader = party.leaderUid === uid;
  const todos: string[] = [];
  let info = "";

  // 끝난 주기의 일정은 "이번 주기"로 보지 않는다.
  const latest = snapshot.schedules[0];
  const current = latest && latest.periodEndMs > nowMs ? latest : undefined;
  // 그 주기 참여 파티원 (용병으로 대체한 사람 제외). 대체한 본인은 입력·투표·결과 기록을 하지 않는다.
  const participants = participantUids(party, current);
  const members = participants.length;
  const replaced = isReplaced(current, uid);
  if (!current) {
    info = party.scheduleStarted ? "다음 주기 대기" : "일정 시작 전";
  } else {
    switch (current.state) {
      case "OPEN":
      case "RETRY": {
        // 이번 주 레이드가 끝나 미리 연 다음 주 일정: 입력·투표는 할 일, 확정은 목요일부터
        const upcoming = isUpcoming(current, nowMs);
        const prefix = upcoming ? "다음 주 " : "";
        const submitted = participants.filter((m) => snapshot.unavailable[m]?.submitted === true).length;
        const voted = participants.filter((m) => snapshot.votes[m]?.round === current.round).length;
        if (replaced) {
          if (current.unanimous.length > 0 && isLeader && !upcoming) todos.push("일정 확정");
          else info = `${prefix}용병으로 대체`;
        } else if (snapshot.unavailable[uid]?.submitted !== true) todos.push(`${prefix}불가 시간 입력`);
        else if (current.candidates.length === 0) info = `${prefix}다른 파티원 입력 대기 (${submitted}/${members})`;
        // 투표 없이 자동 지정: 투표·확정 할 일이 없다. 미리 연 다음 주면 1위 예정 시간을 보여 준다.
        else if (isAutoAssigned(current)) info = upcoming ? `자동 지정 예정 ${dateTime(current.candidates[0].startMs)}` : "자동 지정 중";
        else if (snapshot.votes[uid]?.round !== current.round) todos.push(`${prefix}투표`);
        else if (current.unanimous.length > 0 && upcoming) info = "다음 주 전원 동의 · 목요일부터 확정 가능";
        else if (current.unanimous.length > 0 && isLeader) todos.push("일정 확정");
        else if (current.unanimous.length > 0) info = "파티장 확정 대기";
        else info = `${prefix}다른 파티원 투표 대기 (${voted}/${members})`;
        if (current.state === "RETRY" && info) info = `재조정 · ${info}`;
        break;
      }
      case "LOCKED": {
        const confirmed = current.confirmed;
        if (replaced) info = "용병으로 대체";
        else if (confirmed && nowMs >= confirmed.startMs) todos.push("결과 기록");
        else if (isLeader && current.changeRequest?.status === "PENDING") todos.push("변경 요청 처리");
        else info = confirmed ? `확정 ${dateTime(confirmed.startMs)}` : "확정";
        break;
      }
      case "VERIFYING":
        if (replaced) info = "용병으로 대체";
        else todos.push("결과 기록");
        break;
      case "SETTLED": {
        const settlement = current.settlement;
        const mine = snapshot.settlements[current.id]?.find((entry) => entry.uid === uid);
        if (!settlement) info = "클리어 · 분배금 미등록";
        else if (settlement.completed) info = "정산 완료";
        else if (mine?.status === "PENDING") info = "정산금 지급 대기";
        else info = "정산 진행 중";
        break;
      }
      case "SKIPPED":
        info = "이번 주기 미사용";
        break;
      case "EXPIRED":
        info = "이번 주기 종료";
        break;
    }
  }

  // 정산은 지난 주기 것도 함께 본다.
  for (const schedule of snapshot.schedules) {
    const entries = snapshot.settlements[schedule.id];
    if (!entries || schedule.settlement?.completed === true) continue;
    if (entries.some((e) => e.uid === uid && e.status === "PAID")) todos.push("정산금 수령 확인");
    if (schedule.settlement?.sellerUid === uid && entries.some((e) => e.status === "PENDING")) todos.push("정산금 지급");
  }

  return todos.length > 0
    ? { label: todos[0], needsAction: true, moreActions: todos.length - 1, todos }
    : { label: info, needsAction: false, moreActions: 0, todos };
}

/** 파티 목록이 일정 문서 말고 더 지켜보는 대상. 이것이 바뀔 때만 하위 구독을 다시 붙인다. */
export interface SnapshotTargets {
  inputPeriod: string | null;
  votePeriod: string | null;
  settlementPeriods: string[];
}

export function snapshotTargets(schedules: Schedule[]): SnapshotTargets {
  const current = schedules[0] && acceptsInput(schedules[0]) ? schedules[0] : undefined;
  return {
    inputPeriod: current?.id ?? null,
    votePeriod: current && current.candidates.length > 0 ? current.id : null,
    settlementPeriods: schedules.filter((s) => s.state === "SETTLED" && s.settlement && !s.settlement.completed).map((s) => s.id),
  };
}

export const sameTargets = (a: SnapshotTargets, b: SnapshotTargets): boolean =>
  a.inputPeriod === b.inputPeriod &&
  a.votePeriod === b.votePeriod &&
  a.settlementPeriods.join() === b.settlementPeriods.join();
