import { DAY_CHOICES } from "../lib/grid";
import type { CharacterInfo, PreferredWindow } from "../lib/model";
import { rowLabel } from "../lib/time";
import { Chips } from "./common";

/** 파티에 넣을 캐릭터 한 명 고르기 (골라 둔 캐릭터 중에서) */
export function CharacterPicker({
  characters,
  selectedId,
  onSelect,
  disabled,
}: {
  characters: CharacterInfo[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  disabled?: boolean;
}) {
  return (
    <div className="stack">
      <h3>참여할 캐릭터</h3>
      {characters.length === 0 && <p className="small muted">선택한 캐릭터가 없습니다. '내 캐릭터' 메뉴에서 캐릭터를 먼저 선택해 주세요.</p>}
      {characters.map((c) => (
        <label key={c.id} className="row">
          <input type="radio" className="check" name="character" checked={c.id === selectedId} disabled={disabled} onChange={() => onSelect(c.id)} />
          <span>
            {c.name} · Lv.{c.level} {c.job}
          </span>
        </label>
      ))}
    </div>
  );
}

export interface RecommendSettings {
  preferredWindow: PreferredWindow | null;
  minLeadMinutes: number;
}

/** 선호 시간대를 처음 켰을 때의 값: 매일 21:00 ~ 24:00 */
const DEFAULT_WINDOW: PreferredWindow = { days: [1, 2, 3, 4, 5, 6, 7], startRow: 42, endRow: 48 };
export const LEAD_CHOICES: [number, string][] = [
  [0, "없음"],
  [60, "1시간"],
  [180, "3시간"],
  [360, "6시간"],
  [720, "12시간"],
  [1440, "24시간"],
];

const dayChoiceLabel = (days: number[]) =>
  DAY_CHOICES.find(([, d]) => d.join() === [...days].sort().join())?.[0] ?? [...days].sort().map((d) => "월화수목금토일"[d - 1]).join("·");

/** "매일 21:00~24:00 선호 · 여유 3시간" */
export function recommendSettingsSummary(window: PreferredWindow | null, minLeadMinutes: number): string {
  const preferred = window ? `${dayChoiceLabel(window.days)} ${rowLabel(window.startRow)}~${rowLabel(window.endRow)} 선호` : "선호 시간대 없음";
  const lead = LEAD_CHOICES.find(([m]) => m === minLeadMinutes)?.[1] ?? `${minLeadMinutes}분`;
  return `${preferred} · 여유 ${lead}`;
}

/**
 * 추천 설정 편집. 파티를 만들 때와 파티장이 나중에 바꿀 때 같이 쓴다.
 * - 선호 시간대: 이 안에 들어가는 시각을 먼저 추천한다.
 * - 최소 여유 시간: 지금으로부터 이 시간 안에 시작하는 시각은 추천하지 않는다.
 */
export function RecommendSettingsEditor({
  settings,
  onChange,
  disabled,
}: {
  settings: RecommendSettings;
  onChange: (settings: RecommendSettings) => void;
  disabled?: boolean;
}) {
  const window = settings.preferredWindow;
  const setWindow = (w: PreferredWindow | null) => onChange({ ...settings, preferredWindow: w });
  return (
    <div className="stack">
      <label className="row">
        <h3 className="grow">선호 시간대</h3>
        <input
          type="checkbox"
          className="switch"
          checked={window !== null}
          disabled={disabled}
          onChange={() => setWindow(window ? null : DEFAULT_WINDOW)}
        />
      </label>
      {window && (
        <>
          <div className="row">
            <select
              className="input"
              style={{ width: "auto" }}
              disabled={disabled}
              value={DAY_CHOICES.findIndex(([, d]) => d.join() === [...window.days].sort().join())}
              onChange={(e) => setWindow({ ...window, days: DAY_CHOICES[Number(e.target.value)][1] })}
            >
              {DAY_CHOICES.findIndex(([, d]) => d.join() === [...window.days].sort().join()) === -1 && (
                <option value={-1}>{dayChoiceLabel(window.days)}</option>
              )}
              {DAY_CHOICES.map(([label], i) => (
                <option key={label} value={i}>
                  {label}
                </option>
              ))}
            </select>
            <select
              className="input"
              style={{ width: "auto" }}
              disabled={disabled}
              value={window.startRow}
              onChange={(e) => {
                const start = Number(e.target.value);
                setWindow({ ...window, startRow: start, endRow: Math.max(window.endRow, start + 1) });
              }}
            >
              {Array.from({ length: 48 }, (_, row) => (
                <option key={row} value={row}>
                  {rowLabel(row)}
                </option>
              ))}
            </select>
            <span>~</span>
            <select
              className="input"
              style={{ width: "auto" }}
              disabled={disabled}
              value={window.endRow}
              onChange={(e) => setWindow({ ...window, endRow: Number(e.target.value) })}
            >
              {Array.from({ length: 48 - window.startRow }, (_, i) => window.startRow + 1 + i).map((row) => (
                <option key={row} value={row}>
                  {rowLabel(row)}
                </option>
              ))}
            </select>
          </div>
          <p className="small muted">이 시간대에 들어가는 시각을 먼저 추천합니다. 그 밖의 시각도 가능하면 함께 추천됩니다.</p>
        </>
      )}
      <h3>최소 여유 시간</h3>
      <Chips
        options={LEAD_CHOICES.map(([value, label]) => ({ value, label }))}
        selected={settings.minLeadMinutes}
        onSelect={(minutes) => onChange({ ...settings, minLeadMinutes: minutes })}
        disabled={disabled}
      />
      <p className="small muted">추천을 계산하는 시점으로부터 이 시간 안에 시작하는 시각은 추천하지 않습니다.</p>
    </div>
  );
}
