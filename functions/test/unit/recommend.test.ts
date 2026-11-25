import { describe, expect, it } from "vitest";
import {
  comfortSlots,
  preferredSlots,
  rankStarts,
  recommendStarts,
  unanimousCandidates,
  usualStartSlots,
} from "../../src/domain/recommend";

const DAY = 48;
const range = (from: number, to: number) => Array.from({ length: to - from }, (_, i) => from + i);
/** 주어진 구간만 비어 있게 만드는 blocked 목록 */
const onlyFree = (total: number, ...free: [number, number][]) =>
  range(0, total).filter((i) => !free.some(([from, to]) => i >= from && i < to));
/** day일째 hour시의 칸 번호 */
const at = (day: number, hour: number) => day * DAY + hour * 2;
const WEEK = 7 * DAY;

describe("recommendStarts: 가능한 시각 찾기", () => {
  it("전원이 소요 시간 내내 비는 시각만 고른다", () => {
    const a = onlyFree(DAY, [4, 8], [20, 30], [40, 44]);
    const b = onlyFree(DAY, [5, 8], [20, 26], [40, 48]);
    // 공통: [5,8) 길이 3, [20,26) 길이 6, [40,44) 길이 4 → 소요 4칸이면 20, 21, 22, 40에서 시작 가능
    const result = recommendStarts({ totalSlots: DAY, durationSlots: 4, blocked: [a, b], earliestSlot: 0 });
    // 같은 날이라 점수순(정각 우선)으로 겹치지 않게: 20, 40
    expect(result).toEqual([20, 40]);
  });

  it("이미 지난 시간과 최소 여유 시간 안쪽은 추천하지 않는다", () => {
    expect(recommendStarts({ totalSlots: DAY, durationSlots: 2, blocked: [[]], earliestSlot: 45 })).toEqual([46]);
    expect(recommendStarts({ totalSlots: DAY, durationSlots: 2, blocked: [[]], earliestSlot: 47 })).toEqual([]);
  });

  it("겹치는 시간이 없으면 빈 목록이다", () => {
    expect(recommendStarts({ totalSlots: DAY, durationSlots: 1, blocked: [range(0, 24), range(24, 48)], earliestSlot: 0 })).toEqual([]);
  });

  it("범위를 벗어난 칸 번호는 무시한다", () => {
    expect(recommendStarts({ totalSlots: 4, durationSlots: 4, blocked: [[-1, 4, 1.5, NaN]], earliestSlot: 0 })).toEqual([0]);
  });

  it("이미 추천한 시각은 다음 라운드에서 빠진다", () => {
    const input = { totalSlots: 12, durationSlots: 2, blocked: [[]], earliestSlot: 0 };
    const first = recommendStarts(input);
    expect(first).toEqual([0, 2, 4, 6, 8, 10]);
    // 남은 것은 30분씩 어긋난 시각이다.
    const second = recommendStarts({ ...input, alreadyOffered: first });
    expect(second).toEqual([1, 3, 5, 7, 9]);
    expect(recommendStarts({ ...input, alreadyOffered: [...first, ...second] })).toEqual([]);
  });
});

describe("recommendStarts: 요일별로 고르기", () => {
  it("요일마다 가장 좋은 시각을 하나씩 먼저 고르고, 최대 6개까지 준다", () => {
    // 일주일 내내 20~23시만 가능, 1시간짜리
    const blocked = onlyFree(WEEK, ...range(0, 7).map((day): [number, number] => [at(day, 20), at(day, 23)]));
    const result = recommendStarts({ totalSlots: WEEK, durationSlots: 2, blocked: [blocked], earliestSlot: 0 });
    // 7일 중 앞의 6일, 각각 정각인 20:00
    expect(result).toEqual(range(0, 6).map((day) => at(day, 20)));
  });

  it("가능한 요일이 적으면 같은 요일의 두 번째, 세 번째 시각으로 채운다", () => {
    const blocked = onlyFree(WEEK, [at(2, 20), at(2, 23)], [at(4, 21), at(4, 22)]);
    const result = recommendStarts({ totalSlots: WEEK, durationSlots: 2, blocked: [blocked], earliestSlot: 0 });
    // 2일째: 20:00, 21:00, 22:00 (겹치지 않게) / 4일째: 21:00
    expect(result).toEqual([at(2, 20), at(2, 21), at(2, 22), at(4, 21)]);
  });

  it("정각에 시작할 수 없으면 30분에 시작하는 시각을 준다", () => {
    const blocked = onlyFree(WEEK, [at(1, 20) + 1, at(1, 21) + 1]);
    expect(recommendStarts({ totalSlots: WEEK, durationSlots: 2, blocked: [blocked], earliestSlot: 0 })).toEqual([at(1, 20) + 1]);
  });
});

describe("recommendStarts: 점수", () => {
  const evenings = onlyFree(WEEK, ...range(0, 7).map((day): [number, number] => [at(day, 18), at(day, 24)]));

  it("선호 시간대 안의 시각을 먼저 고른다", () => {
    // 선호: 매일 21~24시
    const preferred = range(0, 7).flatMap((day) => range(at(day, 21), at(day, 24)));
    const result = recommendStarts({ totalSlots: WEEK, durationSlots: 2, blocked: [evenings], earliestSlot: 0, preferred });
    expect(result).toEqual(range(0, 6).map((day) => at(day, 21)));
  });

  it("선호 시간대가 있는 요일을 다른 요일보다 먼저 고른다", () => {
    // 선호: 5·6일째(주말) 21~24시
    const preferred = [5, 6].flatMap((day) => range(at(day, 21), at(day, 24)));
    const result = recommendStarts({ totalSlots: WEEK, durationSlots: 2, blocked: [evenings], earliestSlot: 0, preferred, limit: 3 });
    expect(result).toEqual([at(0, 18), at(5, 21), at(6, 21)]);
  });

  it("선호 시간대 안에 가능한 시각이 없어도 다른 시각을 준다", () => {
    const preferred = range(at(0, 3), at(0, 5));
    const result = recommendStarts({ totalSlots: WEEK, durationSlots: 2, blocked: [evenings], earliestSlot: 0, preferred, limit: 1 });
    expect(result).toEqual([at(0, 18)]);
  });

  it("파티원의 다른 확정 레이드 바로 앞뒤 시각을 우선한다", () => {
    // 0일째 18~24시만 가능한데, 한 명이 21:00~22:00에 다른 레이드가 있다 (그 칸은 blocked에도 들어 있다).
    const raid = range(at(0, 21), at(0, 22));
    const blocked = [...onlyFree(WEEK, [at(0, 18), at(0, 24)]), ...raid];
    const input = { totalSlots: WEEK, durationSlots: 2, blocked: [blocked], earliestSlot: 0 };

    // 붙일 레이드를 모르면 이른 시각부터
    expect(recommendStarts({ ...input, limit: 2 })).toEqual([at(0, 18), at(0, 19)]);
    // 알면 레이드 바로 앞(20:00)과 바로 뒤(22:00)가 먼저
    expect(recommendStarts({ ...input, busy: [raid], limit: 2 })).toEqual([at(0, 20), at(0, 22)]);
  });

  it("다른 파티가 투표 중인 후보 바로 앞뒤 시각을 조금 우선한다", () => {
    // 0일째 18~24시 가능. 같은 파티원이 있는 다른 파티가 21:00~22:00 후보로 투표 중
    const blocked = onlyFree(WEEK, [at(0, 18), at(0, 24)]);
    const theirs = range(at(0, 21), at(0, 22));
    const input = { totalSlots: WEEK, durationSlots: 2, blocked: [blocked], pending: theirs, earliestSlot: 0 };

    // 누구의 후보인지 모르면 겹치지 않는 이른 시각부터 (예전 동작)
    expect(recommendStarts({ ...input, limit: 2 })).toEqual([at(0, 18), at(0, 19)]);
    // 그 파티원 기준으로 알면 후보 바로 앞(20:00)과 바로 뒤(22:00)가 먼저
    expect(recommendStarts({ ...input, pendingByMember: [theirs], limit: 2 })).toEqual([at(0, 20), at(0, 22)]);
  });

  it("확정 레이드 앞뒤가 투표 중 후보 앞뒤보다 먼저이고, 붙는 파티원이 많을수록 먼저다", () => {
    // 0일째 18~24시 가능. 파티원 0의 확정 레이드 19:00~20:00, 다른 파티 투표 중 후보 22:00~23:00
    const raid = range(at(0, 19), at(0, 20));
    const theirs = range(at(0, 22), at(0, 23));
    const free = onlyFree(WEEK, [at(0, 18), at(0, 24)]);
    const input = { totalSlots: WEEK, durationSlots: 2, earliestSlot: 0, limit: 2, pending: theirs };

    // 한 명: 레이드 앞뒤(18:00, 20:00, 각 15점)가 투표 중 후보 앞뒤(21:00, 23:00, 각 8점)보다 먼저
    expect(recommendStarts({ ...input, blocked: [[...free, ...raid]], busy: [raid], pendingByMember: [theirs] })).toEqual([
      at(0, 18),
      at(0, 20),
    ]);
    // 두 명이 모두 그 투표 중 후보의 파티에 있으면 21:00, 23:00이 8×2 = 16점으로 레이드 앞뒤(15점)보다 먼저
    expect(
      recommendStarts({ ...input, blocked: [[...free, ...raid], free], busy: [raid, []], pendingByMember: [theirs, theirs] }),
    ).toEqual([at(0, 21), at(0, 23)]);
  });

  it("이어 돌기는 같은 캐릭터 > 같은 사람(다른 캐릭터) 순이고, 확정 레이드가 투표 중 후보보다 먼저다", () => {
    // 0일째 19:00~21:30만 가능, 소요 90분(3칸). 19:00 시작(왼쪽 레이드 바로 뒤)과 20:00 시작(오른쪽 레이드 바로 앞)은
    // 서로 겹쳐 하나만 고를 수 있고, 둘 다 정각이다.
    const left = range(at(0, 18), at(0, 19));
    const right = range(at(0, 21) + 1, at(0, 22) + 1);
    const blocked = [onlyFree(WEEK, [at(0, 19), at(0, 21) + 1])];
    const input = { totalSlots: WEEK, durationSlots: 3, blocked, earliestSlot: 0 };
    const leftStart = [at(0, 19)];
    const rightStart = [at(0, 20)];

    // 확정 레이드 둘: 같은 캐릭터(20) 쪽이 다른 캐릭터(15) 쪽보다 먼저
    expect(recommendStarts({ ...input, busy: [[...left, ...right]], busySameCharacter: [left] })).toEqual(leftStart);
    expect(recommendStarts({ ...input, busy: [[...left, ...right]], busySameCharacter: [right] })).toEqual(rightStart);
    // 다른 캐릭터의 확정 레이드(15)가 같은 캐릭터의 투표 중 후보(12)보다 먼저
    expect(
      recommendStarts({ ...input, busy: [right], pending: left, pendingByMember: [left], pendingSameCharacter: [left] }),
    ).toEqual(rightStart);
    // 투표 중 후보 둘: 같은 캐릭터(12) 쪽이 다른 캐릭터(8) 쪽보다 먼저
    expect(
      recommendStarts({ ...input, pending: [...left, ...right], pendingByMember: [[...left, ...right]], pendingSameCharacter: [right] }),
    ).toEqual(rightStart);
  });

  it("다른 파티가 투표 중인 후보와 겹치는 시각은 뒤로 미룬다", () => {
    const blocked = onlyFree(WEEK, [at(0, 20), at(0, 23)]);
    const pending = range(at(0, 20), at(0, 21));
    const result = recommendStarts({ totalSlots: WEEK, durationSlots: 2, blocked: [blocked], pending, earliestSlot: 0, limit: 1 });
    expect(result).toEqual([at(0, 21)]);
    // 겹치는 시각밖에 없으면 그래도 준다.
    const only = onlyFree(WEEK, [at(0, 20), at(0, 21)]);
    expect(recommendStarts({ totalSlots: WEEK, durationSlots: 2, blocked: [only], pending, earliestSlot: 0 })).toEqual([at(0, 20)]);
  });
});

describe("rankStarts: 생활 시간대·평소 시간·순위", () => {
  // 주기는 목요일(4)에 시작한다: 0일째 목, 1 금, 2 토, 3 일, 4 월
  const comfort = comfortSlots(WEEK, 4);
  const allFree = { totalSlots: WEEK, durationSlots: 2, blocked: [[]], earliestSlot: 0 };

  it("아무 때나 되면 새벽·자정·평일 낮보다 저녁이 먼저다", () => {
    expect(rankStarts({ ...allFree, comfort, mode: "ranked", limit: 1 })).toEqual([{ start: at(0, 18), score: 5, reasons: [] }]);
    // 보정이 없으면 예전처럼 가장 이른 정각(목 00:00)
    expect(recommendStarts({ ...allFree, mode: "ranked", limit: 1 })).toEqual([at(0, 0)]);
  });

  it("새벽밖에 없으면 그래도 고르고, 이유에 새벽·낮·자정을 붙인다", () => {
    const night = onlyFree(WEEK, [at(0, 3), at(0, 5)]);
    expect(rankStarts({ ...allFree, blocked: [night], comfort, mode: "ranked", limit: 1 })).toMatchObject([
      { start: at(0, 3), reasons: ["LATE_NIGHT"] },
    ]);
    const day = onlyFree(WEEK, [at(0, 13), at(0, 15)]);
    expect(rankStarts({ ...allFree, blocked: [day], comfort, mode: "ranked", limit: 1 })).toMatchObject([{ start: at(0, 13), reasons: ["DAYTIME"] }]);
    const midnight = onlyFree(WEEK, [at(1, 0), at(1, 1)]);
    expect(rankStarts({ ...allFree, blocked: [midnight], comfort, mode: "ranked" })).toMatchObject([{ start: at(1, 0), reasons: ["MIDNIGHT"] }]);
  });

  it("선호 시간대 안이면 생활 시간대 보정을 하지 않는다", () => {
    // 목요일 10:00~12:00 선호
    const preferred = preferredSlots({ days: [4], startRow: 20, endRow: 24 }, WEEK, 4);
    const withPreferred = comfortSlots(WEEK, 4, preferred);
    expect(rankStarts({ ...allFree, preferred, comfort: withPreferred, mode: "ranked", limit: 1 })).toEqual([
      { start: at(0, 10), score: 105, reasons: ["PREFERRED"] },
    ]);
  });

  it("평소 시간: 토 21:00에 자주 했으면 하루 이른 금 21:00보다 토 21:00이 먼저다 (최대 +30)", () => {
    const free = onlyFree(WEEK, [at(1, 21), at(1, 23)], [at(2, 21), at(2, 23)]);
    const input = { ...allFree, blocked: [free], mode: "ranked" as const, limit: 1 };
    expect(recommendStarts(input)).toEqual([at(1, 21)]);
    const twice = usualStartSlots([{ weekday: 6, row: 42 }, { weekday: 6, row: 42 }], WEEK, 4);
    expect(twice).toEqual([at(2, 21), at(2, 21)]);
    expect(rankStarts({ ...input, usualStarts: twice })).toEqual([{ start: at(2, 21), score: 5 - 2 + 20, reasons: ["USUAL_TIME"] }]);
    // 다섯 번이어도 +30까지
    const many = usualStartSlots(Array.from({ length: 5 }, () => ({ weekday: 6, row: 42 })), WEEK, 4);
    expect(rankStarts({ ...input, usualStarts: many })[0].score).toBe(5 - 2 + 30);
  });

  it("ranked는 요일과 상관없이 점수순으로 겹치지 않게 고르고, spread는 요일을 섞는다", () => {
    expect(recommendStarts({ ...allFree, comfort, mode: "ranked" })).toEqual([at(0, 18), at(0, 19), at(0, 20)]);
    // 목 18:00(5) > 금 18:00(4) > 토 10:00(3, 주말 아침 08~10시가 지난 첫 정각)
    expect(recommendStarts({ ...allFree, comfort, limit: 3 })).toEqual([at(0, 18), at(1, 18), at(2, 10)]);
  });

  it("이어 돌기와 겹침도 이유로 붙는다", () => {
    const raid = range(at(0, 19), at(0, 20));
    const free = onlyFree(WEEK, [at(0, 18), at(0, 24)]);
    const theirs = range(at(0, 22), at(0, 23));
    const ranked = rankStarts({ ...allFree, blocked: [[...free, ...raid]], busy: [raid], pending: theirs, mode: "ranked", limit: 6 });
    expect(ranked[0]).toMatchObject({ start: at(0, 18), reasons: ["ADJACENT"] });
    expect(ranked.find((option) => option.start === at(0, 22))?.reasons).toEqual(["PENDING_OVERLAP"]);
  });
});

describe("usualStartSlots", () => {
  it("한 달짜리 주기에서는 같은 요일마다 넣는다", () => {
    // 1일이 일요일(7)인 30일. 지난 레이드: 일요일 20:00
    expect(usualStartSlots([{ weekday: 7, row: 40 }], 30 * DAY, 7).map((slot) => Math.floor(slot / DAY))).toEqual([0, 7, 14, 21, 28]);
  });
});

describe("preferredSlots", () => {
  it("요일이 맞는 날의 시간 범위만 넣는다", () => {
    // 주기가 목요일(4)에 시작. 선호: 토·일(6, 7) 21:00~24:00
    const slots = preferredSlots({ days: [6, 7], startRow: 42, endRow: 48 }, WEEK, 4);
    expect(slots).toEqual([...range(2 * DAY + 42, 3 * DAY), ...range(3 * DAY + 42, 4 * DAY)]);
  });

  it("한 달짜리 주기에서는 해당 요일이 여러 번 들어간다", () => {
    // 1일이 일요일(7)인 30일. 선호: 일요일 20:00~21:00
    const slots = preferredSlots({ days: [7], startRow: 40, endRow: 42 }, 30 * DAY, 7);
    expect(slots.filter((slot) => slot % DAY === 40).map((slot) => Math.floor(slot / DAY))).toEqual([0, 7, 14, 21, 28]);
  });
});

describe("unanimousCandidates", () => {
  it("전원이 동의한 후보만 고른다", () => {
    expect(unanimousCandidates(3, [[0, 2], [2], [1, 2]])).toEqual([2]);
    expect(unanimousCandidates(3, [[0], [1]])).toEqual([]);
  });

  it("투표하지 않은 사람이 있으면 아직 결정하지 않는다", () => {
    expect(unanimousCandidates(3, [[0], undefined])).toBeNull();
    expect(unanimousCandidates(3, [])).toBeNull();
  });
});
