// Android app/src/test/.../PartyStatusTest.kt와 같은 경우를 확인한다.
import { describe, expect, it } from "vitest";
import type { Party, Schedule, SettlementEntry } from "../src/lib/model";
import { partyStatus, statusText, tabTodos, type PartySnapshot } from "../src/lib/partyStatus";
import { dateTime } from "../src/lib/time";

const hour = 60 * 60 * 1000;
const start = 1_000_000_000_000;
const now = start + 24 * hour;

const party = (leader = "a", started = true): Party => ({
  id: "p1",
  name: "스우팟",
  bosses: [{ name: "스우", difficulty: "HARD" }],
  cycle: "WEEKLY",
  durationMinutes: 60,
  leaderUid: leader,
  memberUids: ["a", "b"],
  members: {},
  inviteCode: "ABC123",
  scheduleStarted: started,
  preferredWindow: null,
  minLeadMinutes: 180,
});

function schedule(o: Partial<Schedule> & { candidateCount?: number; confirmedAt?: number } = {}): Schedule {
  const { candidateCount = 0, confirmedAt, ...rest } = o;
  return {
    id: "W-1",
    state: "OPEN",
    periodStartMs: start,
    periodEndMs: start + 7 * 24 * hour,
    inputDeadlineMs: start + 24 * hour,
    durationSlots: 2,
    round: 1,
    candidates: Array.from({ length: candidateCount }, (_, i) => ({ slotId: `s${i}`, startMs: start + i * hour, endMs: start + (i + 1) * hour })),
    unanimous: [],
    skippedReason: null,
    confirmed: confirmedAt !== undefined ? { startMs: confirmedAt, endMs: confirmedAt + hour, memberUids: ["a", "b"] } : null,
    changeRequest: null,
    retryCount: 0,
    expiredReason: null,
    settlement: null,
    ...rest,
  };
}

function snapshot(
  schedules: Schedule[],
  o: { submitted?: string[]; votedRound?: Record<string, number>; settlements?: Record<string, SettlementEntry[]> } = {},
): PartySnapshot {
  return {
    schedules,
    unavailable: Object.fromEntries((o.submitted ?? []).map((uid) => [uid, { slots: [], submitted: true }])),
    votes: Object.fromEntries(Object.entries(o.votedRound ?? {}).map(([uid, round]) => [uid, { agreed: [0], round }])),
    settlements: o.settlements ?? {},
  };
}

const status = (uid: string, snap: PartySnapshot | undefined, p = party(), at = now) => partyStatus(uid, p, snap, at);
const s = (label: string, needsAction: boolean, moreActions = 0) => ({ label, needsAction, moreActions });
const settlement = { sellerUid: "a", saleAmount: 100_000_000, feePercent: 3, netAmount: 97_000_000, amountPerPerson: 49_238_500, completed: false };

describe("partyStatus", () => {
  it("아직 못 읽었으면 null", () => {
    expect(status("a", undefined)).toBeNull();
  });

  it("일정이 없으면 시작 전 또는 다음 주기 대기", () => {
    expect(status("a", snapshot([]), party("a", false))).toMatchObject(s("일정 시작 전", false));
    expect(status("a", snapshot([]))).toMatchObject(s("다음 주기 대기", false));
    expect(status("a", snapshot([schedule({ state: "SKIPPED", periodEndMs: now - hour })]))).toMatchObject(s("다음 주기 대기", false));
  });

  it("입력과 투표 단계", () => {
    expect(status("a", snapshot([schedule()]))).toMatchObject(s("불가 시간 입력", true));
    expect(status("a", snapshot([schedule()], { submitted: ["a"] }))).toMatchObject(s("다른 파티원 입력 대기 (1/2)", false));
    const voting = schedule({ candidateCount: 3, round: 2 });
    expect(status("a", snapshot([voting], { submitted: ["a", "b"] }))).toMatchObject(s("투표", true));
    expect(status("a", snapshot([voting], { submitted: ["a", "b"], votedRound: { a: 1 } }))).toMatchObject(s("투표", true));
    expect(status("a", snapshot([voting], { submitted: ["a", "b"], votedRound: { a: 2 } }))).toMatchObject(
      s("다른 파티원 투표 대기 (1/2)", false),
    );
  });

  it("전원 동의 후보가 있으면 파티장만 확정할 일이 생긴다", () => {
    const snap = snapshot([schedule({ candidateCount: 3, unanimous: [1] })], { submitted: ["a", "b"], votedRound: { a: 1, b: 1 } });
    expect(status("a", snap)).toMatchObject(s("일정 확정", true));
    expect(status("b", snap)).toMatchObject(s("파티장 확정 대기", false));
  });

  it("재조정 중이면 앞에 표시한다", () => {
    expect(status("a", snapshot([schedule({ state: "RETRY" })], { submitted: ["a"] }))).toMatchObject(
      s("재조정 · 다른 파티원 입력 대기 (1/2)", false),
    );
  });

  it("확정 뒤에는 레이드가 시작되면 결과 기록", () => {
    const raid = now + 2 * hour;
    const locked = schedule({ state: "LOCKED", confirmedAt: raid });
    expect(status("b", snapshot([locked]))).toMatchObject(s(`확정 ${dateTime(raid)}`, false));
    expect(status("b", snapshot([locked]), party(), raid)).toMatchObject(s("결과 기록", true));
    expect(status("b", snapshot([schedule({ state: "VERIFYING", confirmedAt: raid })]))).toMatchObject(s("결과 기록", true));
  });

  it("변경 요청은 파티장의 할 일", () => {
    const locked = schedule({ state: "LOCKED", confirmedAt: now + 48 * hour, changeRequest: { requestedBy: "b", reason: "", status: "PENDING" } });
    expect(status("a", snapshot([locked]))).toMatchObject(s("변경 요청 처리", true));
    expect(status("b", snapshot([locked]))?.needsAction).toBe(false);
  });

  it("정산 단계", () => {
    const settled = schedule({ state: "SETTLED", settlement });
    const pending = { [settled.id]: [{ uid: "b", amount: 49_238_500, status: "PENDING" }] };
    const paid = { [settled.id]: [{ uid: "b", amount: 49_238_500, status: "PAID" }] };
    expect(status("a", snapshot([settled], { settlements: pending }))).toMatchObject(s("정산금 지급", true));
    expect(status("b", snapshot([settled], { settlements: pending }))).toMatchObject(s("정산금 지급 대기", false));
    expect(status("b", snapshot([settled], { settlements: paid }))).toMatchObject(s("정산금 수령 확인", true));
    expect(status("a", snapshot([settled], { settlements: paid }))).toMatchObject(s("정산 진행 중", false));
    expect(status("a", snapshot([schedule({ state: "SETTLED" })]))).toMatchObject(s("클리어 · 분배금 미등록", false));
    expect(status("a", snapshot([schedule({ state: "SETTLED", settlement: { ...settlement, completed: true } })]))).toMatchObject(
      s("정산 완료", false),
    );
  });

  it("지난 주기 정산도 할 일로 센다", () => {
    const past = schedule({ state: "SETTLED", id: "W-0", settlement });
    const result = status("a", snapshot([schedule({ id: "W-1" }), past], { settlements: { "W-0": [{ uid: "b", amount: 1, status: "PENDING" }] } }))!;
    expect(result).toMatchObject(s("불가 시간 입력", true, 1));
    expect(statusText(result)).toBe("불가 시간 입력 외 1건");
    expect(result.todos).toEqual(["불가 시간 입력", "정산금 지급"]);
  });

  it("할 일을 파티 화면의 투표 탭과 정산 탭으로 나눈다", () => {
    const past = schedule({ state: "SETTLED", id: "W-0", settlement });
    const both = status("a", snapshot([schedule({ id: "W-1" }), past], { settlements: { "W-0": [{ uid: "b", amount: 1, status: "PENDING" }] } }));
    expect(tabTodos(both)).toEqual({ vote: true, settlement: true });
    const voteOnly = status("a", snapshot([schedule()]));
    expect(tabTodos(voteOnly)).toEqual({ vote: true, settlement: false });
    const settled = schedule({ state: "SETTLED", settlement });
    const paid = status("b", snapshot([settled], { settlements: { [settled.id]: [{ uid: "b", amount: 1, status: "PAID" }] } }));
    expect(tabTodos(paid)).toEqual({ vote: false, settlement: true });
    expect(tabTodos(status("a", snapshot([])))).toEqual({ vote: false, settlement: false });
    expect(tabTodos(null)).toEqual({ vote: false, settlement: false });
  });
});
