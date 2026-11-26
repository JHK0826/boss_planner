import { randomBytes } from "node:crypto";
import { Timestamp, type DocumentData, type Firestore } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/v2/https";
import {
  MERCENARY_ID_PREFIX,
  activeMemberUids,
  canCancelReplacement,
  cleanMercenaryName,
  extraMercenaryCount,
  mercenaryEditable,
  nextMercenaryName,
  replacedUids,
  type MercenaryLike,
} from "../domain/mercenary";
import { MAX_PARTY_SIZE } from "../party/service";
import { busyIdsOf, requireString } from "./confirm";
import { evaluateSchedule } from "./evaluate";
import type { Confirmed } from "./model";

type Data = Record<string, unknown> | undefined | null;

export interface Mercenary extends MercenaryLike {
  addedBy: string;
  addedAt: Timestamp;
}

const newMercenaryId = () => `${MERCENARY_ID_PREFIX}${randomBytes(4).toString("hex")}`;
const mercenariesOf = (schedule: DocumentData): Mercenary[] => (schedule.mercenaries as Mercenary[] | undefined) ?? [];
const confirmedStartMs = (schedule: DocumentData): number | null =>
  (schedule.confirmed as Confirmed | null | undefined)?.start?.toMillis() ?? null;

function assertEditable(schedule: DocumentData, nowMs: number): void {
  if (!mercenaryEditable(schedule.state as string, confirmedStartMs(schedule), nowMs)) {
    throw new HttpsError("failed-precondition", "지금은 이 일정의 용병을 바꿀 수 없습니다. 레이드가 시작되었거나 일정이 끝났습니다.", {
      reason: "not-editable",
    });
  }
}

function refs(db: Firestore, data: Data) {
  const partyId = requireString(data, "partyId");
  const periodId = requireString(data, "periodId");
  const partyRef = db.doc(`parties/${partyId}`);
  return { partyId, periodId, partyRef, scheduleRef: partyRef.collection("schedules").doc(periodId) };
}

/**
 * 파티원이 이번 주기를 용병으로 대체한다. 그 주기에는 불가 시간 입력·투표·확정 일정에서 빠진다.
 *
 * - 확정 전이면 그 사람을 빼고 추천을 다시 계산한다(나머지가 다 냈으면 바로 후보가 나온다).
 * - 확정 후(레이드 시작 전)면 확정 시간은 그대로 두고 그 사람의 일정(busy)만 풀어 준다.
 */
export async function replaceWithMercenary(db: Firestore, uid: string, data: Data, nowMs: number): Promise<{ mercenaryId: string }> {
  const { partyId, periodId, partyRef, scheduleRef } = refs(db, data);
  const mercenaryId = newMercenaryId();

  const locked = await db.runTransaction(async (tx) => {
    const [partySnap, scheduleSnap] = await Promise.all([tx.get(partyRef), tx.get(scheduleRef)]);
    const party = partySnap.data();
    const schedule = scheduleSnap.data();
    const memberUids = (party?.memberUids as string[] | undefined) ?? [];
    if (!party || !schedule || !memberUids.includes(uid)) {
      throw new HttpsError("permission-denied", "가입한 파티가 아닙니다.", { reason: "not-member" });
    }
    assertEditable(schedule, nowMs);
    const mercenaries = mercenariesOf(schedule);
    if (replacedUids(mercenaries).has(uid)) {
      throw new HttpsError("already-exists", "이미 이번 주기를 용병으로 대체했습니다.", { reason: "already-replaced" });
    }
    if (activeMemberUids(memberUids, mercenaries).length <= 1) {
      throw new HttpsError("failed-precondition", "파티원 모두를 용병으로 대체할 수는 없습니다.", { reason: "last-member" });
    }

    const mercenary: Mercenary = {
      id: mercenaryId,
      name: cleanMercenaryName(data?.name, "용병"),
      replaces: uid,
      addedBy: uid,
      addedAt: Timestamp.now(),
    };
    const update: DocumentData = { mercenaries: [...mercenaries, mercenary], updatedAt: Timestamp.now() };
    const isLocked = schedule.state === "LOCKED";
    if (isLocked) {
      // 확정 시간은 그대로, 대체한 사람의 일정만 풀어 다른 파티에서 그 시간을 쓸 수 있게 한다.
      const confirmed = schedule.confirmed as Confirmed;
      for (const id of busyIdsOf(confirmed)) {
        tx.delete(db.doc(`users/${uid}/busy/${id}`));
      }
      update["confirmed.memberUids"] = confirmed.memberUids.filter((member) => member !== uid);
    }
    tx.update(scheduleRef, update);
    return isLocked;
  });
  if (!locked) await evaluateSchedule(db, partyId, periodId, nowMs);
  return { mercenaryId };
}

/** 파티장이 이번 주기에만 쓰는 임시 용병을 추가한다. 인원이 한 명 늘어난다(최대 6명). */
export async function addMercenary(db: Firestore, uid: string, data: Data, nowMs: number): Promise<{ mercenaryId: string }> {
  const { partyRef, scheduleRef } = refs(db, data);
  const mercenaryId = newMercenaryId();

  await db.runTransaction(async (tx) => {
    const [partySnap, scheduleSnap] = await Promise.all([tx.get(partyRef), tx.get(scheduleRef)]);
    const party = partySnap.data();
    const schedule = scheduleSnap.data();
    if (!party || !schedule || party.leaderUid !== uid) {
      throw new HttpsError("permission-denied", "파티장만 임시 용병을 추가할 수 있습니다.", { reason: "not-leader" });
    }
    assertEditable(schedule, nowMs);
    const mercenaries = mercenariesOf(schedule);
    if (((party.memberUids as string[]) ?? []).length + extraMercenaryCount(mercenaries) >= MAX_PARTY_SIZE) {
      throw new HttpsError("failed-precondition", `파티 인원이 가득 찼습니다(최대 ${MAX_PARTY_SIZE}명).`, { reason: "full" });
    }
    const mercenary: Mercenary = {
      id: mercenaryId,
      name: cleanMercenaryName(data?.name, nextMercenaryName(mercenaries)),
      replaces: null,
      addedBy: uid,
      addedAt: Timestamp.now(),
    };
    tx.update(scheduleRef, { mercenaries: [...mercenaries, mercenary], updatedAt: Timestamp.now() });
  });
  return { mercenaryId };
}

/**
 * 용병을 뺀다.
 * - 대체 용병: 대체한 본인만, 확정 전에만(대체 취소). 그 사람이 다시 참여하므로 추천을 다시 계산한다.
 * - 임시 용병: 파티장만, 레이드 시작 전까지.
 */
export async function removeMercenary(db: Firestore, uid: string, data: Data, nowMs: number): Promise<void> {
  const { partyId, periodId, partyRef, scheduleRef } = refs(db, data);
  const mercenaryId = requireString(data, "mercenaryId");

  const rejoined = await db.runTransaction(async (tx) => {
    const [partySnap, scheduleSnap] = await Promise.all([tx.get(partyRef), tx.get(scheduleRef)]);
    const party = partySnap.data();
    const schedule = scheduleSnap.data();
    if (!party || !schedule || !((party.memberUids as string[] | undefined) ?? []).includes(uid)) {
      throw new HttpsError("permission-denied", "가입한 파티가 아닙니다.", { reason: "not-member" });
    }
    const mercenaries = mercenariesOf(schedule);
    const target = mercenaries.find((merc) => merc.id === mercenaryId);
    if (!target) throw new HttpsError("not-found", "용병을 찾을 수 없습니다.", { reason: "not-found" });

    if (target.replaces) {
      if (target.replaces !== uid) {
        throw new HttpsError("permission-denied", "대체한 본인만 대체를 취소할 수 있습니다.", { reason: "not-yours" });
      }
      if (!canCancelReplacement(schedule.state as string)) {
        throw new HttpsError("failed-precondition", "확정된 뒤에는 대체를 취소할 수 없습니다. 일정 변경 요청을 이용해 주세요.", {
          reason: "locked",
        });
      }
    } else {
      if (party.leaderUid !== uid) {
        throw new HttpsError("permission-denied", "파티장만 임시 용병을 뺄 수 있습니다.", { reason: "not-leader" });
      }
      assertEditable(schedule, nowMs);
    }
    tx.update(scheduleRef, {
      mercenaries: mercenaries.filter((merc) => merc.id !== mercenaryId),
      updatedAt: Timestamp.now(),
    });
    return target.replaces !== null;
  });
  if (rejoined) await evaluateSchedule(db, partyId, periodId, nowMs);
}
