// 파티 목록의 "내가 할 일". Android app/.../data/PartyStatus.kt와 같은 규칙이다.
import { dateTime } from "./time";
import type { Party, Schedule, SettlementEntry, Unavailable, Vote } from "./model";
import { acceptsInput } from "./model";

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
 */
export interface PartyStatus {
  label: string;
  needsAction: boolean;
  moreActions: number;
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
  const members = party.memberUids.length;
  const todos: string[] = [];
  let info = "";

  // 끝난 주기의 일정은 "이번 주기"로 보지 않는다.
  const latest = snapshot.schedules[0];
  const current = latest && latest.periodEndMs > nowMs ? latest : undefined;
  if (!current) {
    info = party.scheduleStarted ? "다음 주기 대기" : "일정 시작 전";
  } else {
    switch (current.state) {
      case "OPEN":
      case "RETRY": {
        const submitted = party.memberUids.filter((m) => snapshot.unavailable[m]?.submitted === true).length;
        const voted = party.memberUids.filter((m) => snapshot.votes[m]?.round === current.round).length;
        if (snapshot.unavailable[uid]?.submitted !== true) todos.push("불가 시간 입력");
        else if (current.candidates.length === 0) info = `다른 파티원 입력 대기 (${submitted}/${members})`;
        else if (snapshot.votes[uid]?.round !== current.round) todos.push("투표");
        else if (current.unanimous.length > 0 && isLeader) todos.push("일정 확정");
        else if (current.unanimous.length > 0) info = "파티장 확정 대기";
        else info = `다른 파티원 투표 대기 (${voted}/${members})`;
        if (current.state === "RETRY" && info) info = `재조정 · ${info}`;
        break;
      }
      case "LOCKED": {
        const confirmed = current.confirmed;
        if (confirmed && nowMs >= confirmed.startMs) todos.push("결과 기록");
        else if (isLeader && current.changeRequest?.status === "PENDING") todos.push("변경 요청 처리");
        else info = confirmed ? `확정 ${dateTime(confirmed.startMs)}` : "확정";
        break;
      }
      case "VERIFYING":
        todos.push("결과 기록");
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
    ? { label: todos[0], needsAction: true, moreActions: todos.length - 1 }
    : { label: info, needsAction: false, moreActions: 0 };
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
