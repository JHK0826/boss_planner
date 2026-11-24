// Firestore 문서 → 화면용 타입. Android PartyRepository.toParty/toSchedule과 같은 기본값 규칙을 쓴다.
import type { DocumentData } from "firebase/firestore";
import type {
  ChangeRequest,
  Confirmed,
  Party,
  PartyBoss,
  PartyMember,
  PreferredWindow,
  Schedule,
  Settlement,
} from "./model";

/** Firestore Timestamp(또는 비슷한 값)를 ms로. 아니면 null */
export function millis(value: unknown): number | null {
  if (value && typeof value === "object" && "toMillis" in value && typeof value.toMillis === "function") {
    return value.toMillis() as number;
  }
  return null;
}

const num = (value: unknown): number | null => (typeof value === "number" ? value : null);
const str = (value: unknown): string | null => (typeof value === "string" ? value : null);
const strings = (value: unknown): string[] => (Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : []);
const numbers = (value: unknown): number[] => (Array.isArray(value) ? value.filter((v): v is number => typeof v === "number") : []);

export function toBosses(data: DocumentData): PartyBoss[] {
  if (!Array.isArray(data.bosses)) return [];
  return data.bosses
    .filter((b: unknown): b is DocumentData => !!b && typeof b === "object" && typeof (b as DocumentData).name === "string")
    .map((b: DocumentData) => ({ name: b.name as string, difficulty: str(b.difficulty) ?? "" }));
}

export function toParty(id: string, data: DocumentData | undefined): Party | null {
  if (!data) return null;
  const members: Record<string, PartyMember> = {};
  for (const [uid, value] of Object.entries((data.members ?? {}) as Record<string, DocumentData>)) {
    if (!value || typeof value !== "object") continue;
    members[uid] = {
      uid,
      displayName: str(value.displayName) ?? "",
      characterName: str(value.characterName) ?? "",
      job: str(value.job) ?? "",
      level: num(value.level) ?? 0,
      characterId: str(value.characterId) ?? "",
      joinedAtMs: millis(value.joinedAt) ?? 0,
    };
  }
  const window = data.preferredWindow as DocumentData | null | undefined;
  const preferredWindow: PreferredWindow | null =
    window && num(window.startRow) !== null && num(window.endRow) !== null
      ? { days: numbers(window.days), startRow: window.startRow, endRow: window.endRow }
      : null;
  return {
    id,
    name: str(data.name) ?? "",
    bosses: toBosses(data),
    cycle: data.cycle === "MONTHLY" ? "MONTHLY" : "WEEKLY",
    durationMinutes: num(data.durationMinutes) ?? (num(data.durationSlots) ?? 2) * 30,
    leaderUid: str(data.leaderUid) ?? "",
    memberUids: strings(data.memberUids),
    members,
    inviteCode: str(data.inviteCode) ?? "",
    scheduleStarted: data.scheduleStarted === true,
    preferredWindow,
    // 설정이 없는 예전 파티에는 서버 기본값(3시간)이 적용된다.
    minLeadMinutes: num(data.minLeadMinutes) ?? 180,
  };
}

export function toSchedule(id: string, data: DocumentData | undefined): Schedule | null {
  if (!data) return null;
  const start = millis(data.periodStart);
  const end = millis(data.periodEnd);
  if (start === null || end === null) return null;

  const c = data.confirmed as DocumentData | null | undefined;
  const confirmedStart = c ? millis(c.start) : null;
  const confirmedEnd = c ? millis(c.end) : null;
  const confirmed: Confirmed | null =
    c && confirmedStart !== null && confirmedEnd !== null
      ? { startMs: confirmedStart, endMs: confirmedEnd, memberUids: strings(c.memberUids) }
      : null;

  const r = data.changeRequest as DocumentData | null | undefined;
  const changeRequest: ChangeRequest | null = r
    ? { requestedBy: str(r.requestedBy) ?? "", reason: str(r.reason) ?? "", status: str(r.status) ?? "" }
    : null;

  const m = data.settlement as DocumentData | null | undefined;
  const settlement: Settlement | null =
    m && typeof m.sellerUid === "string"
      ? {
          sellerUid: m.sellerUid,
          saleAmount: num(m.saleAmount),
          feePercent: num(m.feePercent),
          netAmount: num(m.netAmount),
          amountPerPerson: num(m.amountPerPerson),
          completed: m.completed === true,
        }
      : null;

  const candidates = Array.isArray(data.candidates)
    ? data.candidates.flatMap((item: DocumentData) => {
        const s = millis(item?.start);
        const e = millis(item?.end);
        return typeof item?.slotId === "string" && s !== null && e !== null ? [{ slotId: item.slotId, startMs: s, endMs: e }] : [];
      })
    : [];

  return {
    id,
    state: str(data.state) ?? "OPEN",
    periodStartMs: start,
    periodEndMs: end,
    inputDeadlineMs: millis(data.inputDeadline) ?? start,
    durationSlots: num(data.durationSlots) ?? 2,
    round: num(data.round) ?? 0,
    candidates,
    unanimous: numbers(data.unanimous),
    skippedReason: str(data.skippedReason),
    confirmed,
    changeRequest,
    retryCount: num(data.retryCount) ?? 0,
    expiredReason: str(data.expiredReason),
    settlement,
  };
}
