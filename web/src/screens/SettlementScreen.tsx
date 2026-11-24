import { useNavigate, useParams } from "react-router-dom";

/** 분배금 정산 화면. 정산·채팅은 다음 단계에서 붙인다. */
export function SettlementScreen() {
  const { partyId = "" } = useParams();
  const navigate = useNavigate();
  return (
    <div className="page">
      <button className="btn-text" style={{ alignSelf: "flex-start" }} onClick={() => navigate(`/parties/${partyId}`)}>
        ← 파티
      </button>
      <h1>분배금 정산</h1>
      <p className="muted">웹앱의 정산 화면(분배금·채팅)은 준비 중입니다. 지금은 Android 앱에서 진행해 주세요.</p>
    </div>
  );
}
