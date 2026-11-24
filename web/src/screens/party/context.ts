// 파티 화면(하단 탭 4개)이 같이 쓰는 값. 바깥 틀(PartyScreen)이 한 번 구독해서 탭에 넘긴다.
import { createContext, useContext } from "react";
import type { Party, PartyMember, Schedule, Unavailable, Vote } from "../../lib/model";

/** 확인 대화상자를 거쳐서 하는 일 */
export type Confirm =
  | { kind: "startNow" }
  | { kind: "leave" }
  | { kind: "delegate"; member: PartyMember }
  | { kind: "lock"; index: number; label: string }
  | { kind: "record"; cleared: boolean }
  | { kind: "requestChange" };

export interface PartyContextValue {
  uid: string;
  party: Party;
  /** 최근 일정들(최신순). 받아 오는 중이면 undefined */
  schedules: Schedule[] | undefined;
  /** 가장 최근 주기의 일정 */
  schedule: Schedule | undefined;
  /** 가장 최근 주기의 불가 시간·투표 (uid → 값) */
  unavailable: Record<string, Unavailable>;
  votes: Record<string, Vote>;
  /** 파티원 캐릭터 이미지 (uid → 주소) */
  memberImages: Record<string, string>;
  /** 화면 표시용 시각 (30초마다 바뀜). 마감·권한 검사는 서버가 한다 */
  now: number;
  busy: boolean;
  /** 서버에 보내고 결과를 화면 아래 알림으로 보여 준다. @returns 성공했는가 */
  run: (success: string | null, action: () => Promise<unknown>) => Promise<boolean>;
  /** 확인 대화상자를 띄운다 */
  ask: (confirm: Confirm) => void;
  /** 투표·정산 탭에 내가 할 일이 있는가. 일정 데이터를 다 읽기 전에는 null */
  todos: { vote: boolean; settlement: boolean } | null;
}

export const PartyContext = createContext<PartyContextValue | null>(null);

export function useParty(): PartyContextValue {
  const value = useContext(PartyContext);
  if (!value) throw new Error("PartyContext가 없습니다.");
  return value;
}

export const memberLabelOf = (member: PartyMember) => member.displayName || member.characterName;
