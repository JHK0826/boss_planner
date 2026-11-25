// Firebase 읽기·쓰기. Android 앱의 data/*Repository.kt와 같은 문서·callable을 쓴다.
import { FirebaseError } from "firebase/app";
import {
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signOut as firebaseSignOut,
} from "firebase/auth";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  documentId,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  type Query,
  type QuerySnapshot,
  serverTimestamp,
  setDoc,
  startAt,
  where,
} from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { getDownloadURL, ref as storageRef, uploadBytes } from "firebase/storage";
import { auth, db, functions, storage } from "../firebase";
import type {
  BossCatalog,
  ChatMessage,
  CharacterInfo,
  CharacterScheduler,
  EarningsRecord,
  CharacterSummary,
  Party,
  PartyBoss,
  PreferredWindow,
  Raid,
  Schedule,
  SettlementEntry,
  Unavailable,
  UserProfile,
  Vote,
} from "../lib/model";
import { acceptsInput } from "../lib/model";
import { millis, toBosses, toParty, toSchedule } from "../lib/parse";
import { type PartySnapshot, sameTargets, snapshotTargets } from "../lib/partyStatus";
import { combineAll, constant, type Subscribe, withDetails } from "../lib/subscribe";
import { slotId } from "../lib/time";

// ---------- 공통 ----------

async function call<T = Record<string, unknown>>(name: string, data: Record<string, unknown>): Promise<T> {
  const result = await httpsCallable(functions, name)(data);
  return (result.data ?? {}) as T;
}

/** 쿼리 실시간 구독. 권한 오류 등으로 끊기면 예외 대신 fallback 값을 낸다 (무한 로딩 방지). */
function listen<T>(q: Query, fallback: T, transform: (snapshot: QuerySnapshot) => T): Subscribe<T> {
  return (onValue) => onSnapshot(q, (snapshot) => onValue(transform(snapshot)), () => onValue(fallback));
}

/** 서버가 보낸 한국어 메시지를 그대로 쓰고, 그 밖의 오류는 일반 문구로 바꾼다. */
export function userMessage(error: unknown): string {
  if (error instanceof FirebaseError && error.code.startsWith("functions/") && error.code !== "functions/internal" && error.message) {
    // 웹 SDK는 문구 끝에 HTTP 상태 번호를 붙인다("… [404]"). 서버가 보낸 문구만 보여 준다.
    return error.message.replace(/\s*\[\d{3}\]$/, "");
  }
  if (error instanceof Error && error.name === "UserFacingError") return error.message;
  return "요청을 처리하지 못했습니다. 네트워크 상태를 확인하고 다시 시도해 주세요.";
}

const scheduleCol = (partyId: string) => collection(db, "parties", partyId, "schedules");
const scheduleDoc = (partyId: string, periodId: string) => doc(db, "parties", partyId, "schedules", periodId);

// ---------- 인증 ----------

export const onAuth = (callback: (uid: string | null) => void) => onAuthStateChanged(auth, (user) => callback(user?.uid ?? null));

export async function signIn(email: string, password: string) {
  await signInWithEmailAndPassword(auth, email, password);
}

export async function signUp(email: string, password: string, displayName: string) {
  const { user } = await createUserWithEmailAndPassword(auth, email, password);
  await setDoc(doc(db, "users", user.uid), { displayName }, { merge: true });
}

export const signOut = () => firebaseSignOut(auth);
export const resetPassword = (email: string) => sendPasswordResetEmail(auth, email);

export function authErrorMessage(error: unknown): string {
  const code = error instanceof FirebaseError ? error.code : "";
  switch (code) {
    case "auth/weak-password":
      return "비밀번호는 6자 이상이어야 합니다.";
    case "auth/email-already-in-use":
      return "이미 가입된 이메일입니다.";
    case "auth/invalid-email":
      return "이메일 형식이 올바르지 않습니다.";
    case "auth/user-not-found":
      return "가입되지 않은 이메일입니다.";
    case "auth/wrong-password":
    case "auth/invalid-credential":
      return "이메일 또는 비밀번호가 올바르지 않습니다.";
    case "auth/too-many-requests":
      return "시도가 너무 많습니다. 잠시 후 다시 시도해 주세요.";
    case "auth/network-request-failed":
      return "네트워크에 연결할 수 없습니다.";
    case "auth/user-disabled":
      return "사용이 중지된 계정입니다.";
    case "auth/operation-not-allowed":
      return "이메일 로그인이 꺼져 있습니다. Firebase 콘솔의 Authentication에서 이메일/비밀번호 로그인을 켜 주세요.";
    case "auth/invalid-api-key":
    case "auth/api-key-not-valid.-please-pass-a-valid-api-key.":
      return "웹앱 설정값(API 키)이 올바르지 않습니다. web/.env.local의 값을 확인하고 다시 배포해 주세요.";
    default:
      // 원인을 알 수 있도록 오류 코드를 함께 보여 준다.
      return `로그인하지 못했습니다 (${code || (error instanceof Error ? error.message : "알 수 없는 오류")}). 잠시 후 다시 시도해 주세요.`;
  }
}

// ---------- 사용자·캐릭터 ----------

/** users/{uid} 실시간 구독. 문서가 아직 없으면 빈 프로필을 낸다. */
export const profile =
  (uid: string): Subscribe<UserProfile> =>
  (onValue) =>
    onSnapshot(
      doc(db, "users", uid),
      (snapshot) => {
        const data = snapshot.data() ?? {};
        onValue({
          displayName: typeof data.displayName === "string" ? data.displayName : "",
          apiKeyRegistered: data.apiKeyRegistered === true,
          selectedCharacterIds: Array.isArray(data.selectedCharacterIds) ? data.selectedCharacterIds : [],
        });
      },
      () => onValue({ displayName: "", apiKeyRegistered: false, selectedCharacterIds: [] }),
    );

export const setSelectedCharacters = (uid: string, characterIds: string[]) =>
  setDoc(doc(db, "users", uid), { selectedCharacterIds: characterIds }, { merge: true });

/** getCharacterInfo가 캐시해 둔 캐릭터 기본 정보 (characterIds 순서 유지) */
export async function cachedCharacters(uid: string, characterIds: string[]): Promise<CharacterInfo[]> {
  const snapshot = await getDocs(collection(db, "users", uid, "characters"));
  const byId = new Map(snapshot.docs.map((d) => [d.id, d.data()]));
  return characterIds.flatMap((id) => {
    const data = byId.get(id);
    return data
      ? [{ id, name: data.name ?? "", world: data.world ?? "", job: data.job ?? "", level: data.level ?? 0, imageUrl: data.imageUrl ?? null, guild: data.guild ?? null }]
      : [];
  });
}

const toSummaries = (result: { characters?: CharacterSummary[] }) => result.characters ?? [];

/** API Key는 서버로 한 번 보낸 뒤 이 기기에는 남기지 않는다. */
export const registerApiKey = async (apiKey: string) => toSummaries(await call("registerApiKey", { apiKey }));
export const listCharacters = async (refresh = false) => toSummaries(await call("listCharacters", { refresh }));
export const getCharacterInfo = (characterId: string) => call<CharacterInfo>("getCharacterInfo", { characterId });

// ---------- 파티 ----------

export const myParties = (uid: string): Subscribe<Party[]> =>
  listen(query(collection(db, "parties"), where("memberUids", "array-contains", uid)), [], (snapshot) =>
    snapshot.docs.flatMap((d) => toParty(d.id, d.data()) ?? []).sort((a, b) => a.name.localeCompare(b.name, "ko")),
  );

/** 탈퇴했거나 없어진 파티는 null */
export const party =
  (partyId: string): Subscribe<Party | null> =>
  (onValue) =>
    onSnapshot(
      doc(db, "parties", partyId),
      (snapshot) => onValue(toParty(snapshot.id, snapshot.data())),
      () => onValue(null),
    );

/**
 * 최근 주기의 일정들 (최신순). 첫 번째가 이번 주기다.
 * @param count 파티 화면은 지난 정산을 넉넉히 보려고 5, 파티 목록은 2를 쓴다.
 */
export const recentSchedules = (partyId: string, count = 5): Subscribe<Schedule[]> =>
  listen(query(scheduleCol(partyId), orderBy("periodStart", "desc"), limit(count)), [], (snapshot) =>
    snapshot.docs.flatMap((d) => toSchedule(d.id, d.data()) ?? []),
  );

export const unavailable = (partyId: string, periodId: string): Subscribe<Record<string, Unavailable>> =>
  listen(collection(scheduleDoc(partyId, periodId), "unavailable"), {}, (snapshot) =>
    Object.fromEntries(
      snapshot.docs.map((d) => [d.id, { slots: (d.get("slots") as string[] | undefined) ?? [], submitted: d.get("submitted") === true }]),
    ),
  );

export const votes = (partyId: string, periodId: string): Subscribe<Record<string, Vote>> =>
  listen(collection(scheduleDoc(partyId, periodId), "votes"), {}, (snapshot) =>
    Object.fromEntries(snapshot.docs.map((d) => [d.id, { agreed: (d.get("agreed") as number[] | undefined) ?? [], round: d.get("round") ?? 0 }])),
  );

export const settlementEntries = (partyId: string, periodId: string): Subscribe<SettlementEntry[]> =>
  listen(collection(scheduleDoc(partyId, periodId), "settlement"), [], (snapshot) =>
    snapshot.docs.map((d) => ({ uid: d.id, amount: d.get("amount") ?? 0, status: d.get("status") ?? "PENDING" })),
  );

/**
 * 파티 목록의 상태 표시에 필요한 일정 데이터 (Android PartyRepository.partySnapshot과 같음).
 * 일정은 최근 세 개(미리 연 다음 주, 이번 주, 지난 주)만 읽고, 불가 시간·투표·분배금 구독은 지켜볼 대상이 바뀔 때만 다시 붙인다.
 */
export const partySnapshot = (partyId: string): Subscribe<PartySnapshot> =>
  withDetails(
    recentSchedules(partyId, 3),
    snapshotTargets,
    sameTargets,
    (targets) => {
      const details: Subscribe<unknown>[] = [
        targets.inputPeriod ? unavailable(partyId, targets.inputPeriod) : constant({}),
        targets.votePeriod ? votes(partyId, targets.votePeriod) : constant({}),
        combineAll(targets.settlementPeriods.map((id) => (onValue: (v: [string, SettlementEntry[]]) => void) =>
          settlementEntries(partyId, id)((entries) => onValue([id, entries])),
        )) as Subscribe<unknown>,
      ];
      return combineAll(details);
    },
    (schedules, [u, v, s]) => ({
      schedules,
      unavailable: u as Record<string, Unavailable>,
      votes: v as Record<string, Vote>,
      settlements: Object.fromEntries(s as [string, SettlementEntry[]][]),
    }),
  );

/**
 * fromMs 이후의 내 확정 일정. busy는 30분 칸마다 문서가 하나씩 있어서 같은 레이드의 칸을 하나로 묶는다.
 */
export const myRaids = (uid: string, fromMs: number): Subscribe<Raid[]> =>
  listen(query(collection(db, "users", uid, "busy"), orderBy(documentId()), startAt(slotId(fromMs))), [], (snapshot) => {
    const raids = new Map<string, Raid>();
    for (const d of snapshot.docs) {
      const data = d.data();
      const start = millis(data.start);
      const end = millis(data.end);
      if (typeof data.partyId !== "string" || start === null || end === null) continue;
      raids.set(`${data.partyId}-${start}`, { partyId: data.partyId, partyName: data.partyName ?? "", bosses: toBosses(data), startMs: start, endMs: end });
    }
    return [...raids.values()].sort((a, b) => a.startMs - b.startMs);
  });

export async function getBossCatalog(): Promise<BossCatalog> {
  const result = await call<{ bosses?: { name: string; difficulties: string[]; cycle: string }[]; minutesPerBoss?: number; maxDurationMinutes?: number }>(
    "getBossCatalog",
    {},
  );
  return {
    bosses: (result.bosses ?? []).map((b) => ({ name: b.name, difficulties: b.difficulties ?? [], monthly: b.cycle === "MONTHLY" })),
    minutesPerBoss: result.minutesPerBoss ?? 20,
    maxDurationMinutes: result.maxDurationMinutes ?? 240,
  };
}

/** 주기(주간/월간)는 고른 보스에 따라 서버가 정한다. @returns 새 파티 ID */
export async function createParty(input: {
  name: string;
  bosses: PartyBoss[];
  durationMinutes: number;
  characterId: string;
  preferredWindow: PreferredWindow | null;
  minLeadMinutes: number;
}): Promise<string> {
  const { preferredWindow, ...rest } = input;
  const result = await call<{ partyId?: string }>("createParty", preferredWindow ? { ...rest, preferredWindow } : rest);
  return result.partyId ?? "";
}

/** @returns 가입한 파티 ID */
export async function joinParty(inviteCode: string, characterId: string): Promise<string> {
  const result = await call<{ partyId?: string }>("joinParty", { inviteCode, characterId });
  return result.partyId ?? "";
}

// ---------- 일정 (파티 화면) ----------

/** 파티의 가장 최근 일정을 한 번만 읽는다. 없으면 null */
export async function latestScheduleOnce(partyId: string): Promise<Schedule | null> {
  const snapshot = await getDocs(query(scheduleCol(partyId), orderBy("periodStart", "desc"), limit(1)));
  const first = snapshot.docs[0];
  return first ? toSchedule(first.id, first.data()) : null;
}

/** 일정 하나를 한 번만 읽는다. 없으면 null */
export async function scheduleOnce(partyId: string, periodId: string): Promise<Schedule | null> {
  const snapshot = await getDoc(scheduleDoc(partyId, periodId));
  return toSchedule(snapshot.id, snapshot.data());
}

/** 이번 주기 내 불가 시간을 한 번만 읽는다. 아직 저장한 적이 없으면 null */
export async function myUnavailableOnce(partyId: string, periodId: string, uid: string): Promise<Unavailable | null> {
  const snapshot = await getDoc(doc(scheduleDoc(partyId, periodId), "unavailable", uid));
  if (!snapshot.exists()) return null;
  return { slots: (snapshot.get("slots") as string[] | undefined) ?? [], submitted: snapshot.get("submitted") === true };
}

export const setUnavailable = (partyId: string, periodId: string, uid: string, slots: string[], submitted: boolean) =>
  setDoc(doc(scheduleDoc(partyId, periodId), "unavailable", uid), { slots: [...slots].sort(), submitted, updatedAt: serverTimestamp() });

export const setVote = (partyId: string, periodId: string, uid: string, agreed: number[], round: number) =>
  setDoc(doc(scheduleDoc(partyId, periodId), "votes", uid), { agreed: [...agreed].sort((a, b) => a - b), round, updatedAt: serverTimestamp() });

/** 레이드가 끝난 뒤 결과를 직접 기록한다. 서버가 바로 SETTLED / RETRY / EXPIRED로 넘긴다. */
export const recordClear = (partyId: string, periodId: string, uid: string, cleared: boolean) =>
  setDoc(doc(scheduleDoc(partyId, periodId), "clears", uid), { result: cleared ? "CLEARED" : "NOT_CLEARED", recordedAt: serverTimestamp() });

/** 파티장이 전원 동의 후보를 확정한다. 다른 파티 일정과 겹치면 서버가 거절한다. */
export const confirmSchedule = (partyId: string, periodId: string, candidateIndex: number) =>
  call("confirmSchedule", { partyId, periodId, candidateIndex });

export const requestChange = (partyId: string, periodId: string, reason: string) => call("requestChange", { partyId, periodId, reason });

export const respondToChange = (partyId: string, periodId: string, approve: boolean) => call("approveChange", { partyId, periodId, approve });

/** 파티장이 다음 주기를 기다리지 않고 이번 주기 일정을 지금 연다. */
export const startSchedule = (partyId: string) => call("startSchedule", { partyId });

/** 파티장이 추천 설정을 바꾼다. 선호 시간대를 없앨 때는 null을 보낸다. 조율 중이면 서버가 후보를 다시 계산한다. */
export const updatePartyPreferences = (partyId: string, preferredWindow: PreferredWindow | null, minLeadMinutes: number) =>
  call("updatePartyPreferences", { partyId, preferredWindow, minLeadMinutes });

export const leaveParty = (partyId: string) => call("leaveParty", { partyId });

export const delegateLeader = (partyId: string, newLeaderUid: string) => call("delegateLeader", { partyId, newLeaderUid });

/**
 * 파티원들이 파티에 넣은 캐릭터의 이미지 주소 (uid → 주소).
 * 각자의 캐릭터 정보 캐시(users/{uid}/characters/{characterId})에서 읽는다. 없으면 빠진다.
 */
export async function memberImages(p: Party): Promise<Record<string, string>> {
  const entries = await Promise.all(
    Object.values(p.members).map(async (member): Promise<[string, string] | null> => {
      if (!member.characterId) return null;
      try {
        const url = (await getDoc(doc(db, "users", member.uid, "characters", member.characterId))).get("imageUrl");
        return typeof url === "string" && url ? [member.uid, url] : null;
      } catch {
        return null;
      }
    }),
  );
  return Object.fromEntries(entries.filter((e): e is [string, string] => e !== null));
}

/**
 * 같은 주기에 입력을 받고 있는 내 다른 파티에도 같은 불가 시간을 제출하고, 제출한 파티 수를 돌려준다.
 * 주기가 다른 파티(주간 ↔ 월간)나 이미 확정된 파티는 건너뛴다. 한 파티가 실패해도 나머지는 계속한다.
 */
export async function submitToOtherParties(
  otherParties: Party[],
  period: { periodStartMs: number; periodEndMs: number },
  uid: string,
  slots: string[],
): Promise<number> {
  let submitted = 0;
  for (const other of otherParties) {
    try {
      const schedule = await latestScheduleOnce(other.id);
      if (!schedule) continue;
      const samePeriod = schedule.periodStartMs === period.periodStartMs && schedule.periodEndMs === period.periodEndMs;
      if (acceptsInput(schedule) && samePeriod) {
        await setUnavailable(other.id, schedule.id, uid, slots, true);
        submitted++;
      }
    } catch {
      // 이 파티는 건너뛴다. 그 파티 화면에서 따로 제출할 수 있다.
    }
  }
  return submitted;
}

// ---------- 정산·채팅 ----------

/** 일정 하나 실시간 구독. 없거나 읽을 수 없으면 null */
export const schedule =
  (partyId: string, periodId: string): Subscribe<Schedule | null> =>
  (onValue) =>
    onSnapshot(
      scheduleDoc(partyId, periodId),
      (snapshot) => onValue(toSchedule(snapshot.id, snapshot.data())),
      () => onValue(null),
    );

export const messages = (partyId: string, periodId: string): Subscribe<ChatMessage[]> =>
  listen(query(collection(scheduleDoc(partyId, periodId), "messages"), orderBy("createdAt")), [], (snapshot) =>
    snapshot.docs.map((d) => ({
      id: d.id,
      senderUid: d.get("senderUid") ?? "",
      text: d.get("text") ?? "",
      // 방금 보낸 메시지는 서버 시각이 아직 없어서 추정값을 쓴다.
      createdAtMs: millis(d.get("createdAt", { serverTimestamps: "estimate" })) ?? 0,
      imageUrl: typeof d.get("imageUrl") === "string" ? d.get("imageUrl") : null,
    })),
  );

export const sendMessage = (partyId: string, periodId: string, uid: string, text: string, imageUrl: string | null = null) =>
  addDoc(collection(scheduleDoc(partyId, periodId), "messages"), {
    senderUid: uid,
    text,
    createdAt: serverTimestamp(),
    ...(imageUrl ? { imageUrl } : {}),
  });

/**
 * 채팅에 첨부할 이미지를 Firebase Storage에 올리고 내려받기 주소를 돌려준다.
 * 경로는 storage.rules와 맞춰야 한다: 파티원만 읽고, 자기 폴더에만 올릴 수 있다.
 */
export async function uploadChatImage(partyId: string, periodId: string, uid: string, jpeg: Blob): Promise<string> {
  const target = storageRef(storage, `parties/${partyId}/schedules/${periodId}/chat/${uid}/${crypto.randomUUID()}.jpg`);
  await uploadBytes(target, jpeg, { contentType: "image/jpeg" });
  return getDownloadURL(target);
}

/**
 * 경매장 판매액과 수수료로 분배금을 등록한다. 파티원별 정산금은 서버가 계산한다.
 * @param weights 실수령 기준 분배 비율 (uid → 1~100). 비어 있으면 전원 같은 몫
 */
export const registerSettlement = (partyId: string, periodId: string, saleAmount: number, feePercent: number, weights: Record<string, number>) =>
  call("registerSettlement", { partyId, periodId, saleAmount, feePercent, weights });

export const markPaid = (partyId: string, periodId: string, recipientUid: string) => call("markPaid", { partyId, periodId, recipientUid });

export const confirmReceived = (partyId: string, periodId: string) => call("confirmReceived", { partyId, periodId });

// ---------- 보스 스케줄러·수익 ----------

/** 골라 둔 캐릭터마다 게임 스케줄러에 등록한 보스. 서버가 10분 동안 저장해 두고, refresh면 1분이 지났을 때 다시 받는다. */
export async function getSchedulerState(refresh = false): Promise<Record<string, CharacterScheduler>> {
  const result = await call<{ characters?: Record<string, CharacterScheduler> }>("getSchedulerState", { refresh });
  return result.characters ?? {};
}

/** 내 수익 기록 전부 (주간 W-…, 월간 M-…). 한 해에 60개 남짓이라 통째로 구독한다. */
export const earnings = (uid: string): Subscribe<EarningsRecord[]> =>
  listen(collection(db, "users", uid, "earnings"), [], (snapshot) =>
    snapshot.docs.map((d) => {
      const settlements = (d.get("settlements") ?? {}) as Record<string, Record<string, unknown>>;
      return {
        id: d.id,
        characters: (d.get("characters") ?? {}) as EarningsRecord["characters"],
        settlements: Object.fromEntries(
          Object.entries(settlements).map(([key, s]) => [
            key,
            {
              characterId: typeof s.characterId === "string" ? s.characterId : null,
              partyName: typeof s.partyName === "string" ? s.partyName : "",
              amount: typeof s.amount === "number" ? s.amount : 0,
              raidAtMs: millis(s.raidAt) ?? 0,
            },
          ]),
        ),
      };
    }),
  );

// ---------- 알림 기기 ----------

/** 이 기기의 알림 토큰을 users/{uid}/devices/{token}에 저장한다. 토큰을 문서 ID로 써서 두 번 등록되지 않게 한다. */
export const saveDeviceToken = (uid: string, token: string) =>
  setDoc(doc(db, "users", uid, "devices", token), { platform: "web", updatedAt: serverTimestamp() });

export const deleteDeviceToken = (uid: string, token: string) => deleteDoc(doc(db, "users", uid, "devices", token));

// ---------- 고정 불가 시간 ----------

/** 매주 반복되는 안 되는 시간. 칸은 "D{요일}-{HHmm}" (본인만 읽는 users/{uid}/private/routine) */
export async function loadRoutine(uid: string): Promise<Set<string>> {
  const snapshot = await getDoc(doc(db, "users", uid, "private", "routine"));
  return new Set((snapshot.get("slots") as string[] | undefined) ?? []);
}

export const saveRoutine = (uid: string, slots: Set<string>) =>
  setDoc(doc(db, "users", uid, "private", "routine"), { slots: [...slots].sort(), updatedAt: serverTimestamp() });
