import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import * as api from "../data/api";
import { useMain } from "../main-context";
import { weekdayColumns } from "../lib/grid";
import { Loading, useToast } from "../ui/common";
import { BulkFillPanel, SlotGrid } from "../ui/SlotGrid";

/** 고정 불가 시간: 매주 반복되는 안 되는 시간을 저장해 두면 새 주기의 불가 시간표가 이 값으로 미리 채워진다. */
export function RoutineScreen() {
  const { uid } = useMain();
  const navigate = useNavigate();
  const toast = useToast();
  const columns = useMemo(weekdayColumns, []);
  const [selected, setSelected] = useState<Set<string> | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.loadRoutine(uid).then(setSelected, () => setSelected(new Set()));
  }, [uid]);

  async function save() {
    if (!selected) return;
    setBusy(true);
    setError(null);
    try {
      await api.saveRoutine(uid, selected);
      toast("고정 불가 시간을 저장했습니다");
      navigate(-1);
    } catch {
      setError("저장하지 못했습니다. 네트워크 상태를 확인하고 다시 시도해 주세요.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page">
      <h1>고정 불가 시간</h1>
      <p className="small muted">
        출근이나 수면처럼 매주 반복되는 안 되는 시간을 저장해 두세요. 새 주기마다 불가 시간표가 이 값으로 미리 채워져서, 달라진 부분만 고치고
        제출하면 됩니다.
      </p>
      {selected === null ? (
        <Loading />
      ) : (
        <>
          <BulkFillPanel columns={columns} selected={selected} onChange={setSelected} disabled={busy} />
          <SlotGrid columns={columns} selected={selected} onChange={setSelected} disabled={busy} />
        </>
      )}
      {error && <p className="error">{error}</p>}
      <div className="row" style={{ position: "sticky", bottom: 0, background: "var(--surface)", padding: "8px 0 calc(8px + var(--safe-bottom))" }}>
        <button className="btn grow" disabled={!selected || busy} onClick={save}>
          {busy ? "저장 중…" : `저장 (불가 ${selected?.size ?? 0}칸)`}
        </button>
        <button className="btn-text" disabled={busy} onClick={() => navigate(-1)}>
          취소
        </button>
      </div>
    </div>
  );
}
