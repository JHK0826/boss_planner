import { createHash } from "node:crypto";
import type { NexonCharacterSummary } from "./nexon/client";

/** secrets/{uid}에만 저장하는 캐릭터 항목 (ocid 포함) */
export interface SecretCharacter {
  ocid: string;
  name: string;
  world: string;
  job: string;
  level: number;
}

/** 앱에 내려 주는 캐릭터 항목 (ocid 없음) */
export interface PublicCharacter {
  id: string;
  name: string;
  world: string;
  job: string;
  level: number;
}

/**
 * 앱에서 캐릭터를 가리킬 때 쓰는 ID.
 * ocid를 앱에 내려 주지 않기 위해 단방향 해시를 쓴다.
 */
export function characterIdFromOcid(ocid: string): string {
  return createHash("sha256").update(ocid).digest("hex").slice(0, 24);
}

export function toSecretCharacters(list: NexonCharacterSummary[]): Record<string, SecretCharacter> {
  const result: Record<string, SecretCharacter> = {};
  for (const character of list) {
    if (!character.ocid) continue;
    result[characterIdFromOcid(character.ocid)] = {
      ocid: character.ocid,
      name: character.character_name,
      world: character.world_name,
      job: character.character_class,
      level: character.character_level,
    };
  }
  return result;
}

export function toPublicCharacters(secret: Record<string, SecretCharacter>): PublicCharacter[] {
  return Object.entries(secret)
    .map(([id, c]) => ({ id, name: c.name, world: c.world, job: c.job, level: c.level }))
    .sort((a, b) => b.level - a.level || a.name.localeCompare(b.name, "ko"));
}
