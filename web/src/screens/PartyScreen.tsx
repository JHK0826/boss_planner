// 파티 화면 (Android ui/PartyScreen.kt와 같은 동작·문구).
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import * as api from "../data/api";
import { useMain } from "../main-context";
import { periodColumns } from "../lib/grid";
import {
  acceptsInput,
  bossLabel,
  type Confirmed,
  type Party,
  type PartyMember,
  type Schedule,
  settlementOpen,
  type Unavailable,
  type Vote,
} from "../lib/model";
import { durationLabel } from "../lib/money";
import { useNow, useSubscription } from "../lib/useSubscription";
import { SLOT_MS, dateTime, dayLabel, dayWithWeekday, range, startOfDay, time } from "../lib/time";
import { Dialog, Loading, useToast } from "../ui/common";
import { type RecommendSettings, RecommendSettingsEditor, recommendSettingsSummary } from "../ui/party-forms";
import { SlotGrid } from "../ui/SlotGrid";

type Confirm =
  | { kind: "startNow" }
  | { kind: "settings" }
  | { kind: "leave" }
  | { kind: "delegate"; member: PartyMember }
  | { kind: "lock"; index: number; label: string }
  | { kind: "record"; cleared: boolean }
  | { kind: "requestChange" };

const label = (member: PartyMember) => member.displayName || member.characterName;

export function PartyScreen() {
  const { partyId = "" } = useParams();
  const { uid } = useMain();
  const navigate = useNavigate();
  const toast = useToast();

  const party = useSubscription(api.party(partyId), [partyId]);
  const schedules = useSubscription(api.recentSchedules(partyId), [partyId]);
  const schedule = schedules?.[0];
  // 다음 주기가 시작된 뒤에도 끝나지 않은 지난 주기 정산
  const pastSettlements = (schedules ?? []).slice(1).filter(settlementOpen);
  const periodId = schedule?.id ?? null;
  const unavailable = useSubscription(periodId ? api.unavailable(partyId, periodId) : null, [partyId, periodId]) ?? {};
  const votes = useSubscription(periodId ? api.votes(partyId, periodId) : null, [partyId, periodId]) ?? {};

  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  // 시간표를 보고 있는 파티원
  const [viewingMember, setViewingMember] = useState<PartyMember | null>(null);
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

  // 화면 표시용 시각. 마감·권한 검사는 서버가 서버 시각으로 한다.
  const now = useNow(30_000);

  // 탈퇴했거나 파티가 없어지면 파티 목록으로 돌아간다.
  useEffect(() => {
    if (party === null) navigate("/parties", { replace: true });
  }, [party, navigate]);
  if (!party) return <Loading />;

  /** 서버에 보내고 결과를 화면 아래 알림으로 보여 준다. */
  async function run(success: string | null, action: () => Promise<unknown>) {
    setBusy(true);
    try {
      await action();
      if (success) toast(success);
    } catch (error) {
      toast(api.userMessage(error));
    } finally {
      setBusy(false);
    }
  }

  const isLeader = party.leaderUid === uid;
  const isWeekly = party.cycle === "WEEKLY";
  const inputOpen = schedule ? acceptsInput(schedule) : false;
  // 이번 주기 일정이 아직 없으면 파티장이 바로 열 수 있다.
  const noCurrentSchedule = schedules !== undefined && (!schedule || schedule.periodEndMs <= now);

  return (
    <div className="page">
      <button className="btn-text" style={{ alignSelf: "flex-start" }} disabled={busy} onClick={() => navigate("/parties")}>
        ← 파티 목록
      </button>
      <h1>{party.name}</h1>
      <p style={{ margin: 0 }}>
        {bossLabel(party.bosses)}
        <br />
        {isWeekly ? "주간" : "월간"} · {durationLabel(party.durationMinutes)}
      </p>

      <InviteCard party={party} />

      <div className="row">
        <span className="small grow">추천 설정 · {recommendSettingsSummary(party.preferredWindow, party.minLeadMinutes)}</span>
        {isLeader && (
          <button className="btn-text" disabled={busy} onClick={() => setConfirm({ kind: "settings" })}>
            바꾸기
          </button>
        )}
      </div>

      <h2>파티원 {party.memberUids.length}명</h2>
      {party.memberUids.map((memberUid) => {
        const member = party.members[memberUid];
        if (!member) return null;
        return (
          <MemberRow
            key={memberUid}
            member={member}
            imageUrl={memberImages[memberUid]}
            isLeader={memberUid === party.leaderUid}
            isMe={memberUid === uid}
            status={memberStatus(schedule, unavailable[memberUid], votes[memberUid])}
            onClick={() => setViewingMember(member)}
            onDelegate={isLeader && memberUid !== uid && !busy ? () => setConfirm({ kind: "delegate", member }) : null}
          />
        );
      })}

      <h2 style={{ marginTop: 8 }}>이번 주기 일정</h2>
      <ScheduleSection
        party={party}
        schedule={schedule}
        loading={schedules === undefined}
        myUnavailable={unavailable[uid]}
        submittedCount={party.memberUids.filter((u) => unavailable[u]?.submitted).length}
        votes={votes}
        isLeader={isLeader}
        uid={uid}
        now={now}
        busy={busy}
        onVote={(agreed, round) =>
          run(agreed.length === 0 ? "모두 안 됨으로 투표했습니다" : "투표했습니다", () => api.setVote(partyId, schedule!.id, uid, agreed, round))
        }
        onAsk={setConfirm}
        onRespondToChange={(approve) =>
          run(approve ? "변경 요청을 승인했습니다. 다시 조율합니다" : "변경 요청을 거절했습니다", () =>
            api.respondToChange(partyId, schedule!.id, approve),
          )
        }
      />

      {isLeader && noCurrentSchedule && (
        <>
          <button className="btn full" disabled={busy} onClick={() => setConfirm({ kind: "startNow" })}>
            이번 주기 지금 시작
          </button>
          <p className="small muted" style={{ margin: 0 }}>
            파티원을 다 모은 뒤에 눌러 주세요. 시작하면 남은 기간 안에서 바로 일정을 조율합니다.
          </p>
        </>
      )}
      {inputOpen && schedule && (
        <button className="btn-outline full" disabled={busy} onClick={() => navigate(`/parties/${partyId}/unavailable/${schedule.id}`)}>
          {unavailable[uid]?.submitted ? "불가 시간 수정" : "불가 시간 입력"}
        </button>
      )}

      {schedule?.state === "SETTLED" && (
        <button className="btn full" disabled={busy} onClick={() => navigate(`/parties/${partyId}/settlement/${schedule.id}`)}>
          {!schedule.settlement ? "분배금 등록·정산 채팅" : schedule.settlement.completed ? "정산 완료 · 내역 보기" : "분배금 정산 진행 중"}
        </button>
      )}
      {pastSettlements.map((past) => (
        <button key={past.id} className="btn-outline full" disabled={busy} onClick={() => navigate(`/parties/${partyId}/settlement/${past.id}`)}>
          지난 주기 정산 ({past.confirmed ? dateTime(past.confirmed.startMs) : past.id})
        </button>
      ))}

      <button className="btn-text" style={{ alignSelf: "flex-start" }} disabled={busy} onClick={() => setConfirm({ kind: "leave" })}>
        파티 탈퇴
      </button>

      {viewingMember && (
        <MemberTimetableDialog
          member={viewingMember}
          // 끝난 주기의 일정은 "이번 주기"로 보지 않는다.
          schedule={schedule && schedule.periodEndMs > now ? schedule : null}
          entry={unavailable[viewingMember.uid]}
          now={now}
          onClose={() => setViewingMember(null)}
        />
      )}

      {confirm && (
        <ConfirmDialog
          confirm={confirm}
          party={party}
          schedule={schedule}
          onClose={() => setConfirm(null)}
          onRun={(success, action) => {
            setConfirm(null);
            void run(success, action);
          }}
          uid={uid}
        />
      )}
    </div>
  );
}

/** 초대 코드: 복사하거나 카카오톡 등으로 공유한다. */
function InviteCard({ party }: { party: Party }) {
  const toast = useToast();
  const isWeekly = party.cycle === "WEEKLY";

  async function copy(text: string, message: string) {
    try {
      await navigator.clipboard.writeText(text);
      toast(message);
    } catch {
      toast("복사하지 못했습니다. 코드를 길게 눌러 복사해 주세요.");
    }
  }

  async function share() {
    const text = [
      `[보스 스케줄 매니저] '${party.name}' 파티 초대`,
      bossLabel(party.bosses),
      `초대 코드: ${party.inviteCode}`,
      "앱의 파티 메뉴에서 '코드로 가입'을 누르고 코드를 입력해 주세요.",
      `아이폰·PC: ${location.origin}`,
    ].join("\n");
    if (navigator.share) {
      try {
        await navigator.share({ text });
      } catch {
        // 공유 창을 닫은 경우
      }
    } else {
      await copy(text, "초대 문구를 복사했습니다. 카카오톡 등에 붙여 넣어 주세요");
    }
  }

  return (
    <div className="card stack" style={{ gap: 4 }}>
      <span className="small muted">초대 코드</span>
      <div className="row">
        <span className="grow" style={{ fontFamily: "ui-monospace, Menlo, monospace", fontSize: 28, userSelect: "all" }}>
          {party.inviteCode}
        </span>
        <button className="btn-text" onClick={() => copy(party.inviteCode, "초대 코드를 복사했습니다")}>
          복사
        </button>
        <button className="btn-text" onClick={share}>
          공유
        </button>
      </div>
      <span className="small">
        {party.scheduleStarted
          ? `가입·탈퇴·위임은 ${isWeekly ? "목요일" : "매월 1일"}에, 일정이 확정되기 전에만 할 수 있습니다.`
          : "첫 일정을 시작하기 전까지는 언제든 가입할 수 있습니다."}
      </span>
    </div>
  );
}

/** 파티원 옆에 붙이는 진행 상태 */
function memberStatus(schedule: Schedule | undefined, entry: Unavailable | undefined, vote: Vote | undefined): string | null {
  if (!schedule || !acceptsInput(schedule)) return null;
  if (!entry?.submitted) return "미입력";
  if (schedule.candidates.length === 0) return "제출 완료";
  return vote?.round === schedule.round ? "투표 완료" : "투표 전";
}

function MemberRow({
  member,
  imageUrl,
  isLeader,
  isMe,
  status,
  onClick,
  onDelegate,
}: {
  member: PartyMember;
  imageUrl: string | undefined;
  isLeader: boolean;
  isMe: boolean;
  status: string | null;
  onClick: () => void;
  onDelegate: (() => void) | null;
}) {
  // 누르면 그 파티원의 이번 주기 불가 시간을 본다.
  return (
    <div className="row" role="button" tabIndex={0} style={{ cursor: "pointer" }} onClick={onClick} onKeyDown={(e) => e.key === "Enter" && onClick()}>
      {/* 이미지가 없어도 자리를 비워 두어 줄이 가지런하게 한다. */}
      {imageUrl ? <img className="avatar" src={imageUrl} alt="" loading="lazy" /> : <div className="avatar" />}
      <div className="grow">
        <div style={{ fontWeight: 600 }}>
          {label(member)}
          {isMe && " (나)"}
          {isLeader && " · 파티장"}
        </div>
        <div className="small muted">
          {member.characterName} · Lv.{member.level} {member.job}
        </div>
      </div>
      {status && (
        <span className={`small ${status === "미입력" || status === "투표 전" ? "error" : "primary-text"}`} style={{ fontWeight: 600 }}>
          {status}
        </span>
      )}
      {onDelegate && (
        <button
          className="btn-text"
          onClick={(e) => {
            e.stopPropagation();
            onDelegate();
          }}
        >
          위임
        </button>
      )}
    </div>
  );
}

function ScheduleSection({
  party,
  schedule,
  loading,
  myUnavailable,
  submittedCount,
  votes,
  isLeader,
  uid,
  now,
  busy,
  onVote,
  onAsk,
  onRespondToChange,
}: {
  party: Party;
  schedule: Schedule | undefined;
  loading: boolean;
  myUnavailable: Unavailable | undefined;
  submittedCount: number;
  votes: Record<string, Vote>;
  isLeader: boolean;
  uid: string;
  now: number;
  busy: boolean;
  onVote: (agreed: number[], round: number) => void;
  onAsk: (confirm: Confirm) => void;
  onRespondToChange: (approve: boolean) => void;
}) {
  const memberCount = party.memberUids.length;
  if (loading) return <Loading />;
  if (!schedule) {
    return (
      <p style={{ margin: 0 }}>
        아직 일정이 시작되지 않았습니다. 파티장이 '이번 주기 지금 시작'을 누르면 바로 열리고, 누르지 않으면 다음{" "}
        {party.cycle === "WEEKLY" ? "목요일" : "달 1일"} 00:00에 자동으로 열립니다.
      </p>
    );
  }
  const confirmed = schedule.confirmed;
  switch (schedule.state) {
    case "SKIPPED":
      return (
        <p style={{ margin: 0 }}>
          {schedule.skippedReason === "NO_AGREEMENT"
            ? "전원이 동의한 시간이 없어 이번 주기는 진행하지 않습니다."
            : schedule.skippedReason === "PERIOD_ENDED"
              ? "일정을 확정하지 못한 채 주기가 끝났습니다."
              : "전원이 겹치는 시간이 없어 이번 주기는 진행하지 않습니다."}
        </p>
      );
    case "SETTLED":
      return (
        <p className="primary-text" style={{ margin: 0, fontWeight: 600 }}>
          클리어 완료{confirmed ? ` · ${range(confirmed.startMs, confirmed.endMs)}` : ""}
        </p>
      );
    case "EXPIRED":
      return (
        <p style={{ margin: 0 }}>
          {schedule.expiredReason === "NOT_CLEARED"
            ? "미클리어로 끝났고 다시 잡을 기간이 남지 않았습니다."
            : schedule.expiredReason === "UNVERIFIED"
              ? "클리어 여부를 확인하지 못한 채 주기가 끝났습니다."
              : "다시 잡을 수 있는 시간이 없어 이번 주기는 종료되었습니다."}
        </p>
      );
  }
  if ((schedule.state === "LOCKED" || schedule.state === "VERIFYING") && confirmed) {
    return (
      <LockedSchedule
        schedule={schedule}
        confirmed={confirmed}
        party={party}
        isLeader={isLeader}
        uid={uid}
        now={now}
        busy={busy}
        onAsk={onAsk}
        onRespondToChange={onRespondToChange}
      />
    );
  }

  const myVote = votes[uid];
  const savedVote = myVote?.round === schedule.round ? myVote : undefined;
  return (
    <div className="stack">
      {schedule.state === "RETRY" && (
        <p className="small error" style={{ margin: 0 }}>
          미클리어로 재조정 중입니다 ({schedule.retryCount}번째). 이전 불가 시간으로 다시 추천합니다. 필요하면 불가 시간을 고쳐 주세요.
        </p>
      )}
      {schedule.candidates.length === 0 ? (
        <>
          <p style={{ margin: 0 }}>
            불가 시간 제출 {submittedCount}/{memberCount}명
            {schedule.state === "OPEN" && ` · 마감 ${dateTime(schedule.inputDeadlineMs - 60_000)}`}
          </p>
          <p className="small" style={{ margin: 0 }}>
            {myUnavailable?.submitted ? "전원이 제출하면 추천 시간이 나옵니다." : "아직 제출하지 않았습니다. 안 되는 시간이 없어도 제출해 주세요."}
          </p>
        </>
      ) : (
        <CandidateVoting
          // 후보가 바뀌거나(round) 저장된 투표가 바뀌면 선택을 처음부터 다시 한다.
          key={`${schedule.round}:${savedVote?.agreed.join(",") ?? "-"}`}
          schedule={schedule}
          memberCount={memberCount}
          votes={votes}
          savedVote={savedVote}
          isLeader={isLeader}
          busy={busy}
          onVote={onVote}
          onAsk={onAsk}
        />
      )}
    </div>
  );
}

/** 확정된 일정: 시작 전에는 변경 요청, 시작 후에는 결과 기록 */
function LockedSchedule({
  schedule,
  confirmed,
  party,
  isLeader,
  uid,
  now,
  busy,
  onAsk,
  onRespondToChange,
}: {
  schedule: Schedule;
  confirmed: Confirmed;
  party: Party;
  isLeader: boolean;
  uid: string;
  now: number;
  busy: boolean;
  onAsk: (confirm: Confirm) => void;
  onRespondToChange: (approve: boolean) => void;
}) {
  const card = (
    <div className="card stack" style={{ gap: 2 }}>
      <span className="small muted">확정된 시간</span>
      <span style={{ fontSize: 20, fontWeight: 600 }}>{range(confirmed.startMs, confirmed.endMs)}</span>
    </div>
  );
  let body: ReactNode;
  const request = schedule.changeRequest;
  if (now >= confirmed.startMs) {
    body = (
      <>
        <p style={{ margin: 0 }}>{now >= confirmed.endMs ? "레이드가 끝났나요? 결과를 기록해 주세요." : "레이드 진행 중입니다. 끝나면 결과를 기록해 주세요."}</p>
        <div className="row">
          <button className="btn grow" disabled={busy} onClick={() => onAsk({ kind: "record", cleared: true })}>
            클리어
          </button>
          <button className="btn-outline grow" disabled={busy} onClick={() => onAsk({ kind: "record", cleared: false })}>
            미클리어
          </button>
        </div>
        <p className="small muted" style={{ margin: 0 }}>
          기록하지 않으면 다음 날 05:00에 자동으로 확인합니다.
        </p>
      </>
    );
  } else if (request && request.status === "PENDING") {
    const requester = party.members[request.requestedBy];
    body = (
      <>
        <p style={{ margin: 0, whiteSpace: "pre-line" }}>
          {requester ? label(requester) : "파티원"} 님이 일정 변경을 요청했습니다.{request.reason.trim() ? `\n사유: ${request.reason}` : ""}
        </p>
        {isLeader ? (
          <div className="row">
            <button className="btn grow" disabled={busy} onClick={() => onRespondToChange(true)}>
              승인
            </button>
            <button className="btn-outline grow" disabled={busy} onClick={() => onRespondToChange(false)}>
              거절
            </button>
          </div>
        ) : (
          <p className="small muted" style={{ margin: 0 }}>
            파티장의 승인을 기다립니다.
          </p>
        )}
      </>
    );
  } else {
    // 변경 요청은 레이드 전날 23:59까지
    const deadline = startOfDay(confirmed.startMs);
    body = (
      <>
        {request?.status === "REJECTED" && request.requestedBy === uid && (
          <p className="small" style={{ margin: 0 }}>
            변경 요청이 거절되었습니다.
          </p>
        )}
        {now < deadline ? (
          <>
            <button className="btn-outline full" disabled={busy} onClick={() => onAsk({ kind: "requestChange" })}>
              일정 변경 요청
            </button>
            <p className="small muted" style={{ margin: 0 }}>
              변경 요청 마감: {dateTime(deadline - 60_000)}
            </p>
          </>
        ) : (
          <p className="small muted" style={{ margin: 0 }}>
            변경 요청 기간(레이드 전날 23:59까지)이 지났습니다.
          </p>
        )}
      </>
    );
  }
  return (
    <div className="stack">
      {card}
      {body}
    </div>
  );
}

function CandidateVoting({
  schedule,
  memberCount,
  votes,
  savedVote,
  isLeader,
  busy,
  onVote,
  onAsk,
}: {
  schedule: Schedule;
  memberCount: number;
  votes: Record<string, Vote>;
  savedVote: Vote | undefined;
  isLeader: boolean;
  busy: boolean;
  onVote: (agreed: number[], round: number) => void;
  onAsk: (confirm: Confirm) => void;
}) {
  const [selected, setSelected] = useState<Set<number>>(() => new Set(savedVote?.agreed ?? []));
  const currentVotes = Object.values(votes).filter((v) => v.round === schedule.round);
  const indices = schedule.candidates.map((_, i) => i);
  const allSelected = indices.every((i) => selected.has(i));
  const unchanged = savedVote !== undefined && savedVote.agreed.length === selected.size && savedVote.agreed.every((i) => selected.has(i));
  const toggle = (index: number) => {
    const next = new Set(selected);
    if (next.has(index)) next.delete(index);
    else next.add(index);
    setSelected(next);
  };

  return (
    <div className="stack" style={{ gap: 4 }}>
      <div className="row">
        <span className="small grow">가능한 시간에 모두 동의해 주세요. 전원이 동의한 시간 중에서 파티장이 확정합니다.</span>
        {/* 한 번에 전부 고르거나 비운다. 투표는 아래 버튼으로 보낸다(골라 놓고 몇 개만 뺄 수 있게). */}
        <button className="btn-text" disabled={busy} onClick={() => setSelected(allSelected ? new Set() : new Set(indices))}>
          {allSelected ? "모두 해제" : "모두 가능"}
        </button>
      </div>
      {schedule.candidates.map((candidate, index) => {
        const unanimous = schedule.unanimous.includes(index);
        // 후보는 시간순이다. 날짜가 바뀔 때마다 요일을 한 번 적어 요일별로 묶어 보이게 한다.
        const day = dayWithWeekday(candidate.startMs);
        const newDay = index === 0 || dayWithWeekday(schedule.candidates[index - 1].startMs) !== day;
        return (
          <div key={candidate.slotId} className="stack" style={{ gap: 0 }}>
            {newDay && (
              <span className="primary-text" style={{ fontWeight: 600, marginTop: 6 }}>
                {day}
              </span>
            )}
            <label className="row" style={{ padding: "6px 0", cursor: busy ? "default" : "pointer" }}>
              <input type="checkbox" className="check" checked={selected.has(index)} disabled={busy} onChange={() => toggle(index)} />
              <span className="grow" style={{ paddingLeft: 4 }}>
                <span style={{ fontWeight: 600 }}>
                  {time(candidate.startMs)} ~ {time(candidate.endMs)}
                </span>
                <br />
                <span className={`small ${unanimous ? "primary-text" : "muted"}`}>
                  {unanimous ? "전원 동의" : `동의 ${currentVotes.filter((v) => v.agreed.includes(index)).length}/${memberCount}명`}
                </span>
              </span>
              {unanimous && isLeader && (
                <button
                  className="btn"
                  disabled={busy}
                  onClick={(e) => {
                    e.preventDefault();
                    onAsk({ kind: "lock", index, label: range(candidate.startMs, candidate.endMs) });
                  }}
                >
                  확정
                </button>
              )}
            </label>
          </div>
        );
      })}
      <button className="btn-outline full" disabled={busy || unchanged} onClick={() => onVote([...selected], schedule.round)}>
        {!savedVote && selected.size === 0 ? "모두 안 됨으로 투표" : !savedVote ? "투표하기" : "투표 바꾸기"}
      </button>
      <p className="small" style={{ margin: 0 }}>
        {schedule.unanimous.length > 0 && isLeader
          ? "전원이 동의한 시간 중 하나를 확정해 주세요."
          : schedule.unanimous.length > 0
            ? "전원이 동의한 시간이 있습니다. 파티장의 확정을 기다립니다."
            : currentVotes.length < memberCount
              ? `투표 ${currentVotes.length}/${memberCount}명. 전원이 투표했는데 전원 동의가 없으면 다음 후보로 넘어갑니다.`
              : ""}
      </p>
    </div>
  );
}

/**
 * 파티원 한 명이 이 파티 이번 주기에 제출한 불가 시간을 보여 준다 (보기 전용).
 * 데이터는 파티 화면이 이미 받고 있는 이번 주기 불가 시간을 그대로 쓴다.
 */
function MemberTimetableDialog({
  member,
  schedule,
  entry,
  now,
  onClose,
}: {
  member: PartyMember;
  schedule: Schedule | null;
  entry: Unavailable | undefined;
  now: number;
  onClose: () => void;
}) {
  const columns = useMemo(() => (schedule ? periodColumns(schedule.periodStartMs, schedule.periodEndMs) : []), [schedule?.periodStartMs, schedule?.periodEndMs]);
  const selected = useMemo(() => new Set(entry?.slots ?? []), [entry]);
  return (
    <Dialog
      title={`${label(member)}님의 불가 시간`}
      wide
      onClose={onClose}
      actions={
        <button className="btn full" onClick={onClose}>
          닫기
        </button>
      }
    >
      <span className="small muted">
        {member.characterName} · Lv.{member.level} {member.job}
      </span>
      {!schedule ? (
        <p>이번 주기 일정이 아직 시작되지 않아 볼 시간표가 없습니다.</p>
      ) : (
        <>
          <span>
            {dayLabel(schedule.periodStartMs)} ~ {dayLabel(schedule.periodEndMs - 1)} ·{" "}
            {!entry ? "아직 입력하지 않았습니다" : entry.submitted ? "제출함" : "제출 전 (마지막으로 저장된 시간)"}
          </span>
          <div className="row" style={{ gap: 12 }}>
            <span className="legend">
              <i style={{ background: "var(--error)" }} />
              불가
            </span>
            <span className="legend">
              <i style={{ background: "var(--surface-variant)" }} />
              가능
            </span>
          </div>
          {/* 지난 시간은 흐리게 */}
          <SlotGrid columns={columns} selected={selected} pastBefore={Math.floor((now - schedule.periodStartMs) / SLOT_MS) + 1} />
        </>
      )}
    </Dialog>
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
  const [draft, setDraft] = useState<RecommendSettings>({ preferredWindow: party.preferredWindow, minLeadMinutes: party.minLeadMinutes });
  const [reason, setReason] = useState("");
  const partyId = party.id;
  const isWeekly = party.cycle === "WEEKLY";
  const cancel = (
    <button className="btn-text" onClick={onClose}>
      취소
    </button>
  );
  const ok = (text: string, success: string, action: () => Promise<unknown>) => (
    <>
      {cancel}
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
    case "settings":
      return (
        <Dialog
          title="추천 설정"
          onClose={onClose}
          actions={ok("저장", "추천 설정을 저장했습니다", () => api.updatePartyPreferences(partyId, draft.preferredWindow, draft.minLeadMinutes))}
        >
          <RecommendSettingsEditor settings={draft} onChange={setDraft} />
          {schedule && acceptsInput(schedule) && schedule.candidates.length > 0 && (
            <p className="small error" style={{ margin: 0 }}>
              지금 투표 중입니다. 설정을 바꾸면 추천 시간을 다시 계산하고 투표도 다시 합니다.
            </p>
          )}
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
          actions={ok("위임", `${label(confirm.member)}님에게 파티장을 넘겼습니다`, () => api.delegateLeader(partyId, confirm.member.uid))}
        >
          <p style={{ margin: 0 }}>{label(confirm.member)}에게 파티장을 넘길까요?</p>
        </Dialog>
      );
  }
}
