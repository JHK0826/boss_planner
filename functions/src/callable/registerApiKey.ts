import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { toPublicCharacters, toSecretCharacters, type PublicCharacter } from "../characters";
import { REGION } from "../config";
import { NexonClient } from "../nexon/client";
import { toHttpsError } from "../nexon/errors";

const API_KEY_PATTERN = /^[A-Za-z0-9_\-]{20,200}$/;

/**
 * API Key가 유효한지 캐릭터 목록 호출로 확인하고, 키와 ocid를 secrets/{uid}에 저장한다.
 * 앱에는 ocid를 뺀 캐릭터 목록만 돌려준다.
 */
export const registerApiKey = onCall({ region: REGION }, async (request): Promise<{ characters: PublicCharacter[] }> => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "로그인이 필요합니다.");

  const apiKey = typeof request.data?.apiKey === "string" ? request.data.apiKey.trim() : "";
  if (!API_KEY_PATTERN.test(apiKey)) {
    throw new HttpsError("invalid-argument", "API Key 형식이 올바르지 않습니다.", { reason: "invalid-key" });
  }

  let characters;
  try {
    characters = toSecretCharacters(await new NexonClient(apiKey).listCharacters());
  } catch (error) {
    throw toHttpsError(error);
  }

  const db = getFirestore();
  const batch = db.batch();
  batch.set(db.doc(`secrets/${uid}`), {
    apiKey,
    characters,
    charactersFetchedAt: FieldValue.serverTimestamp(),
  });
  batch.set(
    db.doc(`users/${uid}`),
    { apiKeyRegistered: true, apiKeyRegisteredAt: FieldValue.serverTimestamp() },
    { merge: true },
  );
  await batch.commit();

  return { characters: toPublicCharacters(characters) };
});
