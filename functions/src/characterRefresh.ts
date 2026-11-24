/**
 * NEXON에서 받아 저장한 캐릭터 데이터를 30일 안에 다시 받는다 (NEXON Open API 데이터 갱신 의무).
 *
 * 저장하는 곳은 세 군데다.
 * - secrets/{uid}.characters: 캐릭터 목록(ocid 포함). charactersFetchedAt 기준
 * - users/{uid}/characters/{characterId}: 캐릭터 기본 정보 캐시(레벨, 이미지). fetchedAt 기준
 * - parties/{id}.members.{uid}: 가입할 때 옮겨 적은 캐릭터 이름·직업·레벨·월드
 *
 * 앞의 두 곳을 다시 받을 때마다 파티에 옮겨 적은 값도 같이 맞춘다.
 */
import { Timestamp, type Firestore } from "firebase-admin/firestore";
import { toSecretCharacters, type SecretCharacter } from "./characters";
import { CHARACTER_REFRESH_AFTER_MS } from "./config";
import { NexonApiError, type NexonClient } from "./nexon/client";

export type RefreshClientFactory = (apiKey: string) => Pick<NexonClient, "listCharacters" | "getCharacterBasic">;

/** 파티에 옮겨 적는 캐릭터 정보 */
export interface CharacterSnapshot {
  name: string;
  world: string;
  job: string;
  level: number;
}

/**
 * 그 사람이 속한 파티들에 옮겨 적힌 캐릭터 정보를 새 값으로 맞춘다.
 * 빈 값(NEXON이 null을 준 칸)으로는 덮어쓰지 않는다. @returns 바뀐 파티 수
 */
export async function syncPartyMembers(db: Firestore, uid: string, characters: Record<string, CharacterSnapshot>): Promise<number> {
  const parties = await db.collection("parties").where("memberUids", "array-contains", uid).get();
  let updated = 0;
  for (const party of parties.docs) {
    const characterId = party.get(`members.${uid}.characterId`) as string | undefined;
    if (!characterId || !characters[characterId]) continue;
    const changed = await db.runTransaction(async (tx) => {
      const data = (await tx.get(party.ref)).data();
      const member = data?.members?.[uid];
      // 그사이 탈퇴했거나 캐릭터가 바뀌었으면 건드리지 않는다.
      if (!data || !(data.memberUids as string[]).includes(uid) || member?.characterId !== characterId) return false;
      const fresh = characters[characterId];
      const changes: Record<string, string | number> = {};
      if (fresh.name && member.characterName !== fresh.name) changes[`members.${uid}.characterName`] = fresh.name;
      if (fresh.job && member.job !== fresh.job) changes[`members.${uid}.job`] = fresh.job;
      if (fresh.level > 0 && member.level !== fresh.level) changes[`members.${uid}.level`] = fresh.level;
      if (fresh.world && member.world !== fresh.world) changes[`members.${uid}.world`] = fresh.world;
      if (Object.keys(changes).length === 0) return false;
      tx.update(party.ref, changes);
      return true;
    });
    if (changed) updated++;
  }
  return updated;
}

/** 다시 받아도 결과가 같은 실패(키 만료, 대상 없음 등). 일시적인 실패(점검, 호출 한도, 네트워크)는 다음 날 다시 시도한다. */
const isPermanent = (error: unknown) => error instanceof NexonApiError && (error.kind === "invalid-key" || error.kind === "bad-request");

/** 받아 온 지 오래된 캐릭터 목록(ocid)을 다시 받는다. 한 번에 처리하는 수를 제한한다. @returns 갱신한 수 */
export async function refreshStaleCharacterLists(
  db: Firestore,
  nowMs: number,
  makeClient: RefreshClientFactory,
  limit = 30,
): Promise<number> {
  const stale = await db
    .collection("secrets")
    .where("charactersFetchedAt", "<", Timestamp.fromMillis(nowMs - CHARACTER_REFRESH_AFTER_MS))
    .limit(limit)
    .get();
  let refreshed = 0;
  for (const doc of stale.docs) {
    try {
      const characters = toSecretCharacters(await makeClient(doc.get("apiKey") as string).listCharacters());
      await doc.ref.update({ characters, charactersFetchedAt: Timestamp.fromMillis(nowMs) });
      await syncPartyMembers(db, doc.id, characters);
      refreshed++;
    } catch {
      // 실패한 키는 다음 날 다시 시도한다.
    }
  }
  return refreshed;
}

/**
 * 받아 온 지 오래된 캐릭터 기본 정보 캐시를 다시 받는다.
 * 다시 받을 수 없는 캐시(키가 없거나 만료됨, 계정에서 빠진 캐릭터)는 오래된 값을 남기지 않도록 지운다.
 * 앱에서 그 캐릭터를 다시 보면 getCharacterInfo가 새로 받는다. @returns 갱신한 수
 */
export async function refreshStaleCharacterInfo(
  db: Firestore,
  nowMs: number,
  makeClient: RefreshClientFactory,
  limit = 50,
): Promise<number> {
  const stale = await db
    .collectionGroup("characters")
    .where("fetchedAt", "<", Timestamp.fromMillis(nowMs - CHARACTER_REFRESH_AFTER_MS))
    .limit(limit)
    .get();
  const secrets = new Map<string, FirebaseFirestore.DocumentData | undefined>();
  let refreshed = 0;
  for (const doc of stale.docs) {
    const uid = doc.ref.parent.parent?.id;
    if (!uid || doc.ref.parent.parent?.parent.id !== "users") continue;
    if (!secrets.has(uid)) secrets.set(uid, (await db.doc(`secrets/${uid}`).get()).data());
    const secret = secrets.get(uid);
    const character = (secret?.characters as Record<string, SecretCharacter> | undefined)?.[doc.id];
    if (!secret?.apiKey || !character) {
      await doc.ref.delete();
      continue;
    }
    try {
      const basic = await makeClient(secret.apiKey as string).getCharacterBasic(character.ocid);
      const snapshot: CharacterSnapshot = {
        name: basic.character_name || character.name,
        world: basic.world_name || character.world,
        job: basic.character_class || character.job,
        level: basic.character_level || character.level,
      };
      await doc.ref.set({
        ...snapshot,
        imageUrl: basic.character_image,
        guild: basic.character_guild_name,
        fetchedAt: Timestamp.fromMillis(nowMs),
      });
      await syncPartyMembers(db, uid, { [doc.id]: snapshot });
      refreshed++;
    } catch (error) {
      if (isPermanent(error)) await doc.ref.delete();
    }
  }
  return refreshed;
}
