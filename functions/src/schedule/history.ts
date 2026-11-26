import type { Firestore, Timestamp } from "firebase-admin/firestore";
import { kstWeekday, startOfKstDay } from "../domain/time";

/** 평소 시간 학습에 쓰는 최근 레이드 수 */
export const USUAL_RAID_COUNT = 8;

/** 지난 레이드의 시작: KST 요일(1=월 ~ 7=일)과 하루 안의 분(21:20 → 1280) */
export interface RaidStart {
  weekday: number;
  minute: number;
}

/**
 * 이 파티의 최근 레이드 시작 시각 (평소 시간 학습용).
 * 확정 시간(confirmed)이 남아 있는 일정만 본다. 지금 계산하는 주기는 뺀다.
 * 참고용 값이라 트랜잭션 밖에서 읽는다.
 */
export async function loadRecentRaidStarts(db: Firestore, partyId: string, exceptPeriodId: string): Promise<RaidStart[]> {
  const snap = await db
    .collection(`parties/${partyId}/schedules`)
    .orderBy("periodStart", "desc")
    .limit(USUAL_RAID_COUNT + 4)
    .get();
  const starts: RaidStart[] = [];
  for (const doc of snap.docs) {
    if (doc.id === exceptPeriodId) continue;
    const startMs = (doc.get("confirmed.start") as Timestamp | undefined)?.toMillis();
    if (startMs === undefined) continue;
    starts.push({ weekday: kstWeekday(startMs), minute: Math.floor((startMs - startOfKstDay(startMs)) / 60_000) });
    if (starts.length >= USUAL_RAID_COUNT) break;
  }
  return starts;
}
