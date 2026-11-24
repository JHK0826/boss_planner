// 실시간 구독을 조합하는 도구. Firestore onSnapshot처럼 "콜백을 받고 해제 함수를 돌려주는" 구독을 다룬다.

/** 콜백으로 값을 받는 구독. 돌려준 함수를 부르면 해제된다. */
export type Subscribe<T> = (onValue: (value: T) => void) => () => void;

/** 이미 알고 있는 값을 한 번 주는 구독 */
export const constant =
  <T>(value: T): Subscribe<T> =>
  (onValue) => {
    onValue(value);
    return () => {};
  };

/** 여러 구독의 최신 값을 모아 준다. 전부 한 번씩 값을 준 뒤부터 내보낸다. */
export function combineAll<T>(sources: Subscribe<T>[]): Subscribe<T[]> {
  return (onValue) => {
    if (sources.length === 0) {
      onValue([]);
      return () => {};
    }
    const values: T[] = new Array(sources.length);
    const seen = new Array<boolean>(sources.length).fill(false);
    const unsubscribes = sources.map((source, i) =>
      source((value) => {
        values[i] = value;
        seen[i] = true;
        if (seen.every(Boolean)) onValue([...values]);
      }),
    );
    return () => unsubscribes.forEach((unsubscribe) => unsubscribe());
  };
}

/**
 * 원래 값(source)과, 그 값에 따라 정해지는 하위 값(details)을 함께 내보낸다 (Android FlowUtils.withDetails와 같음).
 *
 * 하위 구독은 keyOf(원래 값)이 바뀔 때만 끊고 다시 붙인다. 원래 값이 바뀌어도 키가 같으면 하위 구독은 그대로 두고
 * 새 원래 값만 반영한다. 새로 붙인 하위 구독이 첫 값을 줄 때까지는 내보내지 않는다.
 */
export function withDetails<S, K, D, R>(
  source: Subscribe<S>,
  keyOf: (value: S) => K,
  sameKey: (a: K, b: K) => boolean,
  details: (key: K) => Subscribe<D>,
  merge: (value: S, detail: D) => R,
): Subscribe<R> {
  return (onValue) => {
    let latest: { value: S } | null = null;
    let key: { value: K } | null = null;
    let current: { value: D } | null = null;
    let unsubscribeDetails: (() => void) | null = null;

    const publish = () => {
      if (latest && current) onValue(merge(latest.value, current.value));
    };

    const unsubscribeSource = source((value) => {
      latest = { value };
      const newKey = keyOf(value);
      if (!key || !sameKey(key.value, newKey)) {
        key = { value: newKey };
        current = null;
        unsubscribeDetails?.();
        unsubscribeDetails = details(newKey)((detail) => {
          current = { value: detail };
          publish();
        });
      } else {
        publish();
      }
    });

    return () => {
      unsubscribeSource();
      unsubscribeDetails?.();
    };
  };
}
