// Android app/src/test/.../PartyStatusTest.kt와 같은 경우를 확인한다.
import { describe, expect, it } from "vitest";
import type { Party, Schedule, SettlementEntry } from "../src/lib/model";
import { currentPeriodSchedule, isUpcoming, partyStatus, statusText, tabTodos, type PartySnapshot } from "../src/lib/partyStatus";
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
  autoAssign: false,
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
    candidates: Array.from({ length: candidateCount }, (_, i) => ({
      slotId: `s${i}`,
      startMs: start + i * hour,
      endMs: start + (i + 1) * hour,
      score: null,
      reasons: [],
    })),
    unanimous: [],
    skippedReason: null,
    confirmed: confirmedAt !== undefined ? { startMs: confirmedAt, endMs: confirmedAt + hour, memberUids: ["a", "b"] } : null,
    changeRequest: null,
    retryCount: 0,
    mercenaries: [],
    expiredReason: null,
    settlement: null,
    assignMode: "VOTE",
    confirmedBy: null,
    autoDeferredAtMs: null,
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

  it("용병으로 대체한 사람은 입력·투표·결과 기록을 하지 않고, 나머지만 센다", () => {
    const mercenaries = [{ id: "merc_1", name: "용병", replaces: "b" }];
    // b 대체: a만 참여. a가 내면 대기 수가 1/1
    expect(status("b", snapshot([schedule({ mercenaries })]))).toMatchObject(s("용병으로 대체", false));
    expect(status("a", snapshot([schedule({ mercenaries, candidateCount: 2 })], { submitted: ["a"], votedRound: { a: 1 } }))).toMatchObject(
      s("다른 파티원 투표 대기 (1/1)", false),
    );
    const raid = now + 2 * hour;
    const locked = schedule({ state: "LOCKED", confirmedAt: raid, mercenaries });
    expect(status("b", snapshot([locked]), party(), raid)).toMatchObject(s("용병으로 대체", false));
    // 파티장이 대체했어도 확정은 파티장의 할 일
    const leaderReplaced = [{ id: "merc_2", name: "용병", replaces: "a" }];
    const snap = snapshot([schedule({ mercenaries: leaderReplaced, candidateCount: 2, unanimous: [0] })], { submitted: ["b"], votedRound: { b: 1 } });
    expect(status("a", snap)).toMatchObject(s("일정 확정", true));
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

  it("이번 주 레이드가 끝나 미리 연 다음 주 일정은 '다음 주' 할 일로, 확정은 목요일부터라 안내만 한다", () => {
    const upcoming = schedule({ periodStartMs: now + 24 * hour, periodEndMs: now + 8 * 24 * hour });
    const settled = schedule({ id: "W-0", state: "SETTLED" });
    expect(status("a", snapshot([upcoming, settled]))).toMatchObject(s("다음 주 불가 시간 입력", true));
    const voting = { ...upcoming, round: 2, candidates: [{ slotId: "x", startMs: 0, endMs: 0, score: null, reasons: [] }] };
    expect(status("a", snapshot([voting], { submitted: ["a", "b"] }))).toMatchObject(s("다음 주 투표", true));
    const agreed = { ...voting, unanimous: [0] };
    const both = { submitted: ["a", "b"], votedRound: { a: 2, b: 2 } };
    // 파티장도 아직 확정할 수 없다.
    expect(status("a", snapshot([agreed], both))).toMatchObject(s("다음 주 전원 동의 · 목요일부터 확정 가능", false));
    expect(tabTodos(status("a", snapshot([upcoming])))).toEqual({ vote: true, settlement: false });
  });

  it("투표 없이 자동 지정하는 일정은 투표·확정 할 일이 없고, 미리 연 다음 주면 1위 예정 시간을 보여 준다", () => {
    const plannedStart = now + 3 * 24 * hour;
    const upcoming = schedule({
      periodStartMs: now + 24 * hour,
      periodEndMs: now + 8 * 24 * hour,
      assignMode: "AUTO",
      round: 2,
      candidates: [{ slotId: "x", startMs: plannedStart, endMs: plannedStart + hour, score: 5, reasons: [] }],
    });
    expect(status("a", snapshot([upcoming], { submitted: ["a", "b"] }))).toMatchObject(s(`자동 지정 예정 ${dateTime(plannedStart)}`, false));
    expect(status("b", snapshot([upcoming], { submitted: ["a"] }))).toMatchObject(s("다음 주 불가 시간 입력", true));
    expect(tabTodos(status("a", snapshot([upcoming], { submitted: ["a", "b"] })))).toEqual({ vote: false, settlement: false });
  });

  it("같은 파티원이 있는 다른 자동 지정 파티를 기다리면 자동 지정 대기로 보여 준다", () => {
    const candidates = [{ slotId: "x", startMs: now + 3 * 24 * hour, endMs: now + 3 * 24 * hour + hour, score: 5, reasons: [] }];
    const auto = schedule({ assignMode: "AUTO", round: 2, candidates });
    const both = { submitted: ["a", "b"] };
    expect(status("a", snapshot([auto], both))).toMatchObject(s("자동 지정 중", false));
    expect(status("a", snapshot([{ ...auto, autoDeferredAtMs: now }], both))).toMatchObject(s("자동 지정 대기", false));
  });

  it("이번 주 일정과 미리 연 다음 주 일정을 나눈다", () => {
    const upcoming = schedule({ id: "W-2", periodStartMs: now + hour, periodEndMs: now + 7 * 24 * hour });
    const thisWeek = schedule({ id: "W-1", state: "SETTLED" });
    expect(isUpcoming(upcoming, now)).toBe(true);
    expect(isUpcoming(thisWeek, now)).toBe(false);
    expect(currentPeriodSchedule([upcoming, thisWeek], now)?.id).toBe("W-1");
  });
});
