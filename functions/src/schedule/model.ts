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
export function newScheduleData(period: Period, durationSlots: number): DocumentData {
  return {
    state: "OPEN" satisfies ScheduleState,
    cycle: period.cycle,
    periodStart: Timestamp.fromMillis(period.startMs),
    periodEnd: Timestamp.fromMillis(period.endMs),
    inputDeadline: Timestamp.fromMillis(period.inputDeadlineMs),
    durationSlots,
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
    retryCount: 0,
    clearedBy: null,
    expiredReason: null,
    createdAt: Timestamp.now(),
    updatedAt: Timestamp.now(),
  };
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
