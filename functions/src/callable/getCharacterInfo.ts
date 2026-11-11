import { getFirestore, FieldValue, Timestamp } from "firebase-admin/firestore";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import type { SecretCharacter } from "../characters";
import { CHARACTER_INFO_TTL_MS, REGION } from "../config";
import { NexonClient } from "../nexon/client";
import { toHttpsError } from "../nexon/errors";

export interface CharacterInfo {
  id: string;
  name: string;
  world: string;
  job: string;
  level: number;
  imageUrl: string | null;
  guild: string | null;
}

/**
 * 캐릭터 기본 정보(레벨, 직업, 이미지)를 조회해 users/{uid}/characters/{characterId}에 캐시한다.
 * 캐시가 24시간 안이면 NEXON을 호출하지 않는다.
 */
export const getCharacterInfo = onCall({ region: REGION }, async (request): Promise<CharacterInfo> => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "로그인이 필요합니다.");

  const characterId = request.data?.characterId;
  if (typeof characterId !== "string" || !/^[0-9a-f]{24}$/.test(characterId)) {
    throw new HttpsError("invalid-argument", "characterId가 올바르지 않습니다.");
  }

  const db = getFirestore();
  const cacheRef = db.doc(`users/${uid}/characters/${characterId}`);
  const cached = (await cacheRef.get()).data();
  if (
    cached &&
    request.data?.refresh !== true &&
    cached.fetchedAt instanceof Timestamp &&
    Date.now() - cached.fetchedAt.toMillis() < CHARACTER_INFO_TTL_MS
  ) {
    return {
      id: characterId,
      name: cached.name,
      world: cached.world,
      job: cached.job,
      level: cached.level,
      imageUrl: cached.imageUrl ?? null,
      guild: cached.guild ?? null,
    };
  }

  const secret = (await db.doc(`secrets/${uid}`).get()).data();
  if (!secret?.apiKey) {
    throw new HttpsError("failed-precondition", "API Key를 먼저 등록해 주세요.", { reason: "no-api-key" });
  }
  const character = (secret.characters as Record<string, SecretCharacter> | undefined)?.[characterId];
  if (!character) throw new HttpsError("not-found", "내 계정의 캐릭터가 아닙니다.");

  let basic;
  try {
    basic = await new NexonClient(secret.apiKey).getCharacterBasic(character.ocid);
  } catch (error) {
    throw toHttpsError(error);
  }

  const info: CharacterInfo = {
    id: characterId,
    name: basic.character_name || character.name,
    world: basic.world_name || character.world,
    job: basic.character_class || character.job,
    level: basic.character_level || character.level,
    imageUrl: basic.character_image,
    guild: basic.character_guild_name,
  };
  const { id: _id, ...fields } = info;
  await cacheRef.set({ ...fields, fetchedAt: FieldValue.serverTimestamp() });
  return info;
});
