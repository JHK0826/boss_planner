import { getFirestore } from "firebase-admin/firestore";
import { HttpsError, onCall, type CallableRequest } from "firebase-functions/v2/https";
import { REGION } from "../config";
import { BOSS_CATALOG, MINUTES_PER_BOSS } from "../domain/bosses";
import * as service from "../party/service";

function requireUid(request: CallableRequest): string {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "로그인이 필요합니다.");
  return uid;
}

/** 파티로 갈 수 있는 보스 목록. 앱은 이 목록으로 보스 선택 화면을 만든다. */
export const getBossCatalog = onCall({ region: REGION }, (request) => {
  requireUid(request);
  return { bosses: BOSS_CATALOG, minutesPerBoss: MINUTES_PER_BOSS, maxDurationMinutes: service.MAX_DURATION_MINUTES };
});

// 날짜 제한(목요일/1일)은 기기 시계가 아니라 서버 시각으로 검사한다.

export const createParty = onCall({ region: REGION }, (request) =>
  service.createParty(getFirestore(), requireUid(request), request.data, Date.now()),
);

export const joinParty = onCall({ region: REGION }, (request) =>
  service.joinParty(getFirestore(), requireUid(request), request.data, Date.now()),
);

export const leaveParty = onCall({ region: REGION }, (request) =>
  service.leaveParty(getFirestore(), requireUid(request), request.data, Date.now()),
);

export const startSchedule = onCall({ region: REGION }, (request) =>
  service.startSchedule(getFirestore(), requireUid(request), request.data, Date.now()),
);

export const updatePartyPreferences = onCall({ region: REGION }, async (request) => {
  await service.updatePartyPreferences(getFirestore(), requireUid(request), request.data, Date.now());
  return { ok: true };
});

export const delegateLeader = onCall({ region: REGION }, async (request) => {
  await service.delegateLeader(getFirestore(), requireUid(request), request.data, Date.now());
  return { ok: true };
});
