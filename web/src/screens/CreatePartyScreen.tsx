import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import * as api from "../data/api";
import { useMain } from "../main-context";
import { type BossCatalog, difficultyLabel } from "../lib/model";
import { durationLabel } from "../lib/money";
import { Chips, Loading, useToast } from "../ui/common";
import { CharacterPicker, type RecommendSettings, RecommendSettingsEditor } from "../ui/party-forms";

const DURATION_STEP = 10;

/**
 * 고정 파티 만들기 (Android CreatePartyScreen과 같은 규칙).
 * - 보스를 여러 개 묶을 수 있다. 주간 보스와 월간 보스는 섞을 수 없다.
 * - 같은 캐릭터가 이미 다른 파티에서 잡는 보스는 고를 수 없다 (서버에서도 검사).
 * - 소요 시간은 보스 하나에 20분으로 잡고, 10분 단위로 고칠 수 있다.
 */
export function CreatePartyScreen() {
  const { uid, characters = [], parties = [] } = useMain();
  const navigate = useNavigate();
  const toast = useToast();
  const [catalog, setCatalog] = useState<BossCatalog | null>(null);
  const [name, setName] = useState("");
  // 고른 보스 이름 → 난이도 (고른 순서 유지)
  const [selected, setSelected] = useState<[string, string][]>([]);
  const [customDuration, setCustomDuration] = useState<number | null>(null);
  const [characterId, setCharacterId] = useState<string | null>(characters[0]?.id ?? null);
  const [settings, setSettings] = useState<RecommendSettings>({ preferredWindow: null, minLeadMinutes: 180 });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    setError(null);
    api.getBossCatalog().then(setCatalog, (err) => setError(api.userMessage(err)));
  }, [reloadKey]);
  useEffect(() => {
    if (!characterId && characters[0]) setCharacterId(characters[0].id);
  }, [characters, characterId]);

  // 이 캐릭터가 이미 다른 파티에서 잡는 보스 → 그 파티 이름
  const takenBy = useMemo(() => {
    const map = new Map<string, string>();
    for (const party of parties) {
      if (party.members[uid]?.characterId !== characterId) continue;
      for (const boss of party.bosses) map.set(boss.name, party.name);
    }
    return map;
  }, [parties, characterId, uid]);
  // 캐릭터를 바꿔서 겹치게 된 보스는 선택에서 뺀다.
  useEffect(() => {
    if (selected.some(([n]) => takenBy.has(n))) setSelected(selected.filter(([n]) => !takenBy.has(n)));
  }, [takenBy, selected]);

  if (!catalog) {
    return (
      <div className="page centered">
        {error ? (
          <>
            <p className="error">{error}</p>
            <button className="btn" onClick={() => setReloadKey(reloadKey + 1)}>
              다시 시도
            </button>
          </>
        ) : (
          <Loading />
        )}
        <button className="btn-text" onClick={() => navigate(-1)}>
          취소
        </button>
      </div>
    );
  }

  const selectedNames = selected.map(([n]) => n);
  const selectedMonthly = catalog.bosses.find((b) => selectedNames.includes(b.name))?.monthly;
  const autoDuration = Math.min(Math.max(selected.length * catalog.minutesPerBoss, catalog.minutesPerBoss), catalog.maxDurationMinutes);
  const durationMinutes = customDuration ?? autoDuration;

  const toggleBoss = (bossName: string) => {
    const boss = catalog.bosses.find((b) => b.name === bossName)!;
    setSelected(
      selectedNames.includes(bossName) ? selected.filter(([n]) => n !== bossName) : [...selected, [bossName, boss.difficulties[boss.difficulties.length - 1]]],
    );
  };

  async function create() {
    if (!characterId) return;
    setBusy(true);
    setError(null);
    try {
      const partyId = await api.createParty({
        name: name.trim(),
        bosses: selected.map(([n, difficulty]) => ({ name: n, difficulty })),
        durationMinutes,
        characterId,
        preferredWindow: settings.preferredWindow,
        minLeadMinutes: settings.minLeadMinutes,
      });
      toast("파티를 만들었습니다. 초대 코드를 파티원에게 보내 주세요");
      navigate(`/parties/${partyId}`, { replace: true });
    } catch (err) {
      setError(api.userMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page">
      <h1>고정 파티 만들기</h1>
      <div className="field">
        <label htmlFor="party-name">파티 이름</label>
        <input id="party-name" className="input" value={name} maxLength={20} onChange={(e) => setName(e.target.value)} />
      </div>
      <CharacterPicker characters={characters} selectedId={characterId} onSelect={setCharacterId} disabled={busy} />

      <h3>보스 (여러 개를 묶을 수 있습니다)</h3>
      <Chips
        options={catalog.bosses.map((boss) => ({
          value: boss.name,
          label: boss.monthly ? `${boss.name} (월간)` : boss.name,
          // 주간과 월간은 섞을 수 없고, 이 캐릭터가 이미 잡는 보스는 고를 수 없다.
          disabled: !selectedNames.includes(boss.name) && (takenBy.has(boss.name) || (selectedMonthly !== undefined && selectedMonthly !== boss.monthly)),
        }))}
        selected={selectedNames}
        onSelect={toggleBoss}
        disabled={busy}
      />
      {takenBy.size > 0 && (
        <p className="small muted">
          이 캐릭터가 이미 다른 파티에서 잡는 보스는 고를 수 없습니다: {[...takenBy].map(([boss, party]) => `${boss}(${party})`).join(", ")}
        </p>
      )}

      {selected.length > 0 && (
        <>
          <h3>난이도</h3>
          {selected.map(([bossName, difficulty]) => (
            <div key={bossName} className="stack" style={{ gap: 4 }}>
              <span>{bossName}</span>
              <Chips
                options={catalog.bosses.find((b) => b.name === bossName)!.difficulties.map((code) => ({ value: code, label: difficultyLabel(code) }))}
                selected={difficulty}
                onSelect={(code) => setSelected(selected.map(([n, d]) => [n, n === bossName ? code : d]))}
                disabled={busy}
              />
            </div>
          ))}
          <p className="small muted">{selectedMonthly ? "월간 보스: 매월 1일에 주기가 시작됩니다." : "주간 보스: 매주 목요일에 주기가 시작됩니다."}</p>
        </>
      )}

      <h3>소요 시간 (추천 시간의 길이)</h3>
      <div className="row">
        <button
          className="btn-outline"
          disabled={busy || durationMinutes <= catalog.minutesPerBoss}
          onClick={() => setCustomDuration(Math.max(durationMinutes - DURATION_STEP, catalog.minutesPerBoss))}
        >
          −10분
        </button>
        <strong style={{ minWidth: 80, textAlign: "center" }}>{durationLabel(durationMinutes)}</strong>
        <button
          className="btn-outline"
          disabled={busy || durationMinutes >= catalog.maxDurationMinutes}
          onClick={() => setCustomDuration(Math.min(durationMinutes + DURATION_STEP, catalog.maxDurationMinutes))}
        >
          +10분
        </button>
        {customDuration !== null && customDuration !== autoDuration && (
          <button className="btn-text" disabled={busy} onClick={() => setCustomDuration(null)}>
            자동
          </button>
        )}
      </div>
      <p className="small muted">
        보스 하나에 {catalog.minutesPerBoss}분으로 계산합니다. 시간표는 30분 단위라 추천 시간은 정각이나 30분에 시작합니다.
      </p>

      <RecommendSettingsEditor settings={settings} onChange={setSettings} disabled={busy} />

      {error && <p className="error">{error}</p>}
      <button className="btn full" disabled={!name.trim() || !characterId || selected.length === 0 || busy} onClick={create}>
        {busy ? "만드는 중…" : "파티 만들기"}
      </button>
      <button className="btn-text" disabled={busy} onClick={() => navigate(-1)}>
        취소
      </button>
    </div>
  );
}
