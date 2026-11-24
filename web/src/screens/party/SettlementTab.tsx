// 정산 탭: 클리어한 일정의 분배금 정산과 채팅. 정산할 주기가 여러 개면(이번 주기 + 끝나지 않은 지난 주기) 위에서 고른다.
import { useNavigate, useParams } from "react-router-dom";
import { type Schedule, settlementOpen } from "../../lib/model";
import { dateTime } from "../../lib/time";
import { Loading } from "../../ui/common";
import { SettlementContent } from "../SettlementScreen";
import { useParty } from "./context";

/** 정산 탭에서 고를 수 있는 주기: 클리어한 이번 주기(정산이 끝났어도) + 정산이 끝나지 않은 지난 주기 */
export function settlementPeriods(schedules: Schedule[]): Schedule[] {
  return schedules.filter((s, i) => (i === 0 ? s.state === "SETTLED" : settlementOpen(s)));
}

const periodLabel = (schedule: Schedule) => (schedule.confirmed ? `${dateTime(schedule.confirmed.startMs)} 레이드` : schedule.id);

export function SettlementTab() {
  const { uid, party, schedules } = useParty();
  const { periodId } = useParams();
  const navigate = useNavigate();
  if (schedules === undefined) return <Loading />;

  const periods = settlementPeriods(schedules);
  // 주소로 지난 정산을 직접 연 경우에도 보여 준다.
  const selected = periodId ?? periods[0]?.id;
  if (!selected) {
    return <p style={{ margin: 0 }}>클리어한 일정이 생기면 여기서 분배금을 정산합니다.</p>;
  }
  return (
    <>
      {periods.length > 1 && (
        <div className="row wrap" role="tablist" aria-label="정산할 주기">
          {periods.map((p) => (
            <button
              key={p.id}
              type="button"
              className="chip"
              aria-pressed={p.id === selected}
              onClick={() => navigate(`/parties/${party.id}/settlement/${p.id}`, { replace: true })}
            >
              {periodLabel(p)}
            </button>
          ))}
        </div>
      )}
      <SettlementContent key={selected} uid={uid} party={party} periodId={selected} />
    </>
  );
}
