import { getFirestore } from "firebase-admin/firestore";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { REGION } from "../config";
import * as service from "../earnings/service";
import { NexonClient } from "../nexon/client";

/** 내 캐릭터 탭: 골라 둔 캐릭터마다 게임 스케줄러에 등록한 보스, 클리어 여부, 인원수, 결정석 가격 */
export const getSchedulerState = onCall({ region: REGION }, (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "로그인이 필요합니다.");
  return service.getSchedulerState(getFirestore(), uid, request.data, Date.now(), (apiKey) => new NexonClient(apiKey));
});
