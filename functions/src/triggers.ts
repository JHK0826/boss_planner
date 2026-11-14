import { getFirestore } from "firebase-admin/firestore";
import { onDocumentCreated, onDocumentWritten } from "firebase-functions/v2/firestore";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { REGION, TIME_ZONE } from "./config";
import { messageNotification, scheduleNotifications, settlementNotifications } from "./notify/messages";
import { runInputDeadlineCheck, sendPushes, toPartyInfo } from "./notify/send";
import { resolveRaidResult, runDailyClearCheck } from "./schedule/clear";
import { evaluateSchedule } from "./schedule/evaluate";
import { openSchedules } from "./schedule/open";
import { sweepSchedules } from "./schedule/sweep";

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

/** 파티원이 클리어·미클리어를 직접 기록하면 바로 반영한다 (SETTLED / RETRY / EXPIRED) */
export const onClearWrite = onDocumentWritten(
  { document: "parties/{partyId}/schedules/{periodId}/clears/{uid}", region: REGION },
  async (event) => {
    const result = event.data?.after.get("result") as string | undefined;
    if (result !== "CLEARED" && result !== "NOT_CLEARED") return;
    const db = getFirestore();
    const scheduleRef = db.doc(`parties/${event.params.partyId}/schedules/${event.params.periodId}`);
    await resolveRaidResult(db, scheduleRef, result === "CLEARED", "MANUAL", Date.now());
  },
);

/** 매주 목요일 00:00 KST: 지난 주기 정리, 주간 보스 파티의 새 주기 일정 생성 */
export const weeklyOpen = onSchedule({ schedule: "0 0 * * 4", timeZone: TIME_ZONE, region: REGION }, async () => {
  await sweepSchedules(getFirestore(), Date.now());
  await openSchedules(getFirestore(), "WEEKLY", Date.now());
});

/** 매월 1일 00:00 KST: 지난 주기 정리, 월간 보스 파티의 새 주기 일정 생성 */
export const monthlyOpen = onSchedule({ schedule: "0 0 1 * *", timeZone: TIME_ZONE, region: REGION }, async () => {
  await sweepSchedules(getFirestore(), Date.now());
  await openSchedules(getFirestore(), "MONTHLY", Date.now());
});

/** 30분마다: 예정 시각이 지난 일정을 VERIFYING으로, 주기가 끝난 미확정 일정을 종료로 */
export const scheduleSweep = onSchedule({ schedule: "*/30 * * * *", timeZone: TIME_ZONE, region: REGION }, async () => {
  await sweepSchedules(getFirestore(), Date.now());
});

/** 매일 05:00 KST: 직접 기록이 없는 일정을 NEXON API로 확인, 30일 지난 캐릭터 목록 갱신 */
export const dailyClearCheck = onSchedule(
  { schedule: "0 5 * * *", timeZone: TIME_ZONE, region: REGION, timeoutSeconds: 540 },
  async () => {
    await runDailyClearCheck(getFirestore(), Date.now());
  },
);

/** 매일 00:00 KST: 입력 마감이 지난 일정의 미입력 파티원과 파티장에게 알림 */
export const inputDeadlineCheck = onSchedule({ schedule: "0 0 * * *", timeZone: TIME_ZONE, region: REGION }, async () => {
  await runInputDeadlineCheck(getFirestore(), Date.now());
});

/** 일정이 바뀌면 알림: 시작, 추천, 전원 동의, 확정, 변경 요청, 결과, 분배금 등록, 정산 완료 */
export const onScheduleStateChange = onDocumentWritten(
  { document: "parties/{partyId}/schedules/{periodId}", region: REGION },
  async (event) => {
    const db = getFirestore();
    const party = toPartyInfo(await db.doc(`parties/${event.params.partyId}`).get());
    if (!party) return;
    await sendPushes(db, scheduleNotifications(party, event.data?.before.data(), event.data?.after.data()));
  },
);

/** 분배금 상태가 바뀌면 알림: 지급함 → 받는 사람, 수령 확인 → 판매자 */
export const onSettlementWrite = onDocumentWritten(
  { document: "parties/{partyId}/schedules/{periodId}/settlement/{uid}", region: REGION },
  async (event) => {
    const db = getFirestore();
    const partyRef = db.doc(`parties/${event.params.partyId}`);
    const [partySnap, scheduleSnap] = await Promise.all([
      partyRef.get(),
      partyRef.collection("schedules").doc(event.params.periodId).get(),
    ]);
    const party = toPartyInfo(partySnap);
    const sellerUid = scheduleSnap.get("settlement.sellerUid") as string | undefined;
    if (!party || !sellerUid) return;
    await sendPushes(
      db,
      settlementNotifications(party, sellerUid, event.params.uid, event.data?.before.data(), event.data?.after.data()),
    );
  },
);

/** 정산 채팅 메시지가 오면 다른 파티원에게 알림 */
export const onMessageCreate = onDocumentCreated(
  { document: "parties/{partyId}/schedules/{periodId}/messages/{messageId}", region: REGION },
  async (event) => {
    const db = getFirestore();
    const party = toPartyInfo(await db.doc(`parties/${event.params.partyId}`).get());
    const senderUid = event.data?.get("senderUid") as string | undefined;
    const text = (event.data?.get("text") as string | undefined) ?? "";
    const hasImage = typeof event.data?.get("imageUrl") === "string";
    if (!party || !senderUid || (!text && !hasImage)) return;
    await sendPushes(db, messageNotification(party, senderUid, text, hasImage));
  },
);
