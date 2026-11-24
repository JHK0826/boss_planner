import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import * as api from "../data/api";
import { useMain } from "../main-context";
import { useToast } from "../ui/common";
import { CharacterPicker } from "../ui/party-forms";

export function JoinPartyScreen() {
  const { characters = [] } = useMain();
  const navigate = useNavigate();
  const toast = useToast();
  const [code, setCode] = useState("");
  const [characterId, setCharacterId] = useState<string | null>(characters[0]?.id ?? null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!characterId && characters[0]) setCharacterId(characters[0].id);
  }, [characters, characterId]);

  async function join() {
    if (!characterId) return;
    setBusy(true);
    setError(null);
    try {
      const partyId = await api.joinParty(code, characterId);
      toast("파티에 가입했습니다");
      navigate(`/parties/${partyId}`, { replace: true });
    } catch (err) {
      setError(api.userMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page">
      <h1>초대 코드로 가입</h1>
      <p className="muted">
        파티장에게 받은 6자리 코드를 입력해 주세요. 이미 일정이 시작된 파티는 주기 시작일(주간 보스는 목요일, 월간 보스는 1일)에만 가입할 수
        있습니다.
      </p>
      <div className="field">
        <label htmlFor="code">초대 코드</label>
        <input
          id="code"
          className="input"
          autoCapitalize="characters"
          autoComplete="off"
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6))}
        />
      </div>
      <CharacterPicker characters={characters} selectedId={characterId} onSelect={setCharacterId} disabled={busy} />
      {error && <p className="error">{error}</p>}
      <button className="btn full" disabled={code.length !== 6 || !characterId || busy} onClick={join}>
        {busy ? "가입하는 중…" : "가입하기"}
      </button>
      <button className="btn-text" disabled={busy} onClick={() => navigate(-1)}>
        취소
      </button>
    </div>
  );
}
