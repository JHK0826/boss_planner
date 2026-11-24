/** "49,238,500메소" */
export const meso = (amount: number): string => `${amount.toLocaleString("en-US")}메소`;

/** "4923만 8500"처럼 억·만 단위로 읽기 쉽게 */
export function korean(amount: number): string {
  if (amount <= 0) return "0";
  const eok = Math.floor(amount / 100_000_000);
  const man = Math.floor((amount % 100_000_000) / 10_000);
  const rest = amount % 10_000;
  return [eok > 0 ? `${eok.toLocaleString("en-US")}억` : null, man > 0 ? `${man}만` : null, rest > 0 ? `${rest}` : null]
    .filter(Boolean)
    .join(" ");
}

/** "1시간 30분" */
export function durationLabel(minutes: number): string {
  if (minutes < 60) return `${minutes}분`;
  if (minutes % 60 === 0) return `${minutes / 60}시간`;
  return `${Math.floor(minutes / 60)}시간 ${minutes % 60}분`;
}
