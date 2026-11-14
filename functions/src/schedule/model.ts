import { Timestamp, type DocumentData } from "firebase-admin/firestore";
import type { Period } from "../domain/time";

export type ScheduleState = "OPEN" | "LOCKED" | "VERIFYING" | "SETTLED" | "RETRY" | "EXPIRED" | "SKIPPED";

export interface Candidate {
  /** 시작 칸 ID (KST "YYYYMMDD-HHmm") */
  slotId: string;
  start: Timestamp;
  end: Timestamp;
}

/** 새 주기의 일정 문서 초깃값 */
export function newScheduleData(period: Period, durationMinutes: number): DocumentData {
  return {
    state: "OPEN" satisfies ScheduleState,
    cycle: period.cycle,
    periodStart: Timestamp.fromMillis(period.startMs),
    periodEnd: Timestamp.fromMillis(period.endMs),
    inputDeadline: Timestamp.fromMillis(period.inputDeadlineMs),
    // 실제 소요 시간(분). 20분 단위로 잡을 수 있다.
    durationMinutes,
    // 시간표는 30분 칸이라, 추천과 충돌 검사는 소요 시간을 덮는 칸 수로 한다 (40분 → 2칸).
    durationSlots: slotsForMinutes(durationMinutes),
    // 후보가 바뀔 때마다 1씩 오른다. 투표는 같은 round일 때만 유효하다.
    round: 0,
    candidates: [],
    offeredSlotIds: [],
    unanimous: [],
    inputsKey: null,
    skippedReason: null,
    // 확정된 레이드 시간: { slotId, start, end, memberUids }
    confirmed: null,
    confirmedAt: null,
    // 일정 변경 요청: { requestedBy, reason, requestedAt, status: PENDING | APPROVED | REJECTED }
    changeRequest: null,
    // 분배금: { sellerUid, saleAmount, feePercent, netAmount, sellerAmount, weights, amounts, registeredAt, completed, completedAt }
    settlement: null,
    retryCount: 0,
    clearedBy: null,
    expiredReason: null,
    createdAt: Timestamp.now(),
    updatedAt: Timestamp.now(),
  };
}

/** 파티 선호 시간대: 요일(1=월 ~ 7=일)과 하루 안의 30분 칸 범위 [startRow, endRow) */
export interface PreferredWindow {
  days: number[];
  startRow: number;
  endRow: number;
}

/** 최소 여유 시간의 기본값(분). 지금으로부터 이 시간 안에 시작하는 후보는 추천하지 않는다. */
export const DEFAULT_MIN_LEAD_MINUTES = 180;

/** 소요 시간을 덮는 데 필요한 30분 칸 수 */
export function slotsForMinutes(durationMinutes: number): number {
  return Math.ceil(durationMinutes / 30);
}

/** 파티 문서의 소요 시간(분). 예전 형식(durationSlots만 있음)도 받는다. */
export function durationMinutesOf(party: DocumentData): number {
  return typeof party.durationMinutes === "number" ? party.durationMinutes : (party.durationSlots as number) * 30;
}

export interface Confirmed {
  slotId: string;
  start: Timestamp;
  end: Timestamp;
  /** 확정 당시 파티원. busy를 풀 때 쓴다. */
  memberUids: string[];
}

/** 추천·투표·확정을 처음부터 다시 하게 만드는 필드 값 */
export function resetFields(round: number): DocumentData {
  return {
    candidates: [],
    unanimous: [],
    offeredSlotIds: [],
    inputsKey: null,
    round: round + 1,
    confirmed: null,
    confirmedAt: null,
    updatedAt: Timestamp.now(),
  };
}
