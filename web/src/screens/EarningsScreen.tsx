// 캐릭터 수익 보기: 이번 주 예상 수익, 이번 주에 번 돈(결정석 + 정산금), 월별 지표 (Android EarningsScreen.kt와 같음).
import { useEffect } from "react";
import { useNavigate, useParams } from "react-router-dom";
import * as api from "../data/api";
import { useMain } from "../main-context";
import { DIFFICULTY_SHORT, earnedThisWeek, expectedThisWeek, monthlyEarnings } from "../lib/earnings";
import { korean, meso } from "../lib/money";
import { dateTime } from "../lib/time";
import { useNow, useSubscription } from "../lib/useSubscription";
import { Loading } from "../ui/common";

/** "105억 8049만 9999 메소" 처럼 크게 보여 줄 금액 */
const big = (amount: number) => (amount > 0 ? `${korean(amount)} 메소` : "0 메소");

export function EarningsScreen() {
  const { characterId = "" } = useParams();
  const { uid, characters, scheduler, schedulerLoading, schedulerError, loadScheduler } = useMain();
  const navigate = useNavigate();
  const records = useSubscription(api.earnings(uid), [uid]);
  const now = useNow();
  useEffect(() => loadScheduler(), [loadScheduler]);

  const character = characters?.find((c) => c.id === characterId);
  const state = scheduler?.[characterId];
  const bosses = state?.bosses ?? [];
  const unpriced = bosses.filter((b) => b.price === null);

  return (
    <div className="page">
      <button className="btn-text" style={{ alignSelf: "flex-start" }} onClick={() => navigate("/characters")}>
        ← 내 캐릭터
      </button>
      <h1 style={{ margin: 0 }}>{character ? `${character.name} 수익` : "수익"}</h1>

      {schedulerError && <p className="small error" style={{ margin: 0 }}>{schedulerError}</p>}
      {state === undefined || records === undefined ? (
        schedulerLoading || records === undefined ? <Loading /> : <p className="muted">게임 스케줄러를 받지 못했습니다.</p>
      ) : (
        <>
          <section className="card stack" aria-label="이번 주 예상 수익">
            <span className="small muted">이번 주 예상 수익 (결정석)</span>
            <span className="amount-big">{big(expectedThisWeek(bosses))}</span>
            <span className="small muted">
              스케줄러에 등록한 주간 보스 {bosses.filter((b) => b.cycle === "WEEKLY").length}개
              {bosses.some((b) => b.cycle === "MONTHLY" && !b.cleared) && "와 이번 달에 아직 잡지 않은 월간 보스"}의 결정석 가격 ÷ 인원수
            </span>
            {unpriced.length > 0 && (
              <span className="small error">
                가격 미등록 (0으로 계산): {unpriced.map((b) => `${b.name}(${DIFFICULTY_SHORT[b.difficulty] ?? b.difficulty})`).join(", ")}
              </span>
            )}
          </section>

          <ThisWeek bosses={bosses} characterId={characterId} records={records} now={now} />

          <h2>월별</h2>
          {monthlyEarnings(records, characterId, now).map((month) => (
            <div key={month.monthId} className="row month-row" data-month={month.monthId}>
              <span style={{ width: 92, flex: "none", fontWeight: 600 }}>{month.label}</span>
              {month.recorded ? (
                <span className="grow stack" style={{ gap: 0 }}>
                  <strong>{meso(month.total)}</strong>
                  <span className="small muted">
                    결정석 {meso(month.crystal)} · 정산금 {meso(month.settlement)}
                  </span>
                </span>
              ) : (
                <span className="grow small muted">기록 없음</span>
              )}
            </div>
          ))}
          <p className="small muted" style={{ margin: 0 }}>
            주간 기록은 시작일(목요일)이 속한 달로 묶고, 검은 마법사 같은 월간 보스 결정석은 잡은 달에 더합니다. 지난 주 결정석은 매주 목요일
            05:00에 확정합니다{state.fetchedAtMs ? ` · 스케줄러 ${dateTime(state.fetchedAtMs)} 기준` : ""}.
          </p>
          <p className="small muted" style={{ margin: 0 }}>
            Data based on NEXON Open API
          </p>
        </>
      )}
    </div>
  );
}

function ThisWeek({
  bosses,
  characterId,
  records,
  now,
}: {
  bosses: Parameters<typeof earnedThisWeek>[0];
  characterId: string;
  records: Parameters<typeof earnedThisWeek>[1];
  now: number;
}) {
  const week = earnedThisWeek(bosses, records, characterId, now);
  return (
    <section className="card stack" aria-label="이번 주에 번 돈">
      <span className="small muted">이번 주에 번 돈</span>
      <span className="amount-big">{big(week.total)}</span>
      <div className="row">
        <span className="grow">결정석 ({bosses.filter((b) => b.cycle === "WEEKLY" && b.cleared).length}개 클리어)</span>
        <strong>{meso(week.crystal)}</strong>
      </div>
      <div className="row">
        <span className="grow">정산금</span>
        <strong>{meso(week.settlement)}</strong>
      </div>
      {week.settlements.map((s) => (
        <div key={s.key} className="row small muted" style={{ paddingLeft: 12 }}>
          <span className="grow">
            {s.partyName} · {dateTime(s.raidAtMs)}
          </span>
          <span>{meso(s.amount)}</span>
        </div>
      ))}
      <span className="small muted">정산금은 받은 사람은 수령 확인한 뒤(경매장 수수료를 뗀 금액), 판매자는 정산이 끝난 뒤에 들어갑니다.</span>
    </section>
  );
}
