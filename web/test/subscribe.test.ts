import { describe, expect, it } from "vitest";
import { combineAll, type Subscribe, withDetails } from "../src/lib/subscribe";

/** 값을 직접 밀어 넣을 수 있는 가짜 구독 */
function source<T>() {
  const listeners = new Set<(v: T) => void>();
  const subscribe: Subscribe<T> = (onValue) => {
    listeners.add(onValue);
    return () => listeners.delete(onValue);
  };
  return { subscribe, emit: (v: T) => listeners.forEach((l) => l(v)), get active() { return listeners.size; } };
}

describe("withDetails", () => {
  it("키가 같으면 하위 구독을 다시 붙이지 않고 새 값만 반영한다", () => {
    const main = source<{ key: string; value: number }>();
    const details: Record<string, ReturnType<typeof source<string>>> = { A: source(), B: source() };
    const subscribed: string[] = [];
    const results: string[] = [];
    const unsubscribe = withDetails(
      main.subscribe,
      (s) => s.key,
      (a, b) => a === b,
      (key) => (onValue) => {
        subscribed.push(key);
        return details[key].subscribe(onValue);
      },
      (s, d) => `${s.value}/${d}`,
    )((r) => results.push(r));

    main.emit({ key: "A", value: 1 });
    expect(results).toEqual([]); // 하위 첫 값 전에는 내보내지 않는다
    details.A.emit("A-0");
    main.emit({ key: "A", value: 2 });
    details.A.emit("A-1");
    main.emit({ key: "B", value: 3 });
    details.B.emit("B-0");

    expect(subscribed).toEqual(["A", "B"]);
    expect(details.A.active).toBe(0);
    expect(details.B.active).toBe(1);
    expect(results).toEqual(["1/A-0", "2/A-0", "2/A-1", "3/B-0"]);
    unsubscribe();
    expect(main.active).toBe(0);
    expect(details.B.active).toBe(0);
  });
});

describe("combineAll", () => {
  it("전부 한 번씩 값을 준 뒤부터 최신 값을 모아 준다", () => {
    const a = source<number>();
    const b = source<number>();
    const results: number[][] = [];
    combineAll([a.subscribe, b.subscribe])((v) => results.push(v));
    a.emit(1);
    b.emit(2);
    a.emit(3);
    expect(results).toEqual([[1, 2], [3, 2]]);
  });

  it("빈 목록이면 빈 배열을 바로 준다", () => {
    const results: number[][] = [];
    combineAll<number>([])((v) => results.push(v));
    expect(results).toEqual([[]]);
  });
});
