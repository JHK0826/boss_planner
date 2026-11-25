// 투표 탭: 이번 주기 일정 (불가 시간 입력, 추천·투표, 확정, 변경 요청, 결과 기록). Android PartyScreen.kt의 ScheduleTab과 같음.
// 이번 주 레이드가 끝나 다음 주 일정을 미리 열었으면, 이번 주 결과를 한 줄로 보여 주고 다음 주 입력·투표를 받는다(확정은 목요일부터).
import { type ReactNode, useState } from "react";
import { useNavigate } from "react-router-dom";
import * as api from "../../data/api";
import {
  acceptsInput,
  isAutoAssigned,
  isReplaced,
  participantUids,
  type Candidate,
  type Confirmed,
  type Party,
  type Schedule,
  type Vote,
} from "../../lib/model";
import { reasonText } from "../../lib/recommendReasons";
import { currentPeriodSchedule, isUpcoming } from "../../lib/partyStatus";
import { changeRequestDeadline, dateTime, dayLabel, dayWithWeekday, range, time, weekdayLabel } from "../../lib/time";
import { Loading } from "../../ui/common";
import { type Confirm, memberLabelOf, useParty } from "./context";

export function VoteTab() {
  const { uid, party, schedules, schedule, unavailable, votes, now, busy, run, ask } = useParty();
  const navigate = useNavigate();
  const isLeader = party.leaderUid === uid;
  const inputOpen = schedule ? acceptsInput(schedule) : false;
  // 이번 주기 일정이 아직 없으면 파티장이 바로 열 수 있다.
  const noCurrentSchedule = schedules !== undefined && (!schedule || schedule.periodEndMs <= now);
  // 미리 연 다음 주 일정
  const upcoming = isUpcoming(schedule, now);
  const thisWeek = upcoming && schedules ? currentPeriodSchedule(schedules, now) : undefined;
  // 이번 주기를 용병으로 대체했으면 입력·투표하지 않는다.
  const replaced = isReplaced(schedule, uid);

  return (
    <>
      {upcoming && schedule ? (
        <>
          {thisWeek && <p className="primary-text" style={{ margin: 0, fontWeight: 600 }}>{thisWeekResult(thisWeek)}</p>}
          <h2 style={{ marginTop: thisWeek ? 8 : 0 }}>
            다음 주 일정 ({dayLabel(schedule.periodStartMs)}({weekdayLabel(schedule.periodStartMs)}) ~ {dayLabel(schedule.periodEndMs - 1)}(
            {weekdayLabel(schedule.periodEndMs - 1)})) 미리 조율
          </h2>
          <p className="small muted" style={{ margin: 0 }}>
            {party.autoAssign
              ? "이번 주 레이드가 끝나 다음 주 일정을 미리 조율합니다. 불가 시간을 먼저 내 두면 목요일 00:00에 투표 없이 점수 1위 시간으로 확정합니다."
              : "이번 주 레이드가 끝나 다음 주 일정을 미리 조율합니다. 불가 시간 입력과 투표를 먼저 하고, 확정은 목요일 00:00부터 할 수 있습니다."}
          </p>
        </>
      ) : (
        <h2 style={{ marginTop: 0 }}>이번 주기 일정</h2>
      )}
      <ScheduleSection
        party={party}
        schedule={schedule}
        early={upcoming}
        loading={schedules === undefined}
        submittedCount={participantUids(party, schedule).filter((u) => unavailable[u]?.submitted).length}
        mySubmitted={unavailable[uid]?.submitted === true}
        votes={votes}
        isLeader={isLeader}
        uid={uid}
        now={now}
        busy={busy}
        onVote={(agreed, round) =>
          run(agreed.length === 0 ? "모두 안 됨으로 투표했습니다" : "투표했습니다", () => api.setVote(party.id, schedule!.id, uid, agreed, round))
        }
        onAsk={ask}
        onRespondToChange={(approve) =>
          run(approve ? "변경 요청을 승인했습니다. 다시 조율합니다" : "변경 요청을 거절했습니다", () =>
            api.respondToChange(party.id, schedule!.id, approve),
          )
        }
      />

      {isLeader && noCurrentSchedule && (
        <>
          <button className="btn full" disabled={busy} onClick={() => ask({ kind: "startNow" })}>
            이번 주기 지금 시작
          </button>
          <p className="small muted" style={{ margin: 0 }}>
            파티원을 다 모은 뒤에 눌러 주세요. 시작하면 남은 기간 안에서 바로 일정을 조율합니다.
          </p>
        </>
      )}
      {inputOpen && schedule && !replaced && (
        <button className="btn-outline full" disabled={busy} onClick={() => navigate(`/parties/${party.id}/unavailable/${schedule.id}`)}>
          {(upcoming ? "다음 주 " : "") + (unavailable[uid]?.submitted ? "불가 시간 수정" : "불가 시간 입력")}
        </button>
      )}
    </>
  );
}

function ScheduleSection({
  party,
  schedule,
  early,
  loading,
  submittedCount,
  mySubmitted,
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
  /** 미리 연 다음 주 일정 (확정은 목요일부터) */
  early: boolean;
  loading: boolean;
  submittedCount: number;
  mySubmitted: boolean;
  votes: Record<string, Vote>;
  isLeader: boolean;
  uid: string;
  now: number;
  busy: boolean;
  onVote: (agreed: number[], round: number) => void;
  onAsk: (confirm: Confirm) => void;
  onRespondToChange: (approve: boolean) => void;
}) {
  // 이번 주기 참여 파티원 (용병으로 대체한 사람 제외)
  const participants = participantUids(party, schedule);
  const memberCount = participants.length;
  const replaced = isReplaced(schedule, uid);
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
          <br />
          <span className="small muted" style={{ fontWeight: 400 }}>
            분배금은 정산 탭에서 정산합니다.
          </span>
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
            {schedule.state === "OPEN" && !early && ` · 마감 ${dateTime(schedule.inputDeadlineMs - 60_000)}`}
          </p>
          <p className="small" style={{ margin: 0 }}>
            {replaced
              ? "이번 주기는 용병으로 대체했습니다. 나머지 파티원이 조율합니다. 파티 탭에서 대체를 취소할 수 있습니다."
              : !mySubmitted
                ? "아직 제출하지 않았습니다. 안 되는 시간이 없어도 제출해 주세요."
                : party.autoAssign
                  ? "전원이 제출하면 투표 없이 점수가 가장 높은 시간으로 자동으로 정해집니다."
                  : "전원이 제출하면 추천 시간이 나옵니다."}
          </p>
        </>
      ) : isAutoAssigned(schedule) ? (
        <AutoPlan schedule={schedule} />
      ) : (
        <CandidateVoting
          // 후보가 바뀌거나(round) 저장된 투표가 바뀌면 선택을 처음부터 다시 한다.
          key={`${schedule.round}:${savedVote?.agreed.join(",") ?? "-"}`}
          schedule={schedule}
          early={early}
          memberCount={memberCount}
          // 참여 파티원의 투표만 센다.
          votes={Object.fromEntries(participants.filter((u) => votes[u]).map((u) => [u, votes[u]]))}
          canVote={!replaced}
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

/** 순위 후보 한 줄: "1위 · 11/21(토) 21:00 ~ 22:00" + 이유 */
function RankedCandidate({ rank, candidate, children }: { rank: number; candidate: Candidate; children?: ReactNode }) {
  const why = reasonText(candidate.reasons);
  return (
    <div className="row" style={{ alignItems: "flex-start" }}>
      <div className="grow stack" style={{ gap: 0 }}>
        <span style={{ fontWeight: rank === 1 ? 700 : 500 }}>
          {rank}위 · {range(candidate.startMs, candidate.endMs)}
        </span>
        {why && <span className="small muted">{why}</span>}
      </div>
      {children}
    </div>
  );
}

/**
 * 투표 없이 자동 지정: 미리 연 다음 주라 아직 확정하지 않고 예정만 보여 준다.
 * 주기가 시작하면(목요일 00:00) 1위가 다른 레이드와 겹치지 않는 한 1위로 확정된다.
 */
function AutoPlan({ schedule }: { schedule: Schedule }) {
  const upcoming = schedule.periodStartMs > Date.now();
  return (
    <div className="card stack" style={{ gap: 6 }}>
      <span className="small muted">
        {upcoming ? `자동 지정 예정 · ${dateTime(schedule.periodStartMs)}에 확정` : "자동 지정 중"}
      </span>
      {schedule.candidates.map((candidate, index) => (
        <RankedCandidate key={candidate.slotId} rank={index + 1} candidate={candidate} />
      ))}
      <span className="small" style={{ marginTop: 4 }}>
        투표 없이 점수가 가장 높은 시간으로 정합니다. 불가 시간을 고치면 다시 계산합니다.
      </span>
    </div>
  );
}

/** 자동으로 정한 일정을 파티장이 다른 순위로 바꾸는 목록 (변경 요청 마감 = 레이드 4시간 전까지) */
function SwitchCandidates({
  schedule,
  confirmed,
  now,
  busy,
  onAsk,
}: {
  schedule: Schedule;
  confirmed: Confirmed;
  now: number;
  busy: boolean;
  onAsk: (confirm: Confirm) => void;
}) {
  const others = schedule.candidates.map((candidate, index) => ({ candidate, index })).filter(({ candidate }) => candidate.startMs !== confirmed.startMs);
  if (others.length === 0) return null;
  return (
    <div className="stack" style={{ gap: 6 }}>
      <span className="small muted">다른 순위로 바꾸기 (레이드 4시간 전까지)</span>
      {others.map(({ candidate, index }) => {
        const tooSoon = now >= changeRequestDeadline(candidate.startMs);
        return (
          <RankedCandidate key={candidate.slotId} rank={index + 1} candidate={candidate}>
            <button
              className="btn-outline"
              disabled={busy || tooSoon}
              onClick={() => onAsk({ kind: "switchCandidate", index, label: range(candidate.startMs, candidate.endMs) })}
            >
              {tooSoon ? "4시간 안" : "이 시간으로"}
            </button>
          </RankedCandidate>
        );
      })}
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
  let body: ReactNode;
  const request = schedule.changeRequest;
  const replaced = isReplaced(schedule, uid);
  if (replaced) {
    body = (
      <p className="small" style={{ margin: 0 }}>
        이 레이드는 용병으로 대체했습니다. 결과 기록과 변경 요청은 참여하는 파티원이 합니다.
      </p>
    );
  } else if (now >= confirmed.startMs) {
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
          {requester ? memberLabelOf(requester) : "파티원"} 님이 일정 변경을 요청했습니다.{request.reason.trim() ? `\n사유: ${request.reason}` : ""}
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
    // 변경 요청은 레이드 시작 4시간 전까지
    const deadline = changeRequestDeadline(confirmed.startMs);
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
              변경 요청 마감: {dateTime(deadline)} (레이드 시작 4시간 전)
            </p>
          </>
        ) : (
          <p className="small muted" style={{ margin: 0 }}>
            변경 요청 기간(레이드 시작 4시간 전까지)이 지났습니다.
          </p>
        )}
      </>
    );
  }
  const auto = isAutoAssigned(schedule);
  const chosen = schedule.candidates.find((candidate) => candidate.startMs === confirmed.startMs);
  const why = chosen ? reasonText(chosen.reasons) : "";
  return (
    <div className="stack">
      <div className="card stack" style={{ gap: 2 }}>
        <span className="small muted">
          {!auto ? "확정된 시간" : schedule.confirmedBy === "AUTO" ? "투표 없이 자동으로 정한 시간" : "파티장이 순위에서 고른 시간"}
        </span>
        <span style={{ fontSize: 20, fontWeight: 600 }}>{range(confirmed.startMs, confirmed.endMs)}</span>
        {auto && why && <span className="small muted">{why}</span>}
        {schedule.mercenaries.length > 0 && (
          <span className="small muted">
            참여: 파티원 {confirmed.memberUids.length}명 + 용병 {schedule.mercenaries.length}명
          </span>
        )}
      </div>
      {auto && isLeader && schedule.state === "LOCKED" && now < changeRequestDeadline(confirmed.startMs) && (
        <SwitchCandidates schedule={schedule} confirmed={confirmed} now={now} busy={busy} onAsk={onAsk} />
      )}
      {body}
    </div>
  );
}

function CandidateVoting({
  schedule,
  early,
  memberCount,
  votes,
  canVote,
  savedVote,
  isLeader,
  busy,
  onVote,
  onAsk,
}: {
  schedule: Schedule;
  early: boolean;
  memberCount: number;
  votes: Record<string, Vote>;
  /** 용병으로 대체한 사람은 투표하지 않는다(파티장이면 확정은 한다) */
  canVote: boolean;
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
        <span className="small grow">
          {canVote
            ? "가능한 시간에 모두 동의해 주세요. 전원이 동의한 시간 중에서 파티장이 확정합니다."
            : "이번 주기는 용병으로 대체해 투표하지 않습니다. 나머지 파티원이 투표합니다."}
        </span>
        {/* 한 번에 전부 고르거나 비운다. 투표는 아래 버튼으로 보낸다(골라 놓고 몇 개만 뺄 수 있게). */}
        {canVote && (
          <button className="btn-text" disabled={busy} onClick={() => setSelected(allSelected ? new Set() : new Set(indices))}>
            {allSelected ? "모두 해제" : "모두 가능"}
          </button>
        )}
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
              {canVote && (
                <input type="checkbox" className="check" checked={selected.has(index)} disabled={busy} onChange={() => toggle(index)} />
              )}
              <span className="grow" style={{ paddingLeft: 4 }}>
                <span style={{ fontWeight: 600 }}>
                  {time(candidate.startMs)} ~ {time(candidate.endMs)}
                </span>
                <br />
                <span className={`small ${unanimous ? "primary-text" : "muted"}`}>
                  {unanimous ? "전원 동의" : `동의 ${currentVotes.filter((v) => v.agreed.includes(index)).length}/${memberCount}명`}
                </span>
                {candidate.reasons.length > 0 && reasonText(candidate.reasons) && (
                  <>
                    <br />
                    <span className="small muted">{reasonText(candidate.reasons)}</span>
                  </>
                )}
              </span>
              {unanimous && isLeader && !early && (
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
      {canVote && (
        <button className="btn-outline full" disabled={busy || unchanged} onClick={() => onVote([...selected], schedule.round)}>
          {!savedVote && selected.size === 0 ? "모두 안 됨으로 투표" : !savedVote ? "투표하기" : "투표 바꾸기"}
        </button>
      )}
      <p className="small" style={{ margin: 0 }}>
        {schedule.unanimous.length > 0 && early
          ? "전원이 동의한 시간이 있습니다. 목요일 00:00부터 파티장이 확정할 수 있습니다."
          : schedule.unanimous.length > 0 && isLeader
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

/** 미리 연 다음 주 일정 위에 보여 줄 이번 주 결과 한 줄 */
function thisWeekResult(schedule: Schedule): string {
  switch (schedule.state) {
    case "SETTLED":
      return `이번 주 클리어 완료${schedule.confirmed ? ` · ${range(schedule.confirmed.startMs, schedule.confirmed.endMs)}` : ""}. 분배금은 정산 탭에서 정산합니다.`;
    case "SKIPPED":
      return "이번 주는 진행하지 않았습니다.";
    case "EXPIRED":
      return "이번 주 일정이 종료됐습니다.";
    default:
      return "";
  }
}
