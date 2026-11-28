// Firestore 문서를 화면에서 쓰기 좋게 옮긴 타입. Android 앱(app/.../data/PartyModels.kt, Models.kt)과 같은 구조다.
import {
  MAX_PARTY_SIZE,
  activeMemberUids,
  canCancelReplacement,
  extraMercenaryCount,
  isMercenaryId,
  mercenaryEditable,
  mercenaryLabel,
  replacedUids,
} from "@shared/domain/mercenary";

export interface PartyBoss {
  name: string;
  difficulty: string;
}

export interface PartyMember {
  uid: string;
  displayName: string;
  characterName: string;
  job: string;
  level: number;
  characterId: string;
  /** 이 파티에 가입한 시각. 모르면 0 */
  joinedAtMs: number;
}

/** 파티 선호 시간대: 요일(1=월 ~ 7=일)과 하루 안의 30분 칸 범위 [startRow, endRow) */
export interface PreferredWindow {
  days: number[];
  startRow: number;
  endRow: number;
}

export interface Party {
  id: string;
  name: string;
  bosses: PartyBoss[];
  cycle: "WEEKLY" | "MONTHLY";
  durationMinutes: number;
  leaderUid: string;
  memberUids: string[];
  members: Record<string, PartyMember>;
  inviteCode: string;
  scheduleStarted: boolean;
  preferredWindow: PreferredWindow | null;
  minLeadMinutes: number;
  /** 투표 없이 점수 1위 시간으로 자동 지정 */
  autoAssign: boolean;
}

export interface Candidate {
  slotId: string;
  startMs: number;
  endMs: number;
  /** 추천 점수. 예전 후보에는 없다 */
  score: number | null;
  /** 추천 이유 코드 (lib/recommendReasons.ts가 문구로 바꾼다) */
  reasons: string[];
}

/** memberUids: 확정 당시 파티원 = 이 레이드에 참여한 사람 */
export interface Confirmed {
  startMs: number;
  endMs: number;
  memberUids: string[];
}

export interface ChangeRequest {
  requestedBy: string;
  reason: string;
  status: string;
}

export interface Settlement {
  sellerUid: string;
  saleAmount: number | null;
  feePercent: number | null;
  netAmount: number | null;
  amountPerPerson: number | null;
  completed: boolean;
}

/** 이번 주기 용병. replaces가 있으면 그 파티원을 대체한 용병, null이면 파티장이 추가한 임시 용병 */
export interface Mercenary {
  id: string;
  name: string;
  replaces: string | null;
}

export type ScheduleState = "OPEN" | "LOCKED" | "VERIFYING" | "SETTLED" | "RETRY" | "EXPIRED" | "SKIPPED";

export interface Schedule {
  id: string;
  state: ScheduleState | string;
  periodStartMs: number;
  periodEndMs: number;
  inputDeadlineMs: number;
  durationSlots: number;
  /** 후보가 바뀔 때마다 오른다. 투표는 같은 round일 때만 유효하다. */
  round: number;
  candidates: Candidate[];
  /** 전원이 동의한 후보 번호 */
  unanimous: number[];
  skippedReason: string | null;
  confirmed: Confirmed | null;
  changeRequest: ChangeRequest | null;
  retryCount: number;
  expiredReason: string | null;
  settlement: Settlement | null;
  mercenaries: Mercenary[];
  /** 후보를 고른 방식: VOTE(투표) 또는 AUTO(투표 없이 자동 지정, 후보는 점수순) */
  assignMode: "VOTE" | "AUTO";
  /** 누가 확정했는가: LEADER(파티장) 또는 AUTO(자동 지정). 확정 전이면 null */
  confirmedBy: string | null;
  /** 투표 없이 자동 지정: 같은 파티원이 있는, 우선순위가 더 높은 다른 자동 지정 파티를 기다리며 확정을 미룬 시각. 아니면 null */
  autoDeferredAtMs: number | null;
}

/** 투표 없이 자동 지정하는 일정 (후보가 점수순 순위다) */
export const isAutoAssigned = (schedule: Schedule | null | undefined): boolean => schedule?.assignMode === "AUTO";

/** 그 주기에 참여하는 파티원 (용병으로 대체한 사람 제외). 일정이 없으면 파티원 전원 */
export const participantUids = (party: Party, schedule: Schedule | null | undefined): string[] =>
  schedule ? activeMemberUids(party.memberUids, schedule.mercenaries) : party.memberUids;

/** 그 주기에 용병으로 대체했는지 */
export const isReplaced = (schedule: Schedule | null | undefined, uid: string): boolean =>
  !!schedule && replacedUids(schedule.mercenaries).has(uid);

/** 내 대체 용병 */
export const myReplacement = (schedule: Schedule | null | undefined, uid: string): Mercenary | undefined =>
  schedule?.mercenaries.find((merc) => merc.replaces === uid);

/** 용병 표시 이름: "용병 2", "용병 (비숍 대신)" */
export const mercenaryDisplayName = (party: Party, merc: Mercenary): string =>
  mercenaryLabel(merc, merc.replaces ? memberLabel(party.members[merc.replaces]) : undefined);

/** 용병을 대체·추가·빼기 할 수 있는 때: 확정 전, 또는 확정 후 레이드 시작 전 */
export const canEditMercenaries = (schedule: Schedule, nowMs: number): boolean =>
  mercenaryEditable(schedule.state, schedule.confirmed?.startMs ?? null, nowMs);

export { MAX_PARTY_SIZE, canCancelReplacement, extraMercenaryCount, isMercenaryId };

/** 불가 시간 입력·투표·확정을 받는 상태 (처음 조율 또는 미클리어 후 재조정) */
export const acceptsInput = (schedule: Schedule): boolean => schedule.state === "OPEN" || schedule.state === "RETRY";

/** 클리어했지만 분배금 정산이 끝나지 않았다 */
export const settlementOpen = (schedule: Schedule): boolean =>
  schedule.state === "SETTLED" && schedule.settlement?.completed !== true;

export interface Unavailable {
  slots: string[];
  submitted: boolean;
  /** 다른 파티에 낸 같은 주기 불가 시간을 서버가 자동으로 넣어 둔 것 (본인이 고쳐 내면 false) */
  carried?: boolean;
}

export interface Vote {
  agreed: number[];
  round: number;
}

/** 받을 사람 한 명의 분배금 상태: PENDING(대기) → PAID(지급함) → RECEIVED(수령 확인) */
export interface SettlementEntry {
  uid: string;
  amount: number;
  status: string;
}

export interface ChatMessage {
  id: string;
  senderUid: string;
  text: string;
  createdAtMs: number;
  imageUrl: string | null;
}

/** 내 확정 일정 한 건 (여러 파티에 걸친 시간표용) */
export interface Raid {
  partyId: string;
  partyName: string;
  bosses: PartyBoss[];
  startMs: number;
  endMs: number;
}

/** 캐릭터 목록 항목. ocid는 서버에만 있고 앱은 id로만 가리킨다. */
export interface CharacterSummary {
  id: string;
  name: string;
  world: string;
  job: string;
  level: number;
}

export interface CharacterInfo extends CharacterSummary {
  imageUrl: string | null;
  guild: string | null;
}

export interface UserProfile {
  displayName: string;
  apiKeyRegistered: boolean;
  selectedCharacterIds: string[];
}

export interface BossCatalogEntry {
  name: string;
  difficulties: string[];
  monthly: boolean;
}

export interface BossCatalog {
  bosses: BossCatalogEntry[];
  minutesPerBoss: number;
  maxDurationMinutes: number;
}

/** 게임 스케줄러에 등록한 보스 하나 (서버 domain/earnings.ts의 PricedBoss) */
export interface SchedulerBoss {
  name: string;
  /** EASY | NORMAL | HARD | CHAOS | EXTREME */
  difficulty: string;
  cycle: "WEEKLY" | "MONTHLY";
  cleared: boolean;
  /** 앱에서 그 보스로 들어간 파티의 인원. 없으면 1 */
  partySize: number;
  /** 결정석 가격. 미등록이면 null */
  price: number | null;
  /** 내 몫 = 가격 ÷ 인원수 */
  share: number;
}

export interface CharacterScheduler {
  bosses: SchedulerBoss[];
  fetchedAtMs: number | null;
  /** 이번에 받지 못한 이유 (저장해 둔 값이 있으면 그 값도 함께 온다) */
  error: string | null;
}

/** 수익 기록 한 기간 (users/{uid}/earnings/{W-yyyyMMdd | M-yyyyMM}) */
export interface EarningsRecord {
  id: string;
  characters: Record<string, { crystalValue: number; crystalCount: number }>;
  settlements: Record<string, { characterId: string | null; partyName: string; amount: number; raidAtMs: number }>;
}

const DIFFICULTY_LABELS: Record<string, string> = {
  EASY: "이지",
  NORMAL: "노멀",
  HARD: "하드",
  CHAOS: "카오스",
  EXTREME: "익스트림",
};

export const difficultyLabel = (code: string): string => DIFFICULTY_LABELS[code] ?? code;

/** "하드 발드릭스, 하드 벨로나" */
export const bossLabel = (bosses: PartyBoss[]): string =>
  bosses.map((boss) => `${difficultyLabel(boss.difficulty)} ${boss.name}`).join(", ");

export const memberLabel = (member: PartyMember | undefined): string =>
  member ? member.displayName || member.characterName : "파티원";
