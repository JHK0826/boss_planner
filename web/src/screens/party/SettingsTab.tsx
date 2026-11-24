// 파티 설정 탭: 추천 설정(선호 시간대·최소 여유 시간), 파티장 위임, 파티 탈퇴. Android PartyScreen.kt의 PartySettingsTab과 같음.
import { useEffect, useState } from "react";
import * as api from "../../data/api";
import { acceptsInput } from "../../lib/model";
import { type RecommendSettings, RecommendSettingsEditor, recommendSettingsSummary } from "../../ui/party-forms";
import { memberLabelOf, useParty } from "./context";

export function SettingsTab() {
  const { uid, party, schedule, busy, run, ask } = useParty();
  const isLeader = party.leaderUid === uid;
  const saved: RecommendSettings = { preferredWindow: party.preferredWindow, minLeadMinutes: party.minLeadMinutes };
  const savedKey = JSON.stringify(saved);
  const [draft, setDraft] = useState<RecommendSettings>(saved);
  // 다른 기기에서 바뀌거나 저장되면 편집 중인 값도 맞춘다.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => setDraft(saved), [savedKey]);
  const changed = JSON.stringify(draft) !== savedKey;
  const others = party.memberUids.filter((u) => u !== uid && party.members[u]);
  const [delegateTo, setDelegateTo] = useState<string>("");

  return (
    <>
      <h2 style={{ marginTop: 0 }}>추천 설정</h2>
      {isLeader ? (
        <>
          <RecommendSettingsEditor settings={draft} onChange={setDraft} disabled={busy} />
          {schedule && acceptsInput(schedule) && schedule.candidates.length > 0 && (
            <p className="small error" style={{ margin: 0 }}>
              지금 투표 중입니다. 설정을 바꾸면 추천 시간을 다시 계산하고 투표도 다시 합니다.
            </p>
          )}
          <button
            className="btn full"
            disabled={busy || !changed}
            onClick={() => run("추천 설정을 저장했습니다", () => api.updatePartyPreferences(party.id, draft.preferredWindow, draft.minLeadMinutes))}
          >
            저장
          </button>
        </>
      ) : (
        <>
          <p style={{ margin: 0 }}>{recommendSettingsSummary(party.preferredWindow, party.minLeadMinutes)}</p>
          <p className="small muted" style={{ margin: 0 }}>
            추천 설정은 파티장만 바꿀 수 있습니다.
          </p>
        </>
      )}

      {isLeader && (
        <>
          <h2>파티장 위임</h2>
          {others.length === 0 ? (
            <p className="small muted" style={{ margin: 0 }}>
              파티장을 넘길 파티원이 없습니다.
            </p>
          ) : (
            <div className="row">
              <select
                className="input grow"
                aria-label="파티장을 넘길 파티원"
                value={delegateTo}
                disabled={busy}
                onChange={(e) => setDelegateTo(e.target.value)}
              >
                <option value="">파티원 선택</option>
                {others.map((u) => (
                  <option key={u} value={u}>
                    {memberLabelOf(party.members[u])} ({party.members[u].characterName})
                  </option>
                ))}
              </select>
              <button
                className="btn-outline"
                disabled={busy || !delegateTo}
                onClick={() => ask({ kind: "delegate", member: party.members[delegateTo] })}
              >
                위임
              </button>
            </div>
          )}
        </>
      )}

      <h2>파티 탈퇴</h2>
      <p className="small muted" style={{ margin: 0 }}>
        {party.scheduleStarted
          ? `일정을 시작한 뒤에는 가입·탈퇴·위임을 ${party.cycle === "WEEKLY" ? "목요일" : "매월 1일"}에, 일정이 확정되기 전에만 할 수 있습니다.`
          : "첫 일정을 시작하기 전까지는 언제든 탈퇴할 수 있습니다."}
      </p>
      <button className="btn-outline full" style={{ color: "var(--error)" }} disabled={busy} onClick={() => ask({ kind: "leave" })}>
        파티 탈퇴
      </button>
    </>
  );
}
