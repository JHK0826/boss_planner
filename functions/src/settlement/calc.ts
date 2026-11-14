/**
 * 분배금 계산 (순수 함수).
 *
 * 메이플스토리에서는 메소를 그냥 건넬 수 없어서 경매장을 거친다.
 *   1. 판매자가 드롭 아이템을 경매장에 팔고, 수수료를 뗀 실수령액을 받는다.
 *   2. 받을 파티원이 경매장에 아무 물건이나 "정산금" 가격으로 올리고, 판매자가 그것을 산다.
 *   3. 파티원은 정산금에서 수수료를 한 번 더 뗀 금액을 실제로 받는다.
 *
 * 그래서 정산금은 "수수료를 뗀 뒤 받는 금액이 비율대로 나뉘도록" 수수료를 얹어서 계산한다.
 *
 *   정산금_i = 실수령액 × w_i ÷ (w_판매자 × (1 − 수수료) + 나머지 파티원 비율의 합)
 *
 * 비율이 모두 같으면 실수령액 ÷ ((1 − 수수료) + 받는 인원)이다.
 * 정산금은 100메소 단위로 내리고, 판매자가 나머지를 갖는다.
 */

/** 경매장 수수료(%). 기본 5%, 수수료 감면 혜택이 있으면 3%. */
export const FEE_PERCENTS = [5, 3] as const;
export const MAX_SALE_AMOUNT = 1_000_000_000_000;
export const MAX_WEIGHT = 100;
const ROUND_UNIT = 100n;

export interface SettlementInput {
  /** 경매장 판매액 (수수료 떼기 전) */
  saleAmount: number;
  feePercent: number;
  sellerUid: string;
  /** 레이드에 참여한 전원 (판매자 포함) */
  participants: string[];
  /** 실수령 기준 분배 비율. 없는 사람은 1 */
  weights?: Record<string, number>;
}

export interface SettlementResult {
  /** 판매자가 경매장에서 실제로 받은 금액 */
  netAmount: number;
  /** 받을 파티원별 정산금 (파티원이 경매장에 올릴 가격) */
  amounts: Record<string, number>;
  /** 판매자에게 남는 금액 */
  sellerAmount: number;
  /** 사람마다 쓴 비율 */
  weights: Record<string, number>;
  /** 받는 사람 모두의 정산금이 같은가 */
  uniform: boolean;
}

export function computeSettlement(input: SettlementInput): SettlementResult {
  const fee = BigInt(input.feePercent);
  const net = (BigInt(input.saleAmount) * (100n - fee)) / 100n;
  const weights: Record<string, number> = {};
  for (const uid of input.participants) weights[uid] = input.weights?.[uid] ?? 1;

  const recipients = input.participants.filter((uid) => uid !== input.sellerUid);
  const othersWeight = recipients.reduce((sum, uid) => sum + BigInt(weights[uid]), 0n);
  // 분모에 100을 곱해 정수로만 계산한다: w_판매자 × (100 − 수수료) + 100 × Σ w
  const denominator = BigInt(weights[input.sellerUid] ?? 1) * (100n - fee) + 100n * othersWeight;

  const amounts: Record<string, number> = {};
  let paid = 0n;
  for (const uid of recipients) {
    const exact = (net * BigInt(weights[uid]) * 100n) / denominator;
    const rounded = (exact / ROUND_UNIT) * ROUND_UNIT;
    amounts[uid] = Number(rounded);
    paid += rounded;
  }
  const values = Object.values(amounts);
  return {
    netAmount: Number(net),
    amounts,
    sellerAmount: Number(net - paid),
    weights,
    uniform: values.every((value) => value === values[0]),
  };
}
