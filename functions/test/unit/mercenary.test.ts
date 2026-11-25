import { describe, expect, it } from "vitest";
import { partySizeFor } from "../../src/domain/earnings";
import {
  activeMemberUids,
  canCancelReplacement,
  cleanMercenaryName,
  extraMercenaryCount,
  isMercenaryId,
  mercenaryEditable,
  mercenaryLabel,
  nextMercenaryName,
  replacedUids,
} from "../../src/domain/mercenary";
import { computeSettlement } from "../../src/settlement/calc";
import { scheduleNotifications, type PartyInfo } from "../../src/notify/messages";

const replacing = (uid: string, id = `merc_${uid}`) => ({ id, name: "용병", replaces: uid });
const extra = (n: number) => ({ id: `merc_x${n}`, name: `용병 ${n}`, replaces: null });

describe("용병 규칙", () => {
  it("대체된 파티원은 그 주기 참여자에서 빠지고, 추가 용병만 인원을 늘린다", () => {
    const mercs = [replacing("b"), extra(1)];
    expect([...replacedUids(mercs)]).toEqual(["b"]);
    expect(activeMemberUids(["a", "b", "c"], mercs)).toEqual(["a", "c"]);
    expect(activeMemberUids(["a", "b"], undefined)).toEqual(["a", "b"]);
    expect(extraMercenaryCount(mercs)).toBe(1);
    expect(isMercenaryId("merc_ab12cd34")).toBe(true);
    expect(isMercenaryId("uid-b")).toBe(false);
  });

  it("확정 전, 또는 확정 후 레이드 시작 전에만 바꿀 수 있고, 대체 취소는 확정 전에만 된다", () => {
    expect(mercenaryEditable("OPEN", null, 0)).toBe(true);
    expect(mercenaryEditable("RETRY", null, 0)).toBe(true);
    expect(mercenaryEditable("LOCKED", 1000, 999)).toBe(true);
    expect(mercenaryEditable("LOCKED", 1000, 1000)).toBe(false);
    expect(mercenaryEditable("VERIFYING", 1000, 0)).toBe(false);
    expect(mercenaryEditable("SETTLED", null, 0)).toBe(false);
    expect(canCancelReplacement("OPEN")).toBe(true);
    expect(canCancelReplacement("LOCKED")).toBe(false);
  });

  it("이름: 비우면 기본값, 12자까지, 추가 용병은 쓰지 않은 가장 작은 번호", () => {
    expect(cleanMercenaryName("  길드원   홍길동 ", "용병")).toBe("길드원 홍길동");
    expect(cleanMercenaryName("", "용병")).toBe("용병");
    expect(cleanMercenaryName(42, "용병 1")).toBe("용병 1");
    expect(cleanMercenaryName("가".repeat(20), "용병")).toHaveLength(12);
    expect(nextMercenaryName([])).toBe("용병 1");
    expect(nextMercenaryName([extra(1), extra(3)])).toBe("용병 2");
    expect(mercenaryLabel(replacing("b"), "비숍")).toBe("용병 (비숍 대신)");
    expect(mercenaryLabel(extra(2))).toBe("용병 2");
  });

  it("결정석 인원수에 임시 용병을 더한다", () => {
    const parties = [{ memberUids: ["me", "b"], members: { me: { characterId: "c1" } }, bosses: [{ name: "림보" }], extraMercenaries: 1 }];
    expect(partySizeFor(parties, "me", "c1", "림보")).toBe(3);
  });

  it("정산: 용병도 1인분을 받는다", () => {
    const result = computeSettlement({
      saleAmount: 10_000_000,
      feePercent: 5,
      sellerUid: "a",
      participants: ["a", "b", "merc_x1"],
      weights: {},
    });
    expect(Object.keys(result.amounts)).toEqual(["b", "merc_x1"]);
    expect(result.amounts.b).toBe(result.amounts.merc_x1);
  });
});

describe("용병 알림", () => {
  const party: PartyInfo = {
    id: "p1",
    name: "스우팟",
    leaderUid: "a",
    memberUids: ["a", "b", "c"],
    members: { a: { displayName: "파티장" }, b: { displayName: "비숍" }, c: { displayName: "나이트" } },
  };
  const base = { state: "OPEN", round: 1, candidates: [], unanimous: [], inputsKey: "k", changeRequest: null, settlement: null };

  it("대체하면 다른 참여 파티원에게 알리고, 그 뒤 일정 알림은 대체한 사람에게 보내지 않는다", () => {
    const replaced = { ...base, mercenaries: [replacing("b")] };
    expect(scheduleNotifications(party, base, replaced)).toEqual([
      expect.objectContaining({ uids: ["a", "c"], body: "비숍님이 이번 주기를 용병으로 대체했습니다." }),
    ]);
    const recommended = { ...replaced, round: 2, candidates: [{ slotId: "20261114-2000" }], inputsKey: "k2" };
    expect(scheduleNotifications(party, replaced, recommended)).toMatchObject([{ uids: ["a", "c"], body: expect.stringContaining("추천 시간") }]);
  });

  it("분배금 등록 알림은 레이드에 참여한 사람(대체된 사람 제외)에게만, 자기 금액이 있을 때만 보낸다", () => {
    const settled = { ...base, state: "SETTLED", mercenaries: [replacing("b")], confirmed: { memberUids: ["a", "c"] } };
    const registered = {
      ...settled,
      settlement: { sellerUid: "a", amounts: { c: 3_000_000, merc_b: 3_000_000 }, amountPerPerson: 3_000_000, completed: false },
    };
    expect(scheduleNotifications(party, settled, registered)).toMatchObject([{ uids: ["c"] }]);
  });
});
