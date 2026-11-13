import { Timestamp, type DocumentReference, type Firestore } from "firebase-admin/firestore";
import type { SecretCharacter } from "../characters";
import { toSecretCharacters } from "../characters";
import { CHARACTER_LIST_TTL_MS } from "../config";
import { SLOT_MS, kstDateString } from "../domain/time";
import { bossesOf } from "../domain/bosses";
import { NexonClient, allBossesCompleted } from "../nexon/client";
import { releaseBusy } from "./confirm";
import { evaluateSchedule } from "./evaluate";
import { resetFields, type Confirmed } from "./model";
import { sweepSchedules } from "./sweep";

export type RaidOutcome = "ignored" | "settled" | "retry" | "expired";
type ClientFactory = (apiKey: string) => Pick<NexonClient, "getBossContents" | "listCharacters">;

/** 게임 데이터가 API에 반영되기까지 기다리는 시간 */
const API_DELAY_MS = 30 * 60 * 1000;
/** API로 끝내 확인하지 못한 일정은 주기가 끝나고 이만큼 지나면 만료시킨다. */
const UNVERIFIED_GRACE_MS = 48 * 60 * 60 * 1000;

/**
 * 레이드 결과를 일정에 반영한다.
 * - 클리어 → SETTLED
 * - 미클리어 → 남은 기간에 한 번 더 잡을 수 있으면 RETRY, 아니면 EXPIRED
 *
 * RETRY로 갈 때는 확정 시간(busy)을 풀고, 이전 불가 시간을 그대로 써서 바로 다시 추천한다.
 */
export async function resolveRaidResult(
  db: Firestore,
  scheduleRef: DocumentReference,
  cleared: boolean,
  source: "MANUAL" | "API",
  nowMs: number,
): Promise<RaidOutcome> {
  const outcome = await db.runTransaction(async (tx): Promise<RaidOutcome> => {
    const schedule = (await tx.get(scheduleRef)).data();
    if (!schedule || (schedule.state !== "LOCKED" && schedule.state !== "VERIFYING")) return "ignored";
    const confirmed = schedule.confirmed as Confirmed;
    // 레이드가 시작하기 전에 남긴 기록은 받지 않는다.
    if (nowMs < confirmed.start.toMillis()) return "ignored";

    if (cleared) {
      tx.update(scheduleRef, { state: "SETTLED", clearedBy: source, settledAt: Timestamp.now(), updatedAt: Timestamp.now() });
      return "settled";
    }

    const canRetry = nowMs + (schedule.durationSlots as number) * SLOT_MS <= (schedule.periodEnd as Timestamp).toMillis();
    if (!canRetry) {
      tx.update(scheduleRef, { state: "EXPIRED", expiredReason: "NOT_CLEARED", updatedAt: Timestamp.now() });
      return "expired";
    }
    // 다음 시도의 결과와 섞이지 않게 이번 기록을 지운다.
    const clears = await tx.get(scheduleRef.collection("clears"));
    releaseBusy(tx, db, schedule);
    for (const doc of clears.docs) tx.delete(doc.ref);
    tx.update(scheduleRef, {
      ...resetFields(schedule.round as number),
      state: "RETRY",
      changeRequest: null,
      retryCount: ((schedule.retryCount as number) ?? 0) + 1,
    });
    return "retry";
  });

  if (outcome === "retry") {
    await evaluateSchedule(db, scheduleRef.parent.parent!.id, scheduleRef.id, nowMs);
  }
  return outcome;
}

/**
 * 파티원들의 API Key로 스케줄러 API를 불러 보스 클리어 여부를 확인한다.
 * 묶음 파티는 묶은 보스를 모두 클리어해야 클리어다.
 * 한 명이라도 클리어로 나오면 true, 확인된 사람이 모두 미클리어면 false, 아무도 확인하지 못하면 null.
 * date는 레이드 날짜로 지정한다(목요일 초기화 뒤에도 수요일 레이드를 확인하기 위함).
 */
export async function checkClearByApi(
  db: Firestore,
  party: FirebaseFirestore.DocumentData,
  confirmed: Confirmed,
  makeClient: ClientFactory,
): Promise<boolean | null> {
  const date = kstDateString(confirmed.end.toMillis() - 1);
  let sawNotCleared = false;
  for (const uid of confirmed.memberUids) {
    const characterId = party.members?.[uid]?.characterId as string | undefined;
    const secret = (await db.doc(`secrets/${uid}`).get()).data();
    const ocid = characterId && (secret?.characters as Record<string, SecretCharacter> | undefined)?.[characterId]?.ocid;
    if (!secret?.apiKey || !ocid) continue;
    try {
      const contents = await makeClient(secret.apiKey as string).getBossContents(ocid, date);
      const result = allBossesCompleted(contents, bossesOf(party));
      if (result === true) return true;
      if (result === false) sawNotCleared = true;
    } catch {
      // 키 만료, 점검, 조회 가능 기간 초과 등. 다른 파티원의 키로 계속 시도한다.
    }
  }
  return sawNotCleared ? false : null;
}

/**
 * 매일 05:00: 직접 기록이 없는 일정(VERIFYING)을 API로 확인하고, 30일 지난 캐릭터 목록을 갱신한다.
 */
export async function runDailyClearCheck(
  db: Firestore,
  nowMs: number,
  makeClient: ClientFactory = (apiKey) => new NexonClient(apiKey),
): Promise<Record<RaidOutcome | "unknown", number>> {
  await sweepSchedules(db, nowMs);

  const counts = { ignored: 0, settled: 0, retry: 0, expired: 0, unknown: 0 };
  const verifying = await db.collectionGroup("schedules").where("state", "==", "VERIFYING").get();
  for (const doc of verifying.docs) {
    const confirmed = doc.get("confirmed") as Confirmed;
    if (confirmed.end.toMillis() + API_DELAY_MS > nowMs) continue;
    const party = (await doc.ref.parent.parent!.get()).data();
    const cleared = party ? await checkClearByApi(db, party, confirmed, makeClient) : null;
    if (cleared !== null) {
      counts[await resolveRaidResult(db, doc.ref, cleared, "API", nowMs)]++;
    } else if (nowMs > (doc.get("periodEnd") as Timestamp).toMillis() + UNVERIFIED_GRACE_MS) {
      await doc.ref.update({ state: "EXPIRED", expiredReason: "UNVERIFIED", updatedAt: Timestamp.now() });
      counts.expired++;
    } else {
      counts.unknown++;
    }
  }

  await refreshStaleCharacterLists(db, nowMs, makeClient);
  return counts;
}

/** 받아 온 지 30일이 지난 캐릭터 목록(ocid)을 다시 받는다. 하루 호출 한도를 아끼려고 개수를 제한한다. */
export async function refreshStaleCharacterLists(
  db: Firestore,
  nowMs: number,
  makeClient: ClientFactory,
  limit = 30,
): Promise<number> {
  const stale = await db
    .collection("secrets")
    .where("charactersFetchedAt", "<", Timestamp.fromMillis(nowMs - CHARACTER_LIST_TTL_MS))
    .limit(limit)
    .get();
  let refreshed = 0;
  for (const doc of stale.docs) {
    try {
      const characters = toSecretCharacters(await makeClient(doc.get("apiKey") as string).listCharacters());
      await doc.ref.update({ characters, charactersFetchedAt: Timestamp.fromMillis(nowMs) });
      refreshed++;
    } catch {
      // 실패한 키는 다음 날 다시 시도한다.
    }
  }
  return refreshed;
}
