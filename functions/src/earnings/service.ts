/**
 * 내 캐릭터 탭: 게임 스케줄러에 등록한 보스와 수익 기록.
 *
 * - getSchedulerState: 골라 둔 캐릭터마다 스케줄러 API를 불러 등록한 주간·월간 보스와 클리어 여부를 준다.
 *   10분 동안은 저장해 둔 값을 쓴다(개발 단계 키는 하루 1,000건). 부를 때마다 이번 주·이번 달 결정석 수익을 기록한다.
 * - finalizeEarnings: 매일 05:00. 목요일에는 끝난 주를, 1일에는 끝난 달(월간 보스)을 전날 날짜로 다시 조회해 확정한다.
 * - recordSettlementEarnings: 분배금 등록·수령 확인 뒤 그 정산에서 사람마다 번 돈을 기록한다.
 *
 * 기록(users/{uid}/earnings/{W-yyyyMMdd | M-yyyyMM})에는 보스 목록 원본을 남기지 않고 합계만 남긴다.
 */

import { FieldPath, FieldValue, Timestamp, type DocumentReference, type Firestore } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/v2/https";
import type { SecretCharacter } from "../characters";
import { CRYSTAL_PRICES } from "../domain/crystals";
import {
  clearedSummary,
  monthIdOf,
  priceBosses,
  registeredBosses,
  settlementShares,
  weekIdOf,
  type PartyForSize,
  type PricedBoss,
  type SchedulerBoss,
  type SettlementForShares,
} from "../domain/earnings";
import { extraMercenaryCount, type MercenaryLike } from "../domain/mercenary";
import { currentPeriod, kstDateString, kstWeekday, type Cycle } from "../domain/time";
import type { NexonClient } from "../nexon/client";
import { toHttpsError } from "../nexon/errors";

type Data = Record<string, unknown> | undefined | null;
export type SchedulerClientFactory = (apiKey: string) => Pick<NexonClient, "getBossContents">;

/** 이 시간 안에 다시 열면 NEXON을 부르지 않는다. */
export const SCHEDULER_CACHE_MS = 10 * 60 * 1000;
/** 새로고침 버튼도 이 간격보다 자주는 부르지 않는다. */
const REFRESH_MIN_MS = 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface CharacterScheduler {
  bosses: PricedBoss[];
  /** 스케줄러를 받아 온 시각. 받은 적이 없으면 null */
  fetchedAtMs: number | null;
  /** 이번에 받지 못한 이유. 저장해 둔 값이 있으면 그 값을 함께 준다 */
  error: string | null;
}

/** 내 파티들. 인원수에는 atMs가 속한 주기에 파티장이 추가한 임시 용병도 더한다. */
async function loadParties(db: Firestore, uid: string, atMs: number): Promise<PartyForSize[]> {
  const snap = await db.collection("parties").where("memberUids", "array-contains", uid).get();
  return Promise.all(
    snap.docs.map(async (doc) => {
      const cycle = doc.get("cycle") as Cycle | undefined;
      const schedule = cycle ? await doc.ref.collection("schedules").doc(currentPeriod(cycle, atMs).id).get() : null;
      return {
        memberUids: (doc.get("memberUids") as string[] | undefined) ?? [],
        members: (doc.get("members") as PartyForSize["members"] | undefined) ?? {},
        bosses: Array.isArray(doc.get("bosses")) ? (doc.get("bosses") as { name: string }[]) : [],
        extraMercenaries: extraMercenaryCount(schedule?.get("mercenaries") as MercenaryLike[] | undefined),
      };
    }),
  );
}

/** 결정석 수익 기록을 덮어쓴다. cycles에 든 기간만 쓴다. */
async function writeCrystalEarnings(
  db: Firestore,
  uid: string,
  characterId: string,
  bosses: PricedBoss[],
  periods: { weekId?: string; monthId?: string },
  nowMs: number,
): Promise<void> {
  const updatedAt = Timestamp.fromMillis(nowMs);
  const writes: Promise<unknown>[] = [];
  if (periods.weekId) {
    writes.push(
      db.doc(`users/${uid}/earnings/${periods.weekId}`).set({ characters: { [characterId]: clearedSummary(bosses, "WEEKLY") }, updatedAt }, { merge: true }),
    );
  }
  if (periods.monthId) {
    writes.push(
      db.doc(`users/${uid}/earnings/${periods.monthId}`).set({ characters: { [characterId]: clearedSummary(bosses, "MONTHLY") }, updatedAt }, { merge: true }),
    );
  }
  await Promise.all(writes);
}

export async function getSchedulerState(
  db: Firestore,
  uid: string,
  data: Data,
  nowMs: number,
  makeClient: SchedulerClientFactory,
  prices: Record<string, number> = CRYSTAL_PRICES,
): Promise<{ characters: Record<string, CharacterScheduler> }> {
  const [userSnap, secretSnap] = await Promise.all([db.doc(`users/${uid}`).get(), db.doc(`secrets/${uid}`).get()]);
  const secret = secretSnap.data();
  if (!secret?.apiKey) {
    throw new HttpsError("failed-precondition", "API Key를 먼저 등록해 주세요.", { reason: "no-api-key" });
  }
  const ids = ((userSnap.get("selectedCharacterIds") as unknown[] | undefined) ?? []).filter((id): id is string => typeof id === "string").slice(0, 50);
  const maxAge = data?.refresh === true ? REFRESH_MIN_MS : SCHEDULER_CACHE_MS;
  const parties = await loadParties(db, uid, nowMs);
  const characters: Record<string, CharacterScheduler> = {};

  for (const characterId of ids) {
    const cacheRef = db.doc(`users/${uid}/scheduler/${characterId}`);
    const cached = (await cacheRef.get()).data();
    const cachedAt = cached?.fetchedAt instanceof Timestamp ? cached.fetchedAt.toMillis() : null;
    let bosses = (cached?.bosses as SchedulerBoss[] | undefined) ?? null;
    let fetchedAtMs = cachedAt;
    let error: string | null = null;
    let fetchedNow = false;

    if (cachedAt === null || nowMs - cachedAt >= maxAge) {
      const character = (secret.characters as Record<string, SecretCharacter> | undefined)?.[characterId];
      if (!character) {
        error = "내 계정의 캐릭터가 아닙니다. 캐릭터를 다시 선택해 주세요.";
      } else {
        try {
          bosses = registeredBosses(await makeClient(secret.apiKey as string).getBossContents(character.ocid));
          fetchedAtMs = nowMs;
          fetchedNow = true;
          await cacheRef.set({ bosses, fetchedAt: Timestamp.fromMillis(nowMs) });
        } catch (e) {
          error = toHttpsError(e).message;
        }
      }
    }

    const priced = priceBosses(bosses ?? [], parties, uid, characterId, prices);
    if (fetchedNow) {
      await writeCrystalEarnings(db, uid, characterId, priced, { weekId: weekIdOf(nowMs), monthId: monthIdOf(nowMs) }, nowMs);
    }
    characters[characterId] = { bosses: priced, fetchedAtMs, error };
  }
  return { characters };
}

/**
 * 끝난 주(목요일)·끝난 달(1일)의 결정석 수익을 확정한다. 전날 날짜로 조회하므로 초기화 뒤에도 끝난 기간의 상태를 본다.
 * 키가 만료됐거나 점검이면 그 사람은 건너뛰고, 앱에서 마지막으로 본 값이 남는다. @returns 기록한 캐릭터 수
 */
export async function finalizeEarnings(
  db: Firestore,
  nowMs: number,
  makeClient: SchedulerClientFactory,
  prices: Record<string, number> = CRYSTAL_PRICES,
): Promise<number> {
  const weekEnded = kstWeekday(nowMs) === 4;
  const monthEnded = kstDateString(nowMs).endsWith("-01");
  if (!weekEnded && !monthEnded) return 0;
  const yesterday = nowMs - DAY_MS;
  const periods = { weekId: weekEnded ? weekIdOf(yesterday) : undefined, monthId: monthEnded ? monthIdOf(yesterday) : undefined };

  let written = 0;
  const secrets = await db.collection("secrets").get();
  for (const secretDoc of secrets.docs) {
    const apiKey = secretDoc.get("apiKey") as string | undefined;
    if (!apiKey) continue;
    const uid = secretDoc.id;
    const ids = ((await db.doc(`users/${uid}`).get()).get("selectedCharacterIds") as string[] | undefined) ?? [];
    if (ids.length === 0) continue;
    const parties = await loadParties(db, uid, yesterday);
    const owned = (secretDoc.get("characters") as Record<string, SecretCharacter> | undefined) ?? {};
    for (const characterId of ids) {
      const character = owned[characterId];
      if (!character) continue;
      try {
        const contents = await makeClient(apiKey).getBossContents(character.ocid, kstDateString(yesterday));
        const priced = priceBosses(registeredBosses(contents), parties, uid, characterId, prices);
        await writeCrystalEarnings(db, uid, characterId, priced, periods, nowMs);
        written++;
      } catch {
        // 다음 사람은 계속한다.
      }
    }
  }
  return written;
}

/**
 * 그 정산에서 레이드 참여자마다 번 돈을 다시 계산해 그 레이드가 있던 주의 기록에 덮어쓴다(여러 번 불러도 같다).
 * 받는 사람은 수령 확인 뒤, 판매자는 정산이 끝난 뒤에 들어간다.
 */
export async function recordSettlementEarnings(db: Firestore, scheduleRef: DocumentReference): Promise<void> {
  const partyRef = scheduleRef.parent.parent!;
  const [partySnap, scheduleSnap, entriesSnap] = await Promise.all([partyRef.get(), scheduleRef.get(), scheduleRef.collection("settlement").get()]);
  const settlement = scheduleSnap.get("settlement") as SettlementForShares | null | undefined;
  const confirmed = scheduleSnap.get("confirmed") as { start: Timestamp; memberUids: string[] } | null | undefined;
  if (!settlement || !confirmed) return;

  const shares = settlementShares(
    settlement,
    entriesSnap.docs.map((doc) => ({ uid: doc.id, amount: (doc.get("amount") as number) ?? 0, status: (doc.get("status") as string) ?? "PENDING" })),
  );
  const weekId = weekIdOf(confirmed.start.toMillis());
  const key = `${partyRef.id}_${scheduleRef.id}`;
  const members = (partySnap.get("members") as Record<string, { characterId?: string }> | undefined) ?? {};
  const partyName = (partySnap.get("name") as string | undefined) ?? "";
  const updatedAt = Timestamp.now();

  await Promise.all(
    confirmed.memberUids.map(async (uid) => {
      const ref = db.doc(`users/${uid}/earnings/${weekId}`);
      const amount = shares[uid] ?? 0;
      if (amount > 0) {
        const entry = { characterId: members[uid]?.characterId ?? null, partyName, amount, raidAt: confirmed.start };
        await ref.set({ settlements: { [key]: entry }, updatedAt }, { merge: true });
      } else {
        // 아직 번 돈이 없으면(다시 등록 등) 남아 있던 값만 지운다. 기록 문서가 없으면 그대로 둔다.
        await ref.update(new FieldPath("settlements", key), FieldValue.delete()).catch(() => {});
      }
    }),
  );
}
