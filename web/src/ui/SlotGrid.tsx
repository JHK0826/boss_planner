import { useState } from "react";
import { DAY_CHOICES, type GridColumn } from "../lib/grid";
import { SLOTS_PER_DAY, rowLabel } from "../lib/time";

/**
 * 30분 단위 시간표 (Android ui/SlotGrid.kt와 같은 조작).
 * 칸을 누르면 그 칸이, 위쪽 날짜를 누르면 하루 전체가, 왼쪽 시각을 누르면 그 시각의 모든 날이 바뀐다.
 *
 * @param pastBefore 이 번호(열 × 48 + 행)보다 앞선 칸은 이미 지난 시간이라 고칠 수 없다.
 */
export function SlotGrid({
  columns,
  selected,
  onChange,
  disabled = false,
  pastBefore = 0,
}: {
  columns: GridColumn[];
  selected: Set<string>;
  onChange?: (next: Set<string>) => void;
  disabled?: boolean;
  pastBefore?: number;
}) {
  const editable = !!onChange && !disabled;
  const toggleAll = (ids: string[]) => {
    if (!onChange) return;
    const next = new Set(selected);
    const allOn = ids.every((id) => next.has(id));
    ids.forEach((id) => (allOn ? next.delete(id) : next.add(id)));
    onChange(next);
  };
  // 열이 많으면(월간) 가로로 넘긴다.
  const minCell = columns.length > 7 ? "36px" : "1fr";
  return (
    <div className="grid-wrap">
      <div className="grid" style={{ gridTemplateColumns: `44px repeat(${columns.length}, minmax(${minCell === "1fr" ? "0" : minCell}, 1fr))` }}>
        <div className="head" />
        {columns.map((column) => (
          <button
            key={column.slotIds[0]}
            type="button"
            className="head btn-text"
            style={{ padding: "4px 0", minHeight: 0, color: "inherit", fontSize: 12, borderRadius: 4, display: "block" }}
            disabled={!editable}
            onClick={() => toggleAll(column.slotIds)}
          >
            {column.title}
            {column.subtitle && (
              <>
                <br />
                <span className="muted">{column.subtitle}</span>
              </>
            )}
          </button>
        ))}
        {Array.from({ length: SLOTS_PER_DAY }, (_, row) => [
          <button
            key={`t${row}`}
            type="button"
            className="time"
            style={{ background: "none", border: "none", padding: "0 4px 0 0", cursor: editable ? "pointer" : "default", fontSize: 11 }}
            disabled={!editable}
            onClick={() => toggleAll(columns.map((c) => c.slotIds[row]))}
          >
            {row % 2 === 0 ? rowLabel(row) : ""}
          </button>,
          ...columns.map((column, day) => {
            const id = column.slotIds[row];
            const past = day * SLOTS_PER_DAY + row < pastBefore;
            return (
              <button
                key={id}
                type="button"
                aria-label={`${column.title} ${rowLabel(row)}`}
                aria-pressed={selected.has(id)}
                className={`cell ${selected.has(id) ? "on" : ""} ${past ? "past" : ""}`}
                style={{ border: "none", padding: 0, height: 28, cursor: editable && !past ? "pointer" : "default" }}
                // 지난 시간은 추천 대상이 아니라서 고칠 필요가 없다.
                disabled={!editable || past}
                onClick={() => toggleAll([id])}
              />
            );
          }),
        ])}
      </div>
    </div>
  );
}

/**
 * 범위로 한 번에 채우기. 요일과 시간대를 골라 그 범위를 통째로 불가(또는 가능)로 만든다.
 * 되는 시간이 더 적다면 "전체 불가"를 누른 뒤 되는 시간대만 "가능으로 비우기"가 빠르다.
 */
export function BulkFillPanel({
  columns,
  selected,
  onChange,
  disabled,
}: {
  columns: GridColumn[];
  selected: Set<string>;
  onChange: (next: Set<string>) => void;
  disabled?: boolean;
}) {
  const [dayChoice, setDayChoice] = useState(1);
  const [fromRow, setFromRow] = useState(0);
  const [toRow, setToRow] = useState(36);
  const days = DAY_CHOICES[dayChoice][1];
  const rangeIds = columns.filter((c) => days.includes(c.weekday)).flatMap((c) => c.slotIds.slice(fromRow, toRow));

  return (
    <div className="stack" style={{ gap: 6 }}>
      <div className="row">
        <h3 className="grow">한 번에 채우기</h3>
        <button className="btn-text" disabled={disabled} onClick={() => onChange(new Set(columns.flatMap((c) => c.slotIds)))}>
          전체 불가
        </button>
        <button className="btn-text" disabled={disabled} onClick={() => onChange(new Set())}>
          전체 가능
        </button>
      </div>
      <div className="row">
        <select className="input" style={{ width: "auto" }} disabled={disabled} value={dayChoice} onChange={(e) => setDayChoice(Number(e.target.value))}>
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
          value={fromRow}
          onChange={(e) => {
            const from = Number(e.target.value);
            setFromRow(from);
            if (toRow <= from) setToRow(from + 1);
          }}
        >
          {Array.from({ length: 48 }, (_, row) => (
            <option key={row} value={row}>
              {rowLabel(row)}
            </option>
          ))}
        </select>
        <span>~</span>
        <select className="input" style={{ width: "auto" }} disabled={disabled} value={toRow} onChange={(e) => setToRow(Number(e.target.value))}>
          {Array.from({ length: 48 - fromRow }, (_, i) => fromRow + 1 + i).map((row) => (
            <option key={row} value={row}>
              {rowLabel(row)}
            </option>
          ))}
        </select>
      </div>
      <div className="row">
        <button className="btn-outline grow" disabled={disabled || rangeIds.length === 0} onClick={() => onChange(new Set([...selected, ...rangeIds]))}>
          불가로 채우기
        </button>
        <button
          className="btn-outline grow"
          disabled={disabled || rangeIds.length === 0}
          onClick={() => {
            const next = new Set(selected);
            rangeIds.forEach((id) => next.delete(id));
            onChange(next);
          }}
        >
          가능으로 비우기
        </button>
      </div>
    </div>
  );
}
