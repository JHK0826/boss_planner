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
  collection,
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
import { auth, db, functions } from "../firebase";
import type {
  BossCatalog,
  CharacterInfo,
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
    default:
      return "로그인하지 못했습니다. 잠시 후 다시 시도해 주세요.";
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
 * 일정은 이번 주기와 바로 전 주기 두 개만 읽고, 불가 시간·투표·분배금 구독은 지켜볼 대상이 바뀔 때만 다시 붙인다.
 */
export const partySnapshot = (partyId: string): Subscribe<PartySnapshot> =>
  withDetails(
    recentSchedules(partyId, 2),
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

// ---------- 고정 불가 시간 ----------

/** 매주 반복되는 안 되는 시간. 칸은 "D{요일}-{HHmm}" (본인만 읽는 users/{uid}/private/routine) */
export async function loadRoutine(uid: string): Promise<Set<string>> {
  const snapshot = await getDoc(doc(db, "users", uid, "private", "routine"));
  return new Set((snapshot.get("slots") as string[] | undefined) ?? []);
}

export const saveRoutine = (uid: string, slots: Set<string>) =>
  setDoc(doc(db, "users", uid, "private", "routine"), { slots: [...slots].sort(), updatedAt: serverTimestamp() });
