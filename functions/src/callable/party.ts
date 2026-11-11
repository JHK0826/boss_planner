import { getFirestore } from "firebase-admin/firestore";
import { HttpsError, onCall, type CallableRequest } from "firebase-functions/v2/https";
import { REGION } from "../config";
import * as service from "../party/service";

function requireUid(request: CallableRequest): string {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "로그인이 필요합니다.");
  return uid;
}

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

export const delegateLeader = onCall({ region: REGION }, async (request) => {
  await service.delegateLeader(getFirestore(), requireUid(request), request.data, Date.now());
  return { ok: true };
});
