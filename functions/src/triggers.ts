import { getFirestore } from "firebase-admin/firestore";
import { onDocumentWritten } from "firebase-functions/v2/firestore";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { REGION, TIME_ZONE } from "./config";
import { evaluateSchedule } from "./schedule/evaluate";
import { openSchedules } from "./schedule/open";

/** 불가 시간이 바뀌면: 전원 제출 시 추천 후보 계산, 겹치는 시간이 없으면 SKIPPED */
export const onUnavailableWrite = onDocumentWritten(
  { document: "parties/{partyId}/schedules/{periodId}/unavailable/{uid}", region: REGION },
  async (event) => {
    await evaluateSchedule(getFirestore(), event.params.partyId, event.params.periodId, Date.now());
  },
);

/** 투표가 바뀌면: 전원 동의 후보 갱신, 전원이 투표했는데 동의가 없으면 다음 후보 */
export const onVoteWrite = onDocumentWritten(
  { document: "parties/{partyId}/schedules/{periodId}/votes/{uid}", region: REGION },
  async (event) => {
    await evaluateSchedule(getFirestore(), event.params.partyId, event.params.periodId, Date.now());
  },
);

/** 매주 목요일 00:00 KST: 주간 보스 파티의 새 주기 일정 생성 */
export const weeklyOpen = onSchedule({ schedule: "0 0 * * 4", timeZone: TIME_ZONE, region: REGION }, async () => {
  await openSchedules(getFirestore(), "WEEKLY", Date.now());
});

/** 매월 1일 00:00 KST: 월간 보스 파티의 새 주기 일정 생성 */
export const monthlyOpen = onSchedule({ schedule: "0 0 1 * *", timeZone: TIME_ZONE, region: REGION }, async () => {
  await openSchedules(getFirestore(), "MONTHLY", Date.now());
});
