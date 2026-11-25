// 투표 탭: 이번 주기 일정 (불가 시간 입력, 추천·투표, 확정, 변경 요청, 결과 기록). Android PartyScreen.kt의 ScheduleTab과 같음.
// 이번 주 레이드가 끝나 다음 주 일정을 미리 열었으면, 이번 주 결과를 한 줄로 보여 주고 다음 주 입력·투표를 받는다(확정은 목요일부터).
import { type ReactNode, useState } from "react";
import { useNavigate } from "react-router-dom";
import * as api from "../../data/api";
import { acceptsInput, type Confirmed, type Party, type Schedule, type Vote } from "../../lib/model";
import { currentPeriodSchedule, isUpcoming } from "../../lib/partyStatus";
import { dateTime, dayLabel, dayWithWeekday, range, startOfDay, time, weekdayLabel } from "../../lib/time";
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
            이번 주 레이드가 끝나 다음 주 일정을 미리 조율합니다. 불가 시간 입력과 투표를 먼저 하고, 확정은 목요일 00:00부터 할 수 있습니다.
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
        submittedCount={party.memberUids.filter((u) => unavailable[u]?.submitted).length}
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
      {inputOpen && schedule && (
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
            {mySubmitted ? "전원이 제출하면 추천 시간이 나옵니다." : "아직 제출하지 않았습니다. 안 되는 시간이 없어도 제출해 주세요."}
          </p>
        </>
      ) : (
        <CandidateVoting
          // 후보가 바뀌거나(round) 저장된 투표가 바뀌면 선택을 처음부터 다시 한다.
          key={`${schedule.round}:${savedVote?.agreed.join(",") ?? "-"}`}
          schedule={schedule}
          early={early}
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
      <div className="card stack" style={{ gap: 2 }}>
        <span className="small muted">확정된 시간</span>
        <span style={{ fontSize: 20, fontWeight: 600 }}>{range(confirmed.startMs, confirmed.endMs)}</span>
      </div>
      {body}
    </div>
  );
}

function CandidateVoting({
  schedule,
  early,
  memberCount,
  votes,
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
      <button className="btn-outline full" disabled={busy || unchanged} onClick={() => onVote([...selected], schedule.round)}>
        {!savedVote && selected.size === 0 ? "모두 안 됨으로 투표" : !savedVote ? "투표하기" : "투표 바꾸기"}
      </button>
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
