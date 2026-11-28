import { Timestamp, type DocumentData, type Firestore } from "firebase-admin/firestore";
import { otherPartiesOf } from "./pending";

const ALREADY_EXISTS = 6;

/**
 * 새로 연 일정에, 파티원이 같은 주기의 다른 파티에 이미 낸 불가 시간을 그대로 넣는다(제출한 것으로).
 * 불가 시간은 캐릭터가 아니라 사람 기준이라, 한 파티에 다음 주 불가 시간을 미리 냈으면
 * 다른 파티가 레이드를 끝내고 다음 주 일정을 열 때 다시 낼 필요가 없게 하려는 것이다.
 *
 * - 같은 주기 ID(같은 주·같은 달)의 다른 파티 일정에 "제출한" 불가 시간만 가져온다.
 * - "내 다른 파티에도 같은 시간으로 제출"을 끄고 냈으면(shareToOthers: false) 가져오지 않는다.
 * - 여러 파티에 냈으면 가장 최근에 낸 것을 쓴다.
 * - 이 일정에 이미 그 사람의 문서가 있으면 건드리지 않는다.
 * 넣은 문서에는 carriedFrom(가져온 파티)을 남겨 화면이 "자동으로 넣었다"고 알려 준다. 본인이 고쳐 내면 사라진다.
 *
 * @returns 불가 시간을 넣은 파티원
 */
export async function carryOverUnavailable(db: Firestore, partyId: string, periodId: string, memberUids: string[]): Promise<string[]> {
  if (memberUids.length === 0) return [];
  const others = await otherPartiesOf(db, partyId, memberUids);
  // 파티원별로 다른 파티에 낸 가장 최근 불가 시간
  const latest = new Map<string, { data: DocumentData; from: string; at: number }>();
  await Promise.all(
    [...others].map(async ([otherId, { memberIndexes }]) => {
      const refs = memberIndexes.map((i) => db.doc(`parties/${otherId}/schedules/${periodId}/unavailable/${memberUids[i]}`));
      const snaps = await db.getAll(...refs);
      for (const snap of snaps) {
        const data = snap.data();
        if (!data || data.submitted !== true || data.shareToOthers === false || !Array.isArray(data.slots)) continue;
        const uid = snap.id;
        const at = (data.updatedAt as Timestamp | undefined)?.toMillis() ?? 0;
        if (!latest.has(uid) || latest.get(uid)!.at < at) latest.set(uid, { data, from: otherId, at });
      }
    }),
  );

  const carried: string[] = [];
  await Promise.all(
    [...latest].map(async ([uid, { data, from }]) => {
      try {
        await db.doc(`parties/${partyId}/schedules/${periodId}/unavailable/${uid}`).create({
          slots: (data.slots as unknown[]).filter((slot): slot is string => typeof slot === "string"),
          submitted: true,
          updatedAt: Timestamp.now(),
          carriedFrom: from,
        });
        carried.push(uid);
      } catch (error) {
        // 그 사이 본인이 직접 냈으면 그대로 둔다.
        if ((error as { code?: number }).code !== ALREADY_EXISTS) throw error;
      }
    }),
  );
  return carried.sort();
}

/** 새 일정을 연 뒤 부른다. 실패해도 일정 열기는 성공으로 둔다(파티원이 직접 내면 된다). */
export async function carryOverQuietly(db: Firestore, partyId: string, periodId: string, memberUids: string[]): Promise<void> {
  await carryOverUnavailable(db, partyId, periodId, memberUids).catch((error) =>
    console.error("carryOverUnavailable failed", partyId, periodId, (error as Error).message),
  );
}
