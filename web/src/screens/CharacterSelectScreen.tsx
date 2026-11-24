import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import * as api from "../data/api";
import type { CharacterSummary } from "../lib/model";
import { Loading, useToast } from "../ui/common";

/**
 * 보스에 참여할 캐릭터 고르기. 고른 캐릭터의 레벨·직업·이미지는 서버가 캐시해 둔다.
 * @param editing 내 캐릭터 메뉴에서 다시 고르러 들어온 경우 (취소할 수 있음)
 */
export function CharacterSelectScreen({ uid, initiallySelected, editing = false }: { uid: string; initiallySelected: string[]; editing?: boolean }) {
  const [list, setList] = useState<CharacterSummary[] | null>(null);
  const [selected, setSelected] = useState(new Set(initiallySelected));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const navigate = useNavigate();
  const toast = useToast();

  useEffect(() => {
    let cancelled = false;
    setError(null);
    // 두 번째부터는 NEXON에서 새로 받아 온다.
    api.listCharacters(reloadKey > 0).then(
      (characters) => !cancelled && setList(characters),
      (err) => !cancelled && setError(api.userMessage(err)),
    );
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  const toggle = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  };

  async function save() {
    const ids = (list ?? []).map((c) => c.id).filter((id) => selected.has(id));
    setBusy(true);
    setError(null);
    try {
      await Promise.all(ids.map((id) => api.getCharacterInfo(id)));
      await api.setSelectedCharacters(uid, ids);
      toast("캐릭터를 저장했습니다");
      if (editing) navigate("/characters", { replace: true });
    } catch (err) {
      setError(api.userMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const count = (list ?? []).filter((c) => selected.has(c.id)).length;
  return (
    <div className="page">
      <h1>보스에 참여할 캐릭터 선택</h1>
      <p className="muted">파티에 넣을 캐릭터를 모두 골라 주세요. 나중에 바꿀 수 있습니다.</p>
      {error && <p className="error">{error}</p>}
      {list === null && !error && <Loading />}
      {list?.length === 0 && <p>이 API Key의 계정에 캐릭터가 없습니다.</p>}
      <div className="stack">
        {list?.map((character) => (
          <label key={character.id} className="row card clickable">
            <input type="checkbox" className="check" checked={selected.has(character.id)} disabled={busy} onChange={() => toggle(character.id)} />
            <span className="grow">
              <strong>{character.name}</strong>
              <br />
              <span className="small muted">
                Lv.{character.level} · {character.job} · {character.world}
              </span>
            </span>
          </label>
        ))}
      </div>
      <button className="btn full" disabled={busy || count === 0} onClick={save}>
        {busy ? "저장 중…" : `선택 완료 (${count})`}
      </button>
      <div className="row">
        <button
          className="btn-text"
          disabled={busy}
          onClick={() => {
            setList(null);
            setReloadKey(reloadKey + 1);
          }}
        >
          목록 새로고침
        </button>
        {editing && (
          <button className="btn-text" disabled={busy} onClick={() => navigate(-1)}>
            취소
          </button>
        )}
      </div>
    </div>
  );
}
