import { DIFFICULTY_SHORT } from "../lib/earnings";
import type { SchedulerBoss } from "../lib/model";

/**
 * 게임 스케줄러에 등록한 보스 칩: 보스 이름, 클리어면 체크, 아래에 난이도 배지.
 * 앱에 그 보스로 들어간 파티가 있으면 배지에 인원수를 붙인다 (예: H/3).
 */
export function BossChips({ bosses }: { bosses: SchedulerBoss[] }) {
  return (
    <div className="boss-grid">
      {bosses.map((boss) => {
        const short = DIFFICULTY_SHORT[boss.difficulty] ?? boss.difficulty;
        const label = `${boss.name} ${short}${boss.partySize > 1 ? `/${boss.partySize}` : ""}${boss.cleared ? " 클리어" : ""}`;
        return (
          <div key={`${boss.name}-${boss.difficulty}-${boss.cycle}`} className={`boss-chip ${boss.cleared ? "cleared" : ""}`} aria-label={label} title={label}>
            <div className="boss-tile">
              {boss.cycle === "MONTHLY" && <span className="boss-cycle">월</span>}
              <span className="boss-name">{boss.name}</span>
              {boss.cleared && (
                <svg className="boss-check" viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M9 16.17 4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" />
                </svg>
              )}
            </div>
            <span className={`difficulty d-${boss.difficulty.toLowerCase()}`}>
              {short}
              {boss.partySize > 1 && `/${boss.partySize}`}
            </span>
          </div>
        );
      })}
    </div>
  );
}
