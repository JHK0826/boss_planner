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
    createdAt: Timestamp.now(),
    updatedAt: Timestamp.now(),
  };
}
