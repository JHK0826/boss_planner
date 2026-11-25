// 파티 화면: 하단 탭 4개(파티 / 투표 / 정산 / 설정)의 바깥 틀 (Android ui/PartyScreen.kt와 같은 구성).
// 파티·최근 일정·불가 시간·투표는 여기서 한 번 구독해 탭에 넘긴다. 정산 채팅·분배금은 정산 탭을 열었을 때만 구독한다.
import { useEffect, useState } from "react";
import { Navigate, NavLink, Outlet, useLocation, useNavigate, useParams } from "react-router-dom";
import * as api from "../data/api";
import { useMain } from "../main-context";
import { mercenaryDisplayName, type Party, type Schedule, type SettlementEntry } from "../lib/model";
import { partyStatus, snapshotTargets, tabTodos } from "../lib/partyStatus";
import { combineAll, constant } from "../lib/subscribe";
import { useNow, useSubscription } from "../lib/useSubscription";
import { Dialog, Loading, useToast } from "../ui/common";
import { type Confirm, memberLabelOf, PartyContext, type PartyContextValue, periodWord, useParty } from "./party/context";

export function PartyScreen() {
  const { partyId = "" } = useParams();
  const { uid } = useMain();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const toast = useToast();

  const party = useSubscription(api.party(partyId), [partyId]);
  const schedules = useSubscription(api.recentSchedules(partyId), [partyId]);
  const schedule = schedules?.[0];
  const periodId = schedule?.id ?? null;
  const unavailableSub = useSubscription(periodId ? api.unavailable(partyId, periodId) : null, [partyId, periodId]);
  const votesSub = useSubscription(periodId ? api.votes(partyId, periodId) : null, [partyId, periodId]);
  // 탭 배지용: 정산이 진행 중인 주기의 분배금 상태만 지켜본다.
  const settlementIds = schedules ? snapshotTargets(schedules).settlementPeriods : [];
  const settlementKey = settlementIds.join(",");
  const settlementsSub = useSubscription(
    settlementIds.length === 0
      ? constant<[string, SettlementEntry[]][]>([])
      : combineAll(
          settlementIds.map((id) => (onValue: (v: [string, SettlementEntry[]]) => void) => api.settlementEntries(partyId, id)((e) => onValue([id, e]))),
        ),
    [partyId, settlementKey],
  );
  const unavailable = unavailableSub ?? {};
  const votes = votesSub ?? {};

  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  // 파티원 캐릭터 이미지 (uid → 주소)
  const [memberImages, setMemberImages] = useState<Record<string, string>>({});
  const memberKey = party ? Object.values(party.members).map((m) => `${m.uid}:${m.characterId}`).sort().join(",") : "";
  useEffect(() => {
    if (!party) return;
    let cancelled = false;
    api.memberImages(party).then((images) => !cancelled && setMemberImages(images));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [memberKey]);

  const now = useNow(30_000);

  // 탈퇴했거나 파티가 없어지면 파티 목록으로 돌아간다.
  useEffect(() => {
    if (party === null) navigate("/parties", { replace: true });
  }, [party, navigate]);
  if (!party) return <Loading />;

  async function run(success: string | null, action: () => Promise<unknown>): Promise<boolean> {
    setBusy(true);
    try {
      await action();
      if (success) toast(success);
      return true;
    } catch (error) {
      toast(api.userMessage(error));
      return false;
    } finally {
      setBusy(false);
    }
  }

  // 탭 배지: 파티 목록과 같은 할 일 계산을 쓰고, 정산 할 일과 나머지를 나눈다. 다 읽기 전에는 계산하지 않는다.
  const loaded =
    schedules !== undefined && (periodId === null || (unavailableSub !== undefined && votesSub !== undefined)) && settlementsSub !== undefined;
  const todos = loaded
    ? tabTodos(partyStatus(uid, party, { schedules, unavailable, votes, settlements: Object.fromEntries(settlementsSub) }, now))
    : null;

  const value: PartyContextValue = {
    uid,
    party,
    schedules,
    schedule,
    unavailable,
    votes,
    memberImages,
    now,
    busy,
    run,
    ask: setConfirm,
    todos,
  };
  // 정산 탭은 채팅이 남은 높이를 다 쓰도록 화면 높이에 맞춘다.
  const fill = pathname.includes("/settlement");

  return (
    <PartyContext.Provider value={value}>
      <div className={`page with-tabs ${fill ? "fill" : ""}`}>
        <button className="btn-text" style={{ alignSelf: "flex-start" }} disabled={busy} onClick={() => navigate("/parties")}>
          ← 파티 목록
        </button>
        <h1 style={{ margin: 0 }}>{party.name}</h1>
        <Outlet />
      </div>
      <PartyTabBar todos={todos} />
      {confirm && (
        <ConfirmDialog
          confirm={confirm}
          party={party}
          schedule={schedule}
          uid={uid}
          onClose={() => setConfirm(null)}
          onRun={(success, action) => {
            setConfirm(null);
            void run(success, action);
          }}
        />
      )}
    </PartyContext.Provider>
  );
}

/**
 * /parties/:partyId 로 들어왔을 때 처음 보여 줄 탭: 투표 탭에 할 일이 있으면 투표, 정산 할 일이 있으면 정산, 아니면 파티.
 * 알림을 눌러 들어와도 같다.
 */
export function PartyIndex() {
  const { todos } = useParty();
  if (!todos) return <Loading />;
  return <Navigate to={todos.vote ? "vote" : todos.settlement ? "settlement" : "info"} replace />;
}

const ICONS = {
  info: "M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z",
  vote: "M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z",
  settlement:
    "M11.8 10.9c-2.27-.59-3-1.2-3-2.15 0-1.09 1.01-1.85 2.7-1.85 1.78 0 2.44.85 2.5 2.1h2.21c-.07-1.72-1.12-3.3-3.21-3.81V3h-3v2.16c-1.94.42-3.5 1.68-3.5 3.61 0 2.31 1.91 3.46 4.7 4.13 2.5.6 3 1.48 3 2.41 0 .69-.49 1.79-2.7 1.79-2.06 0-2.87-.92-2.98-2.1h-2.2c.12 2.19 1.76 3.42 3.68 3.83V21h3v-2.15c1.95-.37 3.5-1.5 3.5-3.55 0-2.84-2.43-3.81-4.7-4.4z",
  settings:
    "M19.14 12.94c.04-.3.06-.61.06-.94s-.02-.64-.07-.94l2.03-1.58c.18-.14.23-.41.12-.61l-1.92-3.32c-.12-.22-.37-.29-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54c-.04-.24-.24-.41-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58c-.18.14-.23.41-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z",
};

/** 파티 화면 하단 탭. 투표·정산 탭에 내가 할 일이 있으면 점을 붙인다. */
function PartyTabBar({ todos }: { todos: { vote: boolean; settlement: boolean } | null }) {
  const tabs: [string, string, string, boolean][] = [
    ["info", "파티", ICONS.info, false],
    ["vote", "투표", ICONS.vote, todos?.vote ?? false],
    ["settlement", "정산", ICONS.settlement, todos?.settlement ?? false],
    ["settings", "설정", ICONS.settings, false],
  ];
  return (
    <div className="tabs">
      <nav aria-label="파티 메뉴">
        {tabs.map(([to, label, icon, dot]) => (
          <NavLink key={to} to={to} replace className={({ isActive }) => (isActive ? "active" : "")}>
            <span className="icon">
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d={icon} />
              </svg>
            </span>
            {label}
            {dot && <span className="dot" aria-label="할 일 있음" />}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}

function ConfirmDialog({
  confirm,
  party,
  schedule,
  uid,
  onClose,
  onRun,
}: {
  confirm: Confirm;
  party: Party;
  schedule: Schedule | undefined;
  uid: string;
  onClose: () => void;
  onRun: (success: string, action: () => Promise<unknown>) => void;
}) {
  const [reason, setReason] = useState("");
  const partyId = party.id;
  const isWeekly = party.cycle === "WEEKLY";
  const ok = (text: string, success: string, action: () => Promise<unknown>) => (
    <>
      <button className="btn-text" onClick={onClose}>
        취소
      </button>
      <button className="btn-text" onClick={() => onRun(success, action)}>
        {text}
      </button>
    </>
  );

  switch (confirm.kind) {
    case "startNow":
      return (
        <Dialog title="이번 주기 지금 시작" onClose={onClose} actions={ok("시작", "이번 주기 일정을 시작했습니다", () => api.startSchedule(partyId))}>
          <p style={{ margin: 0 }}>
            지금 일정을 열면 파티원 {party.memberUids.length}명에게 알림이 가고, 오늘 23:59까지 불가 시간을 입력하게 됩니다.
          </p>
          <p style={{ margin: 0 }}>
            시작한 뒤에는 가입과 탈퇴가 {isWeekly ? "목요일" : "매월 1일"}로 제한됩니다. 파티원이 다 모였는지 확인해 주세요.
          </p>
        </Dialog>
      );
    case "lock":
      return (
        <Dialog
          title="일정 확정"
          onClose={onClose}
          actions={ok("확정", "일정을 확정했습니다", () => api.confirmSchedule(partyId, schedule!.id, confirm.index))}
        >
          <p style={{ margin: 0 }}>{confirm.label}로 확정할까요? 파티원이 속한 다른 파티 일정과 겹치면 확정되지 않습니다.</p>
        </Dialog>
      );
    case "record":
      return (
        <Dialog
          title={confirm.cleared ? "클리어 기록" : "미클리어 기록"}
          onClose={onClose}
          actions={ok(
            "기록",
            confirm.cleared ? "클리어로 기록했습니다" : "미클리어로 기록했습니다. 남은 기간에서 다시 조율합니다",
            () => api.recordClear(partyId, schedule!.id, uid, confirm.cleared),
          )}
        >
          <p style={{ margin: 0 }}>
            {confirm.cleared
              ? "클리어로 기록하면 일정이 완료 처리됩니다. 되돌릴 수 없습니다."
              : "미클리어로 기록하면 확정 시간이 풀리고 남은 기간 안에서 다시 조율합니다. 되돌릴 수 없습니다."}
          </p>
        </Dialog>
      );
    case "requestChange":
      return (
        <Dialog
          title="일정 변경 요청"
          onClose={onClose}
          actions={ok("요청", "변경을 요청했습니다. 파티장의 승인을 기다립니다", () => api.requestChange(partyId, schedule!.id, reason.trim()))}
        >
          <p style={{ margin: 0 }}>파티장이 승인하면 확정이 풀리고 다시 조율합니다. 승인 후 불가 시간을 고쳐 다시 제출해 주세요.</p>
          <div className="field">
            <label htmlFor="change-reason">사유 (선택)</label>
            <input id="change-reason" className="input" value={reason} maxLength={200} onChange={(e) => setReason(e.target.value)} />
          </div>
        </Dialog>
      );
    case "mercenaryReplace": {
      const locked = schedule?.state === "LOCKED";
      return (
        <Dialog
          title={`${periodWord(schedule)} 용병으로 대체`}
          onClose={onClose}
          actions={ok("대체", `${periodWord(schedule)}를 용병으로 대체했습니다`, () =>
            api.replaceWithMercenary(partyId, schedule!.id, reason.trim()),
          )}
        >
          <p style={{ margin: 0 }}>
            {locked
              ? "확정된 시간은 그대로 두고, 나는 이 레이드에서 빠집니다. 내 일정도 풀립니다. 확정된 뒤에는 대체를 취소할 수 없습니다."
              : "나는 이번 주기 불가 시간 입력과 투표에서 빠지고, 나머지 파티원으로 추천을 다시 계산합니다. 확정 전에는 취소할 수 있습니다."}
          </p>
          <p className="small muted" style={{ margin: 0 }}>
            용병은 분배금 1인분을 받고, 판매자가 직접 지급합니다.
          </p>
          <div className="field">
            <label htmlFor="mercenary-name">용병 이름 (선택)</label>
            <input id="mercenary-name" className="input" value={reason} maxLength={12} placeholder="용병" onChange={(e) => setReason(e.target.value)} />
          </div>
        </Dialog>
      );
    }
    case "mercenaryAdd":
      return (
        <Dialog
          title="임시 용병 추가"
          onClose={onClose}
          actions={ok("추가", "임시 용병을 추가했습니다", () => api.addMercenary(partyId, schedule!.id, reason.trim()))}
        >
          <p style={{ margin: 0 }}>
            {periodWord(schedule)}에만 인원이 한 명 늘어납니다. 용병은 시간 제약이 없어 추천에는 영향이 없고, 결정석은 늘어난 인원수로 나눕니다.
          </p>
          <p className="small muted" style={{ margin: 0 }}>
            용병은 분배금 1인분을 받고, 판매자가 직접 지급합니다.
          </p>
          <div className="field">
            <label htmlFor="mercenary-name">용병 이름 (선택)</label>
            <input id="mercenary-name" className="input" value={reason} maxLength={12} placeholder="용병 1" onChange={(e) => setReason(e.target.value)} />
          </div>
        </Dialog>
      );
    case "mercenaryRemove": {
      const replacement = confirm.mercenary.replaces !== null;
      return (
        <Dialog
          title={replacement ? "용병 대체 취소" : "임시 용병 빼기"}
          onClose={onClose}
          actions={ok(replacement ? "대체 취소" : "빼기", replacement ? "대체를 취소했습니다. 불가 시간을 확인해 주세요" : "임시 용병을 뺐습니다", () =>
            api.removeMercenary(partyId, schedule!.id, confirm.mercenary.id),
          )}
        >
          <p style={{ margin: 0 }}>
            {replacement
              ? "다시 이번 주기에 참여합니다. 불가 시간을 낸 적이 없다면 입력해야 추천이 나옵니다."
              : `${mercenaryDisplayName(party, confirm.mercenary)}을(를) 뺄까요?`}
          </p>
        </Dialog>
      );
    }
    case "leave":
      return (
        <Dialog title="파티 탈퇴" onClose={onClose} actions={ok("탈퇴", `${party.name}에서 탈퇴했습니다`, () => api.leaveParty(partyId))}>
          <p style={{ margin: 0 }}>
            {party.memberUids.length === 1 ? "마지막 파티원이 나가면 파티가 삭제됩니다. 탈퇴할까요?" : `${party.name}에서 탈퇴할까요?`}
          </p>
        </Dialog>
      );
    case "delegate":
      return (
        <Dialog
          title="파티장 위임"
          onClose={onClose}
          actions={ok("위임", `${memberLabelOf(confirm.member)}님에게 파티장을 넘겼습니다`, () => api.delegateLeader(partyId, confirm.member.uid))}
        >
          <p style={{ margin: 0 }}>{memberLabelOf(confirm.member)}에게 파티장을 넘길까요? 넘긴 뒤에는 새 파티장만 되돌릴 수 있습니다.</p>
        </Dialog>
      );
  }
}
