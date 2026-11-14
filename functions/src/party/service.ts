import { randomInt } from "node:crypto";
import { FieldValue, Timestamp, type DocumentData, type DocumentSnapshot, type Firestore } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/v2/https";
import type { SecretCharacter } from "../characters";
import {
  MAX_BOSSES_PER_PARTY,
  MINUTES_PER_BOSS,
  bossesOf,
  validateBossSelection,
  type PartyBoss,
} from "../domain/bosses";
import { currentPeriod, isCycleStartDay, startOfKstDay, type Cycle } from "../domain/time";
import { evaluateSchedule } from "../schedule/evaluate";
import {
  DEFAULT_MIN_LEAD_MINUTES,
  durationMinutesOf,
  newScheduleData,
  slotsForMinutes,
  type PreferredWindow,
} from "../schedule/model";

export const MAX_PARTY_SIZE = 6;
export const MAX_DURATION_MINUTES = MAX_BOSSES_PER_PARTY * MINUTES_PER_BOSS;

const BOSS_ERRORS: Record<string, string> = {
  empty: "보스를 하나 이상 골라 주세요.",
  "too-many": `한 파티에 묶을 수 있는 보스는 ${MAX_BOSSES_PER_PARTY}개까지입니다.`,
  "unknown-boss": "파티로 갈 수 없는 보스가 들어 있습니다.",
  "bad-difficulty": "보스에 없는 난이도입니다.",
  duplicate: "같은 보스를 두 번 넣을 수 없습니다.",
  "mixed-cycle": "주간 보스와 월간 보스는 한 파티에 묶을 수 없습니다.",
};
/** 헷갈리는 글자(0/O, 1/I)를 뺀 초대 코드 문자 */
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 6;

type Data = Record<string, unknown> | undefined | null;

function text(data: Data, field: string, max: number): string {
  const value = typeof data?.[field] === "string" ? (data[field] as string).trim() : "";
  if (value.length < 1 || value.length > max) {
    throw new HttpsError("invalid-argument", `${field} 값이 올바르지 않습니다.`, { field });
  }
  return value;
}

function generateInviteCode(): string {
  return Array.from({ length: CODE_LENGTH }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join("");
}

/** 파티에 넣을 캐릭터가 내 계정의 캐릭터인지 확인하고 표시용 정보를 만든다. */
async function loadMember(db: Firestore, uid: string, characterId: string): Promise<DocumentData> {
  const [secretSnap, userSnap] = await Promise.all([db.doc(`secrets/${uid}`).get(), db.doc(`users/${uid}`).get()]);
  const character = (secretSnap.get("characters") as Record<string, SecretCharacter> | undefined)?.[characterId];
  if (!character) {
    throw new HttpsError("failed-precondition", "내 계정의 캐릭터가 아닙니다. 캐릭터를 다시 선택해 주세요.", {
      reason: "character-not-found",
    });
  }
  return {
    displayName: (userSnap.get("displayName") as string | undefined) ?? "",
    characterId,
    characterName: character.name,
    job: character.job,
    level: character.level,
    world: character.world,
    joinedAt: Timestamp.now(),
  };
}

/**
 * 같은 캐릭터가 같은 보스를 두 파티에서 잡지 못하게 막는다. 보스는 캐릭터당 주기에 한 번만
 * 클리어할 수 있으므로 난이도가 달라도 같은 보스로 본다.
 * (예: 발드릭스+벨로나 묶음 파티에 넣은 캐릭터는 벨로나 파티를 또 만들거나 가입할 수 없다.)
 */
async function assertNoBossOverlap(
  db: Firestore,
  uid: string,
  characterId: string,
  bosses: PartyBoss[],
  exceptPartyId: string | null,
): Promise<void> {
  const names = new Set(bosses.map((boss) => boss.name));
  const mine = await db.collection("parties").where("memberUids", "array-contains", uid).get();
  for (const party of mine.docs) {
    if (party.id === exceptPartyId || party.get(`members.${uid}.characterId`) !== characterId) continue;
    const overlap = bossesOf(party.data()).map((boss) => boss.name).filter((name) => names.has(name));
    if (overlap.length > 0) {
      throw new HttpsError(
        "failed-precondition",
        `이 캐릭터는 이미 '${party.get("name") as string}' 파티에서 ${overlap.join(", ")}을(를) 잡습니다. 같은 보스를 두 파티에서 잡을 수 없습니다.`,
        { reason: "duplicate-boss", bosses: overlap, partyId: party.id },
      );
    }
  }
}

/**
 * 파티 구성 변경(가입·탈퇴·위임)이 가능한 때인지 검사한다.
 *
 * - 아직 첫 주기가 시작되지 않은 새 파티는 언제든 가능하다.
 * - 그 밖에는 주기 시작일(주간: 목요일, 월간: 1일)에만 가능하다.
 * - 가입·탈퇴는 이번 주기 일정이 확정되기 전(OPEN)이거나 미사용(SKIPPED)일 때만 가능하다.
 */
function assertMembershipWindow(
  party: DocumentData,
  schedule: DocumentSnapshot | null,
  nowMs: number,
  changesMembers: boolean,
): void {
  if (party.scheduleStarted !== true) return;
  if (!isCycleStartDay(party.cycle as Cycle, nowMs)) {
    throw new HttpsError(
      "failed-precondition",
      party.cycle === "WEEKLY"
        ? "가입·탈퇴·위임은 주기가 시작하는 목요일에만 할 수 있습니다."
        : "가입·탈퇴·위임은 주기가 시작하는 매월 1일에만 할 수 있습니다.",
      { reason: "not-start-day" },
    );
  }
  const state = schedule?.get("state") as string | undefined;
  if (changesMembers && state !== undefined && state !== "OPEN" && state !== "SKIPPED") {
    throw new HttpsError("failed-precondition", "이번 주기 일정이 이미 확정되어 파티 구성을 바꿀 수 없습니다.", {
      reason: "schedule-not-open",
    });
  }
}

/** 최소 여유 시간으로 받을 수 있는 최대값: 2일 */
const MAX_LEAD_MINUTES = 48 * 60;

/**
 * 추천 설정을 검사한다.
 * - preferredWindow: 선호 시간대. null이면 없음. 요일(1=월~7=일)과 하루 안의 30분 칸 범위
 * - minLeadMinutes: 최소 여유 시간(분). 30분 단위, 0~2일
 * 요청에 없는 항목은 결과에도 넣지 않는다.
 */
function parsePreferences(data: Data): { preferredWindow?: PreferredWindow | null; minLeadMinutes?: number } {
  const result: { preferredWindow?: PreferredWindow | null; minLeadMinutes?: number } = {};

  const window = data?.preferredWindow;
  if (window === null) {
    result.preferredWindow = null;
  } else if (window !== undefined) {
    const { days, startRow, endRow } = window as Record<string, unknown>;
    const validDays =
      Array.isArray(days) &&
      days.length > 0 &&
      days.every((day) => Number.isInteger(day) && day >= 1 && day <= 7) &&
      new Set(days).size === days.length;
    const validRows =
      Number.isInteger(startRow) && Number.isInteger(endRow) && (startRow as number) >= 0 && (endRow as number) <= 48 && (startRow as number) < (endRow as number);
    if (!validDays || !validRows) {
      throw new HttpsError("invalid-argument", "선호 시간대가 올바르지 않습니다.", { field: "preferredWindow" });
    }
    result.preferredWindow = {
      days: [...(days as number[])].sort((a, b) => a - b),
      startRow: startRow as number,
      endRow: endRow as number,
    };
  }

  const lead = data?.minLeadMinutes;
  if (lead !== undefined) {
    if (typeof lead !== "number" || !Number.isInteger(lead) || lead < 0 || lead > MAX_LEAD_MINUTES || lead % 30 !== 0) {
      throw new HttpsError("invalid-argument", "최소 여유 시간은 30분 단위로 0~48시간이어야 합니다.", {
        field: "minLeadMinutes",
      });
    }
    result.minLeadMinutes = lead;
  }
  return result;
}

export interface CreatePartyResult {
  partyId: string;
  inviteCode: string;
}

export async function createParty(db: Firestore, uid: string, data: Data, nowMs: number): Promise<CreatePartyResult> {
  const name = text(data, "name", 20);
  const characterId = text(data, "characterId", 64);
  const durationMinutes = data?.durationMinutes;

  const selection = validateBossSelection(data?.bosses);
  if (!selection.ok) {
    throw new HttpsError("invalid-argument", BOSS_ERRORS[selection.reason], { field: "bosses", reason: selection.reason });
  }
  const { bosses, cycle } = selection;
  if (
    typeof durationMinutes !== "number" ||
    !Number.isInteger(durationMinutes) ||
    durationMinutes % 10 !== 0 ||
    durationMinutes < MINUTES_PER_BOSS ||
    durationMinutes > MAX_DURATION_MINUTES
  ) {
    throw new HttpsError(
      "invalid-argument",
      `소요 시간은 10분 단위로 ${MINUTES_PER_BOSS}~${MAX_DURATION_MINUTES}분이어야 합니다.`,
      { field: "durationMinutes" },
    );
  }

  const preferences = parsePreferences(data);
  const member = await loadMember(db, uid, characterId);
  await assertNoBossOverlap(db, uid, characterId, bosses, null);
  const startsNow = isCycleStartDay(cycle, nowMs);
  const period = currentPeriod(cycle, nowMs);
  const partyRef = db.collection("parties").doc();

  for (let attempt = 0; attempt < 5; attempt++) {
    const inviteCode = generateInviteCode();
    const codeRef = db.doc(`inviteCodes/${inviteCode}`);
    const created = await db.runTransaction(async (tx) => {
      if ((await tx.get(codeRef)).exists) return false;
      tx.create(codeRef, { partyId: partyRef.id });
      tx.create(partyRef, {
        name,
        bosses,
        cycle,
        durationMinutes,
        durationSlots: slotsForMinutes(durationMinutes),
        preferredWindow: preferences.preferredWindow ?? null,
        minLeadMinutes: preferences.minLeadMinutes ?? DEFAULT_MIN_LEAD_MINUTES,
        leaderUid: uid,
        memberUids: [uid],
        members: { [uid]: member },
        inviteCode,
        // 주기 시작일에 만든 파티는 바로 이번 주기 일정을 연다. 아니면 다음 주기부터 시작한다.
        scheduleStarted: startsNow,
        createdAt: Timestamp.now(),
      });
      if (startsNow) tx.create(partyRef.collection("schedules").doc(period.id), newScheduleData(period, durationMinutes));
      return true;
    });
    if (created) return { partyId: partyRef.id, inviteCode };
  }
  throw new HttpsError("unavailable", "초대 코드를 만들지 못했습니다. 다시 시도해 주세요.");
}

export async function joinParty(db: Firestore, uid: string, data: Data, nowMs: number): Promise<{ partyId: string }> {
  const inviteCode = text(data, "inviteCode", CODE_LENGTH).toUpperCase();
  const characterId = text(data, "characterId", 64);

  const codeSnap = /^[A-Z0-9]{6}$/.test(inviteCode) ? await db.doc(`inviteCodes/${inviteCode}`).get() : null;
  const partyId = codeSnap?.get("partyId") as string | undefined;
  if (!partyId) throw new HttpsError("not-found", "초대 코드에 해당하는 파티가 없습니다.", { reason: "bad-code" });

  const member = await loadMember(db, uid, characterId);
  const partyRef = db.doc(`parties/${partyId}`);
  const target = (await partyRef.get()).data();
  if (target) await assertNoBossOverlap(db, uid, characterId, bossesOf(target), partyId);

  const periodId = await db.runTransaction(async (tx) => {
    const partySnap = await tx.get(partyRef);
    const party = partySnap.data();
    if (!party) throw new HttpsError("not-found", "초대 코드에 해당하는 파티가 없습니다.", { reason: "bad-code" });
    const memberUids = party.memberUids as string[];
    if (memberUids.includes(uid)) {
      throw new HttpsError("already-exists", "이미 가입한 파티입니다.", { reason: "already-member" });
    }
    if (memberUids.length >= MAX_PARTY_SIZE) {
      throw new HttpsError("failed-precondition", `파티 정원(${MAX_PARTY_SIZE}명)이 찼습니다.`, { reason: "full" });
    }
    const period = currentPeriod(party.cycle as Cycle, nowMs);
    const scheduleSnap = await tx.get(partyRef.collection("schedules").doc(period.id));
    assertMembershipWindow(party, scheduleSnap, nowMs, true);

    tx.update(partyRef, { memberUids: FieldValue.arrayUnion(uid), [`members.${uid}`]: member });
    return scheduleSnap.exists ? period.id : null;
  });

  // 새 파티원은 아직 제출하지 않았으므로 기존 후보를 비운다.
  if (periodId) await evaluateSchedule(db, partyId, periodId, nowMs);
  return { partyId };
}

export async function leaveParty(db: Firestore, uid: string, data: Data, nowMs: number): Promise<{ deleted: boolean }> {
  const partyId = text(data, "partyId", 64);
  const partyRef = db.doc(`parties/${partyId}`);

  const outcome = await db.runTransaction(async (tx) => {
    const party = (await tx.get(partyRef)).data();
    const memberUids = (party?.memberUids as string[] | undefined) ?? [];
    if (!party || !memberUids.includes(uid)) {
      throw new HttpsError("permission-denied", "가입한 파티가 아닙니다.", { reason: "not-member" });
    }
    const period = currentPeriod(party.cycle as Cycle, nowMs);
    const scheduleRef = partyRef.collection("schedules").doc(period.id);
    const scheduleSnap = await tx.get(scheduleRef);
    assertMembershipWindow(party, scheduleSnap, nowMs, true);

    if (party.leaderUid === uid) {
      if (memberUids.length > 1) {
        throw new HttpsError("failed-precondition", "파티장은 먼저 다른 파티원에게 파티장을 위임해야 탈퇴할 수 있습니다.", {
          reason: "leader-must-delegate",
        });
      }
      // 마지막 한 명이 나가면 파티를 없앤다. 초대 코드는 여기서 지우고 나머지는 아래에서 지운다.
      tx.delete(db.doc(`inviteCodes/${party.inviteCode as string}`));
      tx.delete(partyRef);
      return { deleted: true, periodId: null };
    }

    tx.update(partyRef, { memberUids: FieldValue.arrayRemove(uid), [`members.${uid}`]: FieldValue.delete() });
    if (scheduleSnap.get("state") === "OPEN") {
      tx.delete(scheduleRef.collection("unavailable").doc(uid));
      tx.delete(scheduleRef.collection("votes").doc(uid));
    }
    return { deleted: false, periodId: scheduleSnap.exists ? period.id : null };
  });

  if (outcome.deleted) await db.recursiveDelete(partyRef);
  // 남은 파티원이 모두 제출한 상태면 바로 후보를 다시 계산한다.
  else if (outcome.periodId) await evaluateSchedule(db, partyId, outcome.periodId, nowMs);
  return { deleted: outcome.deleted };
}

export async function delegateLeader(db: Firestore, uid: string, data: Data, nowMs: number): Promise<void> {
  const partyId = text(data, "partyId", 64);
  const newLeaderUid = text(data, "newLeaderUid", 128);
  const partyRef = db.doc(`parties/${partyId}`);

  await db.runTransaction(async (tx) => {
    const party = (await tx.get(partyRef)).data();
    if (!party || party.leaderUid !== uid) {
      throw new HttpsError("permission-denied", "파티장만 위임할 수 있습니다.", { reason: "not-leader" });
    }
    if (newLeaderUid === uid || !(party.memberUids as string[]).includes(newLeaderUid)) {
      throw new HttpsError("invalid-argument", "다른 파티원에게만 위임할 수 있습니다.", { reason: "not-member" });
    }
    assertMembershipWindow(party, null, nowMs, false);
    tx.update(partyRef, { leaderUid: newLeaderUid });
  });
}

/**
 * 파티장이 추천 설정(선호 시간대, 최소 여유 시간)을 바꾼다.
 * 이번 주기 일정이 아직 조율 중이면 새 설정으로 후보를 다시 계산한다(투표도 다시 한다).
 */
export async function updatePartyPreferences(db: Firestore, uid: string, data: Data, nowMs: number): Promise<void> {
  const partyId = text(data, "partyId", 64);
  const preferences = parsePreferences(data);
  if (Object.keys(preferences).length === 0) {
    throw new HttpsError("invalid-argument", "바꿀 설정이 없습니다.");
  }
  const partyRef = db.doc(`parties/${partyId}`);

  const cycle = await db.runTransaction(async (tx) => {
    const party = (await tx.get(partyRef)).data();
    if (!party || party.leaderUid !== uid) {
      throw new HttpsError("permission-denied", "파티장만 추천 설정을 바꿀 수 있습니다.", { reason: "not-leader" });
    }
    tx.update(partyRef, preferences);
    return party.cycle as Cycle;
  });

  await evaluateSchedule(db, partyId, currentPeriod(cycle, nowMs).id, nowMs);
}

/**
 * 파티장이 이번 주기 일정을 지금 연다.
 *
 * 주기 시작일이 아닌 날에 만든 파티는 원래 다음 주기부터 시작한다. 파티원을 다 모은 뒤 이 함수를 부르면
 * 남은 기간(주간은 다음 수요일까지) 안에서 바로 조율할 수 있다.
 * - 입력 마감은 시작한 날 23:59다.
 * - 일정이 열리면 그 뒤로는 가입·탈퇴가 주기 시작일로 제한된다.
 */
export async function startSchedule(db: Firestore, uid: string, data: Data, nowMs: number): Promise<{ periodId: string }> {
  const partyId = text(data, "partyId", 64);
  const partyRef = db.doc(`parties/${partyId}`);

  return db.runTransaction(async (tx) => {
    const party = (await tx.get(partyRef)).data();
    if (!party || party.leaderUid !== uid) {
      throw new HttpsError("permission-denied", "파티장만 일정을 시작할 수 있습니다.", { reason: "not-leader" });
    }
    const period = currentPeriod(party.cycle as Cycle, nowMs);
    const scheduleRef = partyRef.collection("schedules").doc(period.id);
    if ((await tx.get(scheduleRef)).exists) {
      throw new HttpsError("already-exists", "이번 주기 일정이 이미 열려 있습니다.", { reason: "already-started" });
    }
    const durationMinutes = durationMinutesOf(party);
    if (nowMs + durationMinutes * 60 * 1000 > period.endMs) {
      throw new HttpsError("failed-precondition", "이번 주기에 남은 시간이 없습니다. 다음 주기에 자동으로 시작됩니다.", {
        reason: "no-time-left",
      });
    }
    const endOfToday = startOfKstDay(nowMs) + 24 * 60 * 60 * 1000;
    tx.create(scheduleRef, newScheduleData(period, durationMinutes, Math.min(endOfToday, period.endMs)));
    tx.update(partyRef, { scheduleStarted: true });
    return { periodId: period.id };
  });
}
