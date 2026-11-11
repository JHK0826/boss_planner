import { getFirestore, FieldValue, Timestamp } from "firebase-admin/firestore";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { toPublicCharacters, toSecretCharacters, type PublicCharacter, type SecretCharacter } from "../characters";
import { CHARACTER_LIST_TTL_MS, REGION } from "../config";
import { NexonClient } from "../nexon/client";
import { toHttpsError } from "../nexon/errors";

/**
 * 저장해 둔 캐릭터 목록을 돌려준다. 30일이 지났거나 refresh=true면 NEXON에서 다시 받는다.
 */
export const listCharacters = onCall({ region: REGION }, async (request): Promise<{ characters: PublicCharacter[] }> => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "로그인이 필요합니다.");

  const secretRef = getFirestore().doc(`secrets/${uid}`);
  const secret = (await secretRef.get()).data();
  if (!secret?.apiKey) {
    throw new HttpsError("failed-precondition", "API Key를 먼저 등록해 주세요.", { reason: "no-api-key" });
  }

  const fetchedAt = secret.charactersFetchedAt instanceof Timestamp ? secret.charactersFetchedAt.toMillis() : 0;
  const stale = Date.now() - fetchedAt > CHARACTER_LIST_TTL_MS;
  let characters = (secret.characters ?? {}) as Record<string, SecretCharacter>;

  if (stale || request.data?.refresh === true) {
    try {
      characters = toSecretCharacters(await new NexonClient(secret.apiKey).listCharacters());
    } catch (error) {
      throw toHttpsError(error);
    }
    await secretRef.update({ characters, charactersFetchedAt: FieldValue.serverTimestamp() });
  }

  return { characters: toPublicCharacters(characters) };
});
