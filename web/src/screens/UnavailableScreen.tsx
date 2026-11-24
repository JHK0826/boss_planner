// 불가 시간 입력 (Android ui/UnavailableScreen.kt와 같은 동작·문구).
import { FirebaseError } from "firebase/app";
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import * as api from "../data/api";
import { useMain } from "../main-context";
import { periodColumns, routineKey } from "../lib/grid";
import { acceptsInput, type Schedule } from "../lib/model";
import { SLOT_MS } from "../lib/time";
import { Loading, useToast } from "../ui/common";
import { BulkFillPanel, SlotGrid } from "../ui/SlotGrid";

/**
 * 불가 시간 입력. 한 칸씩 누르지 않아도 되도록 세 가지를 지원한다.
 *
 * - 범위로 한 번에 채우기 (요일 + 시간대)
 * - 고정 불가 시간: 저장해 둔 매주 반복 시간으로 미리 채운다
 * - 내 다른 파티에도 적용: 불가 시간은 사람 기준이라, 같은 주기의 다른 파티에도 함께 제출한다
 */
export function UnavailableScreen() {
  const { partyId = "", periodId = "" } = useParams();
  const { uid, parties } = useMain();
  const navigate = useNavigate();
  const toast = useToast();

  // 새로 고침해도 열 수 있도록 일정은 주소의 ID로 직접 읽는다.
  const [schedule, setSchedule] = useState<Schedule | null | undefined>(undefined);
  const [selected, setSelected] = useState<Set<string> | null>(null);
  const [routine, setRoutine] = useState<Set<string>>(new Set());
  const [prefilled, setPrefilled] = useState(false);
  const [applyToOthers, setApplyToOthers] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const now = useMemo(() => Date.now(), []);

  const columns = useMemo(() => (schedule ? periodColumns(schedule.periodStartMs, schedule.periodEndMs) : []), [schedule]);
  const otherParties = (parties ?? []).filter((p) => p.id !== partyId);

  /** 고정 불가 시간(요일-시각)을 이 주기의 날짜 칸으로 옮긴다. */
  const routineSlots = (r: Set<string>, cols = columns) =>
    new Set(cols.flatMap((column) => column.slotIds.filter((_, row) => r.has(routineKey(column.weekday, row)))));

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const loaded = await api.scheduleOnce(partyId, periodId).catch(() => null);
      if (cancelled) return;
      setSchedule(loaded);
      if (!loaded || !acceptsInput(loaded)) return;
      const r = await api.loadRoutine(uid).catch(() => new Set<string>());
      const saved = await api.myUnavailableOnce(partyId, periodId, uid).catch(() => null);
      if (cancelled) return;
      setRoutine(r);
      if (saved) {
        setSelected(new Set(saved.slots));
      } else {
        // 이번 주기에 아직 아무것도 저장하지 않았으면 고정 불가 시간으로 시작한다.
        setSelected(routineSlots(r, periodColumns(loaded.periodStartMs, loaded.periodEndMs)));
        setPrefilled(r.size > 0);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [partyId, periodId, uid]);

  const back = () => navigate(`/parties/${partyId}`, { replace: true });

  async function submit() {
    if (!selected || !schedule) return;
    const slots = [...selected];
    setBusy(true);
    setError(null);
    try {
      await api.setUnavailable(partyId, periodId, uid, slots, true);
      const others = applyToOthers ? await api.submitToOtherParties(otherParties, schedule, uid, slots) : 0;
      toast(others > 0 ? `불가 시간을 제출했습니다 (다른 파티 ${others}곳에도 제출)` : "불가 시간을 제출했습니다");
      back();
    } catch (e) {
      // 보안 규칙이 막았다면 이미 확정·종료된 일정이다.
      setError(
        e instanceof FirebaseError && !e.code.startsWith("functions/")
          ? "제출하지 못했습니다. 일정이 이미 확정되었거나 종료되었을 수 있습니다."
          : api.userMessage(e),
      );
    } finally {
      setBusy(false);
    }
  }

  if (schedule === undefined) return <Loading />;
  if (schedule === null || !acceptsInput(schedule)) {
    return (
      <div className="page">
        <h1>불가 시간 입력</h1>
        <p>지금은 이 일정의 불가 시간을 입력할 수 없습니다. 일정이 이미 확정되었거나 종료되었을 수 있습니다.</p>
        <button className="btn" onClick={back}>
          파티로 돌아가기
        </button>
      </div>
    );
  }

  const hasCandidates = schedule.candidates.length > 0;
  return (
    <div className="page">
      <h1>불가 시간 입력</h1>
      <p className="small" style={{ margin: 0 }}>
        {prefilled
          ? "고정 불가 시간으로 채워 두었습니다. 이번 주기에 달라진 부분만 고치고 제출해 주세요."
          : routine.size === 0
            ? "안 되는 시간을 표시하고 제출해 주세요. 매주 비슷하다면 '시간표' 메뉴의 고정 불가 시간에 저장해 두면 다음부터 미리 채워집니다."
            : "안 되는 시간을 표시하고 제출해 주세요. 안 되는 시간이 없어도 제출을 눌러야 입력으로 처리됩니다."}
      </p>
      {hasCandidates && (
        <p className="small error" style={{ margin: 0 }}>
          이미 추천 시간이 나와 있습니다. 내용을 바꿔 제출하면 추천과 투표가 처음부터 다시 진행됩니다.
        </p>
      )}

      {selected === null ? (
        <Loading />
      ) : (
        <>
          <BulkFillPanel columns={columns} selected={selected} onChange={setSelected} disabled={busy} />
          {routine.size > 0 && (
            <button className="btn-text" style={{ alignSelf: "flex-start" }} disabled={busy} onClick={() => setSelected(routineSlots(routine))}>
              고정 불가 시간으로 되돌리기
            </button>
          )}
          <SlotGrid
            columns={columns}
            selected={selected}
            onChange={setSelected}
            disabled={busy}
            pastBefore={Math.floor((now - schedule.periodStartMs) / SLOT_MS) + 1}
          />
        </>
      )}

      {otherParties.length > 0 && (
        <label className="row" style={{ cursor: "pointer" }}>
          <input type="checkbox" className="check" checked={applyToOthers} disabled={busy} onChange={() => setApplyToOthers(!applyToOthers)} />
          <span className="small">내 다른 파티에도 같은 시간으로 제출 (같은 주기에 입력을 받는 파티)</span>
        </label>
      )}

      {error && <p className="error">{error}</p>}

      <div className="row" style={{ position: "sticky", bottom: 0, background: "var(--surface)", padding: "8px 0 calc(8px + var(--safe-bottom))" }}>
        <button className="btn grow" disabled={!selected || busy} onClick={submit}>
          {busy ? "제출 중…" : `제출 (불가 ${selected?.size ?? 0}칸)`}
        </button>
        <button className="btn-text" disabled={busy} onClick={back}>
          취소
        </button>
      </div>
    </div>
  );
}
