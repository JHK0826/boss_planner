import { useCallback, useEffect, useRef, useState } from "react";
import { Navigate, NavLink, Outlet, Route, Routes, useLocation } from "react-router-dom";
import * as api from "./data/api";
import { configured } from "./firebase";
import { MainContext, type MainState, type PartySort } from "./main-context";
import type { CharacterInfo, CharacterScheduler } from "./lib/model";
import { partyStatus, type PartySnapshot } from "./lib/partyStatus";
import { isFresh, loadSavedScheduler, partyKeyOf, saveScheduler } from "./lib/schedulerCache";
import { combineAll } from "./lib/subscribe";
import { useNow, usePageVisible, useSessionState, useSubscription } from "./lib/useSubscription";
import { ApiKeyScreen } from "./screens/ApiKeyScreen";
import { AuthScreen } from "./screens/AuthScreen";
import { CharacterSelectScreen } from "./screens/CharacterSelectScreen";
import { CreatePartyScreen } from "./screens/CreatePartyScreen";
import { EarningsScreen } from "./screens/EarningsScreen";
import { GuideScreen } from "./screens/GuideScreen";
import { JoinPartyScreen } from "./screens/JoinPartyScreen";
import { PartyIndex, PartyScreen } from "./screens/PartyScreen";
import { InfoTab } from "./screens/party/InfoTab";
import { SettingsTab as PartySettingsTab } from "./screens/party/SettingsTab";
import { SettlementTab } from "./screens/party/SettlementTab";
import { VoteTab } from "./screens/party/VoteTab";
import { RoutineScreen } from "./screens/RoutineScreen";
import { UnavailableScreen } from "./screens/UnavailableScreen";
import { CharactersTab, PartiesTab, SettingsTab, TimetableTab } from "./screens/tabs";
import { onForegroundPush, refreshPush } from "./lib/push";
import { Loading, useToast } from "./ui/common";

export function App() {
  const [uid, setUid] = useState<string | null | undefined>(undefined);
  useEffect(() => api.onAuth(setUid), []);
  const profile = useSubscription(uid ? api.profile(uid) : null, [uid]);

  if (!configured) {
    return (
      <div className="page centered">
        <h1>설정이 필요합니다</h1>
        <p className="muted">web/.env.local에 Firebase 웹 설정값을 넣고 다시 빌드해 주세요. web/.env.example을 참고하세요.</p>
      </div>
    );
  }
  if (uid === undefined) return <Loading />;
  if (uid === null) return <AuthScreen />;
  if (!profile) return <Loading />;
  // 온보딩: API Key 등록 → 캐릭터 선택 → 메인
  if (!profile.apiKeyRegistered) return <ApiKeyScreen />;
  if (profile.selectedCharacterIds.length === 0) return <CharacterSelectScreen uid={uid} initiallySelected={[]} />;

  return (
    <Routes>
      <Route element={<MainLayout uid={uid} profile={profile} />}>
        <Route index element={<Navigate to="/parties" replace />} />
        <Route path="parties" element={<PartiesTab />} />
        <Route path="characters" element={<CharactersTab />} />
        <Route path="timetable" element={<TimetableTab />} />
        <Route path="settings" element={<SettingsTab />} />
        <Route path="parties/new" element={<CreatePartyScreen />} />
        <Route path="parties/join" element={<JoinPartyScreen />} />
        {/* 파티 화면: 하단 탭 4개. 불가 시간 입력은 탭 없이 전체 화면으로 연다. */}
        <Route path="parties/:partyId" element={<PartyScreen />}>
          <Route index element={<PartyIndex />} />
          <Route path="info" element={<InfoTab />} />
          <Route path="vote" element={<VoteTab />} />
          <Route path="settlement" element={<SettlementTab />} />
          <Route path="settlement/:periodId" element={<SettlementTab />} />
          <Route path="settings" element={<PartySettingsTab />} />
        </Route>
        <Route path="parties/:partyId/unavailable/:periodId" element={<UnavailableScreen />} />
        <Route path="characters/select" element={<CharacterSelectScreen uid={uid} initiallySelected={profile.selectedCharacterIds} editing />} />
        <Route path="characters/:characterId/earnings" element={<EarningsScreen />} />
        <Route path="settings/api-key" element={<ApiKeyScreen editing />} />
        <Route path="settings/guide" element={<GuideScreen />} />
        <Route path="timetable/routine" element={<RoutineScreen />} />
        <Route path="*" element={<Navigate to="/parties" replace />} />
      </Route>
    </Routes>
  );
}

const TAB_PATHS = ["/parties", "/characters", "/timetable", "/settings"];

function MainLayout({ uid, profile }: { uid: string; profile: MainState["profile"] }) {
  const { pathname } = useLocation();
  const toast = useToast();
  const parties = useSubscription(api.myParties(uid), [uid]);

  // 알림: 켜 둔 기기면 토큰을 다시 저장하고(바뀌었을 수 있음), 앱을 보고 있을 때 온 알림은 화면 아래에 보여 준다.
  useEffect(() => {
    refreshPush(uid).catch(() => {});
    return onForegroundPush(toast);
  }, [uid, toast]);
  const [partyFilter, setPartyFilter] = useSessionState<string | null>("partyFilter", null);
  const [partySort, setPartySort] = useSessionState<PartySort>("partySort", "todo");

  // 골라 둔 캐릭터의 기본 정보 (getCharacterInfo가 캐시해 둔 값)
  const [characters, setCharacters] = useState<CharacterInfo[] | undefined>(undefined);
  const selectedKey = profile.selectedCharacterIds.join(",");
  useEffect(() => {
    let cancelled = false;
    api.cachedCharacters(uid, profile.selectedCharacterIds).then(
      (list) => !cancelled && setCharacters(list),
      () => !cancelled && setCharacters([]),
    );
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid, selectedKey]);

  // 파티마다 내가 할 일. 파티 탭을 보고 있고 페이지가 화면에 보일 때만 지켜본다.
  // 다른 화면에 있는 동안은 마지막으로 읽은 값을 쓴다 (Android와 같음).
  const visible = usePageVisible();
  const watching = pathname === "/parties" && visible;
  const ids = (parties ?? []).map((p) => p.id);
  const idsKey = ids.join(",");
  const [snapshots, setSnapshots] = useState<Record<string, PartySnapshot>>({});
  useEffect(() => {
    setSnapshots((previous) => Object.fromEntries(Object.entries(previous).filter(([id]) => ids.includes(id))));
    if (!watching || ids.length === 0) return;
    return combineAll(ids.map((id) => (onValue: (v: [string, PartySnapshot]) => void) => api.partySnapshot(id)((s) => onValue([id, s]))))(
      (entries) => setSnapshots(Object.fromEntries(entries)),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idsKey, watching]);

  const now = useNow();
  const statuses = Object.fromEntries((parties ?? []).map((p) => [p.id, partyStatus(uid, p, snapshots[p.id], now)]));
  const todoCount = Object.values(statuses).filter((s) => s?.needsAction).length;

  // 게임 스케줄러: 내 캐릭터 탭이나 수익 화면을 처음 열 때, 이 기기에 저장해 둔 값을 바로 보여 준다.
  // 저장한 값이 1시간이 지났거나 주·달·파티 구성이 바뀌었을 때만 서버를 부른다(서버도 1시간 동안 NEXON을 다시 부르지 않는다).
  const [scheduler, setScheduler] = useState<Record<string, CharacterScheduler> | undefined>(undefined);
  const [schedulerLoading, setSchedulerLoading] = useState(false);
  const [schedulerError, setSchedulerError] = useState<string | null>(null);
  const schedulerRequested = useRef(false);
  const partyKey = useRef<string | null>(null);
  partyKey.current = partyKeyOf(parties);
  const loadScheduler = useCallback(
    (refresh = false) => {
      if (schedulerRequested.current && !refresh) return;
      schedulerRequested.current = true;
      if (!refresh) {
        const saved = loadSavedScheduler(uid);
        if (saved && saved.characterKey === selectedKey) {
          setScheduler(saved.characters);
          if (isFresh(saved, { characterKey: selectedKey, partyKey: partyKey.current, nowMs: Date.now() })) return;
        }
      }
      setSchedulerLoading(true);
      api.getSchedulerState(refresh).then(
        (result) => {
          setScheduler(result);
          setSchedulerError(null);
          saveScheduler(uid, { savedAt: Date.now(), characterKey: selectedKey, partyKey: partyKey.current, characters: result });
        },
        (error) => setSchedulerError(api.userMessage(error)),
      ).finally(() => setSchedulerLoading(false));
    },
    [uid, selectedKey],
  );
  // 캐릭터를 다시 고르면 새로 받는다. 처음 그릴 때는 건너뛴다(내 캐릭터 탭이 먼저 불러 둔 값을 지우지 않게).
  const lastSelectedKey = useRef(selectedKey);
  useEffect(() => {
    if (lastSelectedKey.current === selectedKey) return;
    lastSelectedKey.current = selectedKey;
    schedulerRequested.current = false;
    setScheduler(undefined);
  }, [selectedKey]);

  const state: MainState = {
    uid,
    profile,
    parties,
    statuses,
    todoCount,
    characters,
    partyFilter,
    setPartyFilter,
    partySort,
    setPartySort,
    scheduler,
    schedulerLoading,
    schedulerError,
    loadScheduler,
  };
  return (
    <MainContext.Provider value={state}>
      <Outlet />
      {TAB_PATHS.includes(pathname) && <TabBar todoCount={todoCount} />}
    </MainContext.Provider>
  );
}

const ICONS = {
  characters: "M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z",
  parties: "M3 13h2v-2H3v2zm0 4h2v-2H3v2zm0-8h2V7H3v2zm4 4h14v-2H7v2zm0 4h14v-2H7v2zM7 7v2h14V7H7z",
  timetable: "M19 4h-1V2h-2v2H8V2H6v2H5c-1.11 0-2 .9-2 2v14c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 16H5V9h14v11z",
  settings:
    "M19.14 12.94c.04-.3.06-.61.06-.94s-.02-.64-.07-.94l2.03-1.58c.18-.14.23-.41.12-.61l-1.92-3.32c-.12-.22-.37-.29-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54c-.04-.24-.24-.41-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58c-.18.14-.23.41-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z",
};

function TabBar({ todoCount }: { todoCount: number }) {
  const tabs: [string, string, string][] = [
    ["/characters", "내 캐릭터", ICONS.characters],
    ["/parties", "파티", ICONS.parties],
    ["/timetable", "시간표", ICONS.timetable],
    ["/settings", "설정", ICONS.settings],
  ];
  return (
    <div className="tabs">
      <nav>
        {tabs.map(([to, label, icon]) => (
          <NavLink key={to} to={to} className={({ isActive }) => (isActive ? "active" : "")}>
            <span className="icon">
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d={icon} />
              </svg>
            </span>
            {label}
            {/* 파티 메뉴에는 할 일이 있는 파티 수를 붙인다. */}
            {to === "/parties" && todoCount > 0 && <span className="count">{todoCount}</span>}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
