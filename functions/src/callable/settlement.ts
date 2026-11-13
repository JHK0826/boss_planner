import { getFirestore } from "firebase-admin/firestore";
import { HttpsError, onCall, type CallableRequest } from "firebase-functions/v2/https";
import { REGION } from "../config";
import * as service from "../settlement/service";

function requireUid(request: CallableRequest): string {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "로그인이 필요합니다.");
  return uid;
}

export const registerSettlement = onCall({ region: REGION }, (request) =>
  service.registerSettlement(getFirestore(), requireUid(request), request.data),
);

export const markPaid = onCall({ region: REGION }, async (request) => {
  await service.markPaid(getFirestore(), requireUid(request), request.data);
  return { ok: true };
});

export const confirmReceived = onCall({ region: REGION }, (request) =>
  service.confirmReceived(getFirestore(), requireUid(request), request.data),
);
