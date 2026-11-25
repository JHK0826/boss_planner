import { type Ref, useEffect, useRef, useState } from "react";
import { bossImage } from "../lib/bossImages";
import type { RaidTimeline as Timeline, TimelineBar } from "../lib/timeline";
import { dayLabel, range, weekdayLabel } from "../lib/time";

const IMAGE_PX = 24;
const IMAGE_GAP_PX = 2;
/** 이미지 옆에 이만큼 남아야 파티 이름을 적는다 */
const NAME_MIN_PX = 56;

export const partyColor = (colorIndex: number) => `var(--party-${colorIndex + 1})`;

/** 요일이 줄, 가로축이 시각인 확정 일정 타임라인. 막대를 누르면 그 파티로 간다. */
export function RaidTimeline({ timeline, onOpenParty }: { timeline: Timeline; onOpenParty: (partyId: string) => void }) {
  const rowRef = useRef<HTMLDivElement>(null);
  const [rowWidth, setRowWidth] = useState(0);
  useEffect(() => {
    const row = rowRef.current;
    if (!row) return;
    const observer = new ResizeObserver(() => setRowWidth(row.clientWidth));
    observer.observe(row);
    setRowWidth(row.clientWidth);
    return () => observer.disconnect();
  }, []);

  return (
    <div className="timeline">
      <div />
      <div className="timeline-ticks" aria-hidden="true">
        {timeline.ticks.map((tick) => (
          <span key={tick.left} style={{ left: `${tick.left * 100}%` }}>
            {tick.label}
          </span>
        ))}
      </div>
      {timeline.dayStarts.map((dayStart, row) => (
        <TimelineRowView key={dayStart} row={row} dayStart={dayStart} timeline={timeline} rowWidth={rowWidth} rowRef={row === 0 ? rowRef : undefined} onOpenParty={onOpenParty} />
      ))}
    </div>
  );
}

function TimelineRowView({
  row,
  dayStart,
  timeline,
  rowWidth,
  rowRef,
  onOpenParty,
}: {
  row: number;
  dayStart: number;
  timeline: Timeline;
  rowWidth: number;
  rowRef?: Ref<HTMLDivElement>;
  onOpenParty: (partyId: string) => void;
}) {
  const today = timeline.now?.row === row;
  return (
    <>
      <div className={`timeline-day ${today ? "today" : ""}`}>
        <b>{weekdayLabel(dayStart)}</b>
        <br />
        {dayLabel(dayStart)}
      </div>
      <div className="timeline-row" ref={rowRef}>
        {timeline.routine
          .filter((span) => span.row === row)
          .map((span) => (
            <div key={span.left} className="timeline-routine" style={{ left: `${span.left * 100}%`, width: `${span.width * 100}%` }} />
          ))}
        {timeline.gridLines.map((left) => (
          <div key={left} className="timeline-line" style={{ left: `${left * 100}%` }} />
        ))}
        {timeline.breaks.map((gap) => (
          <div key={gap.left} className="timeline-break" style={{ left: `${gap.left * 100}%`, width: `${gap.width * 100}%` }} />
        ))}
        {timeline.bars
          .filter((bar) => bar.row === row)
          .map((bar) => (
            <Bar key={`${bar.raid.partyId}-${bar.raid.startMs}`} bar={bar} widthPx={bar.width * rowWidth - 2} onOpenParty={onOpenParty} />
          ))}
        {today && timeline.now && <div className="timeline-now" style={{ left: `${timeline.now.left * 100}%` }} />}
      </div>
    </>
  );
}

/** 보스 이미지는 들어가는 만큼(최소 1개), 파티 이름은 남는 폭이 넉넉할 때만 */
function Bar({ bar, widthPx, onOpenParty }: { bar: TimelineBar; widthPx: number; onOpenParty: (partyId: string) => void }) {
  const { raid } = bar;
  const fit = Math.max(1, Math.min(raid.bosses.length, Math.floor((widthPx - 4) / (IMAGE_PX + IMAGE_GAP_PX))));
  const shown = raid.bosses.slice(0, fit);
  const showName = widthPx - fit * (IMAGE_PX + IMAGE_GAP_PX) >= NAME_MIN_PX;
  const label = `${raid.partyName} ${range(raid.startMs, raid.endMs)}`;
  return (
    <button
      className={`timeline-bar ${bar.past ? "past" : ""}`}
      style={{ left: `calc(${bar.left * 100}% + 1px)`, width: `calc(${bar.width * 100}% - 2px)`, background: partyColor(bar.colorIndex) }}
      aria-label={label}
      title={label}
      onClick={() => onOpenParty(raid.partyId)}
    >
      {shown.map((boss) => {
        const image = bossImage(boss.name);
        return image ? (
          <img key={`${boss.name}-${boss.difficulty}`} src={image} alt="" decoding="async" />
        ) : (
          <span key={`${boss.name}-${boss.difficulty}`} className="timeline-boss-letter">
            {boss.name.slice(0, 1)}
          </span>
        );
      })}
      {showName && <span className="timeline-name">{raid.partyName}</span>}
    </button>
  );
}
