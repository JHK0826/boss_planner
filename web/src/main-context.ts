import { createContext, useContext } from "react";
import type { CharacterInfo, CharacterScheduler, Party, UserProfile } from "./lib/model";
import type { PartyStatus } from "./lib/partyStatus";

export type PartySort = "todo" | "character" | "name" | "recent";
export const PARTY_SORTS: { value: PartySort; label: string }[] = [
  { value: "todo", label: "할 일 먼저" },
  { value: "character", label: "캐릭터순" },
  { value: "name", label: "파티 이름순" },
  { value: "recent", label: "최근 가입순" },
];

/** 로그인 뒤 여러 화면이 같이 쓰는 값 (Android MainScreen이 들고 있는 상태와 같음) */
export interface MainState {
  uid: string;
  profile: UserProfile;
  /** 내 파티. 받아 오는 중이면 undefined */
  parties: Party[] | undefined;
  /** 파티별 내가 할 일. 아직 못 읽은 파티는 null */
  statuses: Record<string, PartyStatus | null>;
  todoCount: number;
  /** 골라 둔 캐릭터의 기본 정보. 받아 오는 중이면 undefined */
  characters: CharacterInfo[] | undefined;
  partyFilter: string | null;
  setPartyFilter: (characterId: string | null) => void;
  partySort: PartySort;
  setPartySort: (sort: PartySort) => void;
  /** 캐릭터별 게임 스케줄러. 아직 안 받았으면 undefined */
  scheduler: Record<string, CharacterScheduler> | undefined;
  schedulerLoading: boolean;
  /** 받지 못했을 때 이유 (API Key 없음, 네트워크 등) */
  schedulerError: string | null;
  /** 스케줄러를 받는다. 받은 적이 있으면 refresh일 때만 다시 받는다 */
  loadScheduler: (refresh?: boolean) => void;
}

export const MainContext = createContext<MainState | null>(null);

export function useMain(): MainState {
  const value = useContext(MainContext);
  if (!value) throw new Error("MainContext가 없습니다.");
  return value;
}
