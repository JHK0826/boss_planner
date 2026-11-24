// 파티 탭: 파티 정보, 초대 코드, 파티원 (Android PartyScreen.kt의 PartyInfoTab과 같음).
import { useMemo, useState } from "react";
import { periodColumns } from "../../lib/grid";
import { acceptsInput, bossLabel, type Party, type PartyMember, type Schedule, type Unavailable, type Vote } from "../../lib/model";
import { durationLabel } from "../../lib/money";
import { SLOT_MS, dayLabel } from "../../lib/time";
import { Dialog, useToast } from "../../ui/common";
import { SlotGrid } from "../../ui/SlotGrid";
import { memberLabelOf, useParty } from "./context";

export function InfoTab() {
  const { uid, party, schedule, unavailable, votes, memberImages, now } = useParty();
  // 시간표를 보고 있는 파티원
  const [viewing, setViewing] = useState<PartyMember | null>(null);
  const isWeekly = party.cycle === "WEEKLY";

  return (
    <>
      <p style={{ margin: 0 }}>
        {bossLabel(party.bosses)}
        <br />
        {isWeekly ? "주간" : "월간"} · {durationLabel(party.durationMinutes)}
      </p>

      <InviteCard party={party} />

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
            onViewTimetable={() => setViewing(member)}
          />
        );
      })}

      {viewing && (
        <MemberTimetableDialog
          member={viewing}
          // 끝난 주기의 일정은 "이번 주기"로 보지 않는다.
          schedule={schedule && schedule.periodEndMs > now ? schedule : null}
          entry={unavailable[viewing.uid]}
          now={now}
          onClose={() => setViewing(null)}
        />
      )}
    </>
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
export function memberStatus(schedule: Schedule | undefined, entry: Unavailable | undefined, vote: Vote | undefined): string | null {
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
  onViewTimetable,
}: {
  member: PartyMember;
  imageUrl: string | undefined;
  isLeader: boolean;
  isMe: boolean;
  status: string | null;
  onViewTimetable: () => void;
}) {
  return (
    <div className="row" data-member={member.uid}>
      {/* 이미지가 없어도 자리를 비워 두어 줄이 가지런하게 한다. */}
      {imageUrl ? <img className="avatar" src={imageUrl} alt="" loading="lazy" /> : <div className="avatar" />}
      <div className="grow">
        <div style={{ fontWeight: 600 }}>
          {memberLabelOf(member)}
          {isMe && " (나)"}
          {isLeader && " · 파티장"}
        </div>
        <div className="small muted">
          {member.characterName} · Lv.{member.level} {member.job}
        </div>
        {status && (
          <div className={`small ${status === "미입력" || status === "투표 전" ? "error" : "primary-text"}`} style={{ fontWeight: 600 }}>
            {status}
          </div>
        )}
      </div>
      <button className="btn-text" aria-label={`${memberLabelOf(member)} 시간표 보기`} onClick={onViewTimetable}>
        시간표 보기
      </button>
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
  const columns = useMemo(
    () => (schedule ? periodColumns(schedule.periodStartMs, schedule.periodEndMs) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [schedule?.periodStartMs, schedule?.periodEndMs],
  );
  const selected = useMemo(() => new Set(entry?.slots ?? []), [entry]);
  return (
    <Dialog
      title={`${memberLabelOf(member)}님의 불가 시간`}
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
