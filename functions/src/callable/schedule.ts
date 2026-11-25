import { getFirestore } from "firebase-admin/firestore";
import { HttpsError, onCall, type CallableRequest } from "firebase-functions/v2/https";
import { REGION } from "../config";
import { approveChange as approve, requestChange as request } from "../schedule/change";
import { confirmSchedule as confirm } from "../schedule/confirm";
import { addMercenary as add, removeMercenary as remove, replaceWithMercenary as replace } from "../schedule/mercenary";

function requireUid(request: CallableRequest): string {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "로그인이 필요합니다.");
  return uid;
}

export const confirmSchedule = onCall({ region: REGION }, (req) =>
  confirm(getFirestore(), requireUid(req), req.data, Date.now()),
);

export const requestChange = onCall({ region: REGION }, async (req) => {
  await request(getFirestore(), requireUid(req), req.data, Date.now());
  return { ok: true };
});

export const approveChange = onCall({ region: REGION }, (req) =>
  approve(getFirestore(), requireUid(req), req.data, Date.now()),
);

export const replaceWithMercenary = onCall({ region: REGION }, (req) =>
  replace(getFirestore(), requireUid(req), req.data, Date.now()),
);

export const addMercenary = onCall({ region: REGION }, (req) => add(getFirestore(), requireUid(req), req.data, Date.now()));

export const removeMercenary = onCall({ region: REGION }, async (req) => {
  await remove(getFirestore(), requireUid(req), req.data, Date.now());
  return { ok: true };
});
