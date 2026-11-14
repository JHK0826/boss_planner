import { Timestamp } from "firebase-admin/firestore";
import { describe, expect, it } from "vitest";
import {
  formatKst,
  formatMeso,
  messageNotification,
  missingInputNotifications,
  scheduleNotifications,
  settlementNotifications,
  type PartyInfo,
} from "../../src/notify/messages";

const party: PartyInfo = {
  id: "p1",
  name: "스우팟",
  leaderUid: "a",
  memberUids: ["a", "b", "c"],
  members: { a: { displayName: "파티장" }, b: { displayName: "비숍" }, c: { displayName: "", characterName: "캐릭씨" } },
};
const kst = (iso: string) => Date.parse(`${iso}+09:00`);
const base = { state: "OPEN", round: 0, candidates: [], unanimous: [], inputsKey: null, changeRequest: null, settlement: null };
const candidate = { slotId: "20261114-2000" };
const confirmed = { start: Timestamp.fromMillis(kst("2026-11-14T20:00:00")) };
const notify = (before: object | undefined, after: object) => scheduleNotifications(party, before, after);

describe("formatters", () => {
  it("KST 요일과 시각, 메소 단위를 쓴다", () => {
    expect(formatKst(kst("2026-11-14T20:00:00"))).toBe("11/14(토) 20:00");
    expect(formatKst(Date.parse("2026-11-11T15:30:00Z"))).toBe("11/12(목) 00:30");
    expect(formatMeso(1234567890)).toBe("1,234,567,890메소");
  });
});

describe("scheduleNotifications", () => {
  it("주기가 시작되면 전원에게 알린다", () => {
    expect(notify(undefined, base)).toMatchObject([{ uids: ["a", "b", "c"], title: "스우팟", partyId: "p1" }]);
  });

  it("바뀐 것이 없으면 보내지 않는다", () => {
    expect(notify(base, { ...base, updatedAt: 1 })).toEqual([]);
  });

  it("추천 후보가 나오면 전원에게, 전원 동의가 생기면 파티장에게 알린다", () => {
    const recommended = { ...base, round: 1, candidates: [candidate], inputsKey: "k" };
    expect(notify(base, recommended)).toMatchObject([{ uids: ["a", "b", "c"], body: expect.stringContaining("추천 시간") }]);

    const agreed = notify(recommended, { ...recommended, unanimous: [0] });
    expect(agreed).toMatchObject([{ uids: ["a"], body: expect.stringContaining("확정해 주세요") }]);
    // 전원 동의 후보가 하나 더 늘어도 다시 보내지 않는다.
    expect(notify({ ...recommended, unanimous: [0] }, { ...recommended, unanimous: [0, 1] })).toEqual([]);

    const nextRound = notify(recommended, { ...recommended, round: 2, candidates: [{ slotId: "20261115-2000" }] });
    expect(nextRound).toMatchObject([{ body: expect.stringContaining("다음 후보") }]);
  });

  it("확정되면 시간과 함께 알린다", () => {
    const before = { ...base, round: 1, candidates: [candidate], unanimous: [0] };
    expect(notify(before, { ...before, state: "LOCKED", confirmed })).toMatchObject([
      { uids: ["a", "b", "c"], body: "일정이 확정됐습니다: 11/14(토) 20:00" },
    ]);
  });

  it("변경 요청은 파티장에게, 승인은 전원에게, 거절은 요청자에게 알린다", () => {
    const locked = { ...base, state: "LOCKED", confirmed };
    const pending = { ...locked, changeRequest: { requestedBy: "b", reason: "야근", status: "PENDING" } };
    expect(notify(locked, pending)).toMatchObject([{ uids: ["a"], body: "비숍님이 일정 변경을 요청했습니다 (야근)." }]);

    const approved = { ...base, round: 2, changeRequest: { ...pending.changeRequest, status: "APPROVED" } };
    expect(notify(pending, approved)).toMatchObject([{ uids: ["a", "b", "c"], body: expect.stringContaining("승인") }]);

    const rejected = { ...locked, changeRequest: { ...pending.changeRequest, status: "REJECTED" } };
    expect(notify(pending, rejected)).toMatchObject([{ uids: ["b"], body: expect.stringContaining("거절") }]);
  });

  it("레이드가 끝나면 결과 기록을 요청하고, 결과에 따라 알린다", () => {
    const locked = { ...base, state: "LOCKED", confirmed };
    expect(notify(locked, { ...locked, state: "VERIFYING" })[0].body).toContain("클리어 여부");
    expect(notify(locked, { ...locked, state: "SETTLED" })[0].body).toContain("분배금을 등록");
    expect(notify(locked, { ...base, state: "RETRY", round: 3 })).toMatchObject([{ body: expect.stringContaining("미클리어") }]);
    // 재조정에 들어간 뒤 후보가 나오면 투표를 요청한다.
    const retry = { ...base, state: "RETRY", round: 3 };
    expect(notify(retry, { ...retry, round: 4, candidates: [candidate], inputsKey: "k" })[0].body).toContain("추천 시간");
    expect(notify(base, { ...base, state: "SKIPPED", skippedReason: "NO_COMMON_TIME" })[0].body).toContain("가능한 시간이 없어");
    expect(notify(retry, { ...retry, state: "EXPIRED" })[0].body).toContain("종료");
  });

  it("분배금이 등록되면 받을 사람에게, 정산이 끝나면 전원에게 알린다", () => {
    const settled = { ...base, state: "SETTLED", confirmed };
    const registered = {
      ...settled,
      settlement: { sellerUid: "b", saleAmount: 20000000, feePercent: 3, amounts: { a: 5000000, c: 7000000 }, completed: false },
    };
    // 사람마다 정산금이 다를 수 있어 한 명씩 자기 금액을 받는다.
    expect(notify(settled, registered)).toMatchObject([
      { uids: ["a"], body: expect.stringContaining("비숍님이 분배금을 등록했습니다. 내 정산금은 5,000,000메소") },
      { uids: ["c"], body: expect.stringContaining("내 정산금은 7,000,000메소") },
    ]);
    // 금액을 고쳐 다시 등록하면 다시 알린다.
    const changed = { ...registered, settlement: { ...registered.settlement, amounts: { a: 6000000, c: 6000000 } } };
    expect(notify(registered, changed)).toHaveLength(2);
    // 0.2.0 이하 앱이 등록한 형식(1인 금액만 있음)도 알린다.
    const legacy = { ...settled, settlement: { sellerUid: "b", amountPerPerson: 100, completed: false } };
    expect(notify(settled, legacy)).toMatchObject([{ uids: ["a"] }, { uids: ["c"] }]);
    const completed = { ...registered, settlement: { ...registered.settlement, completed: true } };
    expect(notify(registered, completed)).toMatchObject([{ uids: ["a", "b", "c"], body: expect.stringContaining("정산이 완료") }]);
    expect(notify(completed, { ...completed, updatedAt: 2 })).toEqual([]);
  });
});

describe("그 밖의 알림", () => {
  it("지급함은 받는 사람에게, 수령 확인은 판매자에게 알린다", () => {
    const pending = { amount: 5000000, status: "PENDING" };
    expect(settlementNotifications(party, "b", "c", pending, { ...pending, status: "PAID" })).toMatchObject([
      { uids: ["c"], body: expect.stringContaining("5,000,000메소") },
    ]);
    expect(
      settlementNotifications(party, "b", "c", { ...pending, status: "PAID" }, { ...pending, status: "RECEIVED" }),
    ).toMatchObject([{ uids: ["b"], body: "캐릭씨님이 분배금 수령을 확인했습니다." }]);
    expect(settlementNotifications(party, "b", "c", undefined, pending)).toEqual([]);
  });

  it("채팅은 보낸 사람을 빼고 알린다", () => {
    expect(messageNotification(party, "c", "계좌로 주세요")).toMatchObject([
      { uids: ["a", "b"], body: "캐릭씨: 계좌로 주세요" },
    ]);
    expect(messageNotification(party, "c", "가".repeat(200))[0].body.length).toBeLessThan(100);
    expect(messageNotification(party, "c", "", true)[0].body).toBe("캐릭씨: 사진을 보냈습니다.");
    expect(messageNotification(party, "c", "정산표", true)[0].body).toBe("캐릭씨: (사진) 정산표");
  });

  it("미입력자에게 입력 요청을, 파티장에게 미입력자 알림을 보낸다", () => {
    expect(missingInputNotifications(party, [])).toEqual([]);
    expect(missingInputNotifications(party, ["b", "c"])).toMatchObject([
      { uids: ["b", "c"] },
      { uids: ["a"], body: "미입력 파티원이 존재합니다." },
    ]);
    // 파티장 혼자 미입력이면 입력 요청만 보낸다.
    expect(missingInputNotifications(party, ["a"])).toHaveLength(1);
  });
});
