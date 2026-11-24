import { useNavigate, useParams } from "react-router-dom";
import { useMain } from "../main-context";
import { bossLabel } from "../lib/model";

/** 파티 화면. 일정·투표·정산은 다음 단계에서 붙인다. */
export function PartyScreen() {
  const { partyId } = useParams();
  const { parties } = useMain();
  const navigate = useNavigate();
  const party = parties?.find((p) => p.id === partyId);
  return (
    <div className="page">
      <button className="btn-text" style={{ alignSelf: "flex-start" }} onClick={() => navigate("/parties")}>
        ← 파티 목록
      </button>
      <h1>{party?.name ?? "파티"}</h1>
      {party && <p className="muted">{bossLabel(party.bosses)}</p>}
      <p className="muted">웹앱의 파티 화면(일정·투표·정산)은 준비 중입니다.</p>
    </div>
  );
}
