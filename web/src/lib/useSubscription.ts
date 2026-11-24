import { useEffect, useState } from "react";
import type { Subscribe } from "./subscribe";

/**
 * 구독의 최신 값. 첫 값이 오기 전에는 undefined (로딩 표시용).
 * deps가 바뀌면 다시 구독하고 undefined부터 시작한다. subscribe가 null이면 구독하지 않는다.
 */
export function useSubscription<T>(subscribe: Subscribe<T> | null, deps: unknown[]): T | undefined {
  const [state, setState] = useState<{ deps: unknown[]; value: T } | undefined>(undefined);
  useEffect(() => {
    if (!subscribe) return;
    return subscribe((value) => setState({ deps, value }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  // 다른 deps로 받은 값은 쓰지 않는다 (잠깐 이전 파티의 값이 보이는 일 방지).
  return state && state.deps.length === deps.length && state.deps.every((d, i) => Object.is(d, deps[i])) ? state.value : undefined;
}

/** 페이지가 화면에 보이는가. 보이지 않는 동안 구독을 멈추는 데 쓴다 (Android의 앱이 화면에 떠 있을 때만 구독과 같음). */
export function usePageVisible(): boolean {
  const [visible, setVisible] = useState(() => document.visibilityState === "visible");
  useEffect(() => {
    const update = () => setVisible(document.visibilityState === "visible");
    document.addEventListener("visibilitychange", update);
    return () => document.removeEventListener("visibilitychange", update);
  }, []);
  return visible;
}

/** 1분마다 바뀌는 현재 시각 (레이드 시작처럼 시간이 지나서 바뀌는 표시용) */
export function useNow(intervalMs = 60_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

/** 탭(브라우저 창) 안에서만 유지되는 상태. 다른 화면에 다녀와도 남는다. */
export function useSessionState<T>(key: string, initial: T): [T, (value: T) => void] {
  const [value, setValue] = useState<T>(() => {
    try {
      const saved = sessionStorage.getItem(key);
      return saved === null ? initial : (JSON.parse(saved) as T);
    } catch {
      return initial;
    }
  });
  const update = (next: T) => {
    setValue(next);
    try {
      sessionStorage.setItem(key, JSON.stringify(next));
    } catch {
      // 저장하지 못해도 화면 상태는 바뀐다.
    }
  };
  return [value, update];
}
