import { useState } from "react";
import { useNavigate } from "react-router-dom";
import * as api from "../data/api";
import { useToast } from "../ui/common";

/**
 * NEXON Open API Key 입력. 키는 서버로 보낸 뒤 이 기기에는 남기지 않는다.
 * @param editing 설정에서 다시 등록하러 들어온 경우 (취소할 수 있음)
 */
export function ApiKeyScreen({ editing = false }: { editing?: boolean }) {
  const [apiKey, setApiKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();
  const toast = useToast();

  async function register() {
    setBusy(true);
    setError(null);
    try {
      await api.registerApiKey(apiKey);
      setApiKey("");
      toast("API Key를 등록했습니다");
      // 처음 등록이면 서버가 apiKeyRegistered를 켜서 다음 단계(캐릭터 선택)로 넘어간다.
      if (editing) navigate("/characters/select", { replace: true });
    } catch (err) {
      setError(api.userMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page">
      <h1>NEXON Open API Key 등록</h1>
      <p className="muted">
        openapi.nexon.com에서 메이플스토리 API Key를 발급받아 붙여넣어 주세요. 키는 서버에만 저장되고 이 기기에는 남지 않습니다.
      </p>
      <div className="field">
        <label htmlFor="apikey">API Key</label>
        <input
          id="apikey"
          className="input"
          type="password"
          autoComplete="off"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value.trim())}
        />
      </div>
      {error && <p className="error">{error}</p>}
      <button className="btn full" disabled={apiKey.length < 20 || busy} onClick={register}>
        {busy ? "확인 중…" : "등록하고 캐릭터 불러오기"}
      </button>
      {editing ? (
        <button className="btn-text" disabled={busy} onClick={() => navigate(-1)}>
          취소
        </button>
      ) : (
        <button className="btn-text" disabled={busy} onClick={() => api.signOut()}>
          로그아웃
        </button>
      )}
    </div>
  );
}
