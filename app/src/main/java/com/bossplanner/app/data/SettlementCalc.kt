package com.bossplanner.app.data

/**
 * 분배금 계산. 등록 전에 화면에 미리 보여 주는 용도이고, 실제 금액은 서버가 같은 식으로 다시 계산한다
 * (functions/src/settlement/calc.ts).
 *
 * 메소는 경매장을 거쳐 건넨다: 받을 파티원이 물건을 "정산금" 가격으로 올리고 판매자가 산다.
 * 파티원은 거기서 수수료를 한 번 더 떼고 받으므로, 뗀 뒤의 금액이 비율대로 나뉘도록 수수료를 얹는다.
 *
 *   정산금_i = 실수령액 × w_i ÷ (w_판매자 × (1 − 수수료) + 나머지 파티원 비율의 합)
 *
 * 100메소 단위로 내린다.
 */
object SettlementCalc {
    val FEE_PERCENTS = listOf(5, 3)
    const val MAX_SALE_AMOUNT = 1_000_000_000_000L
    const val MAX_WEIGHT = 100
    private const val ROUND_UNIT = 100L

    /** 판매자가 경매장에서 실제로 받는 금액 */
    fun netAmount(saleAmount: Long, feePercent: Int): Long = saleAmount * (100 - feePercent) / 100

    /** 받을 파티원별 정산금 (판매자 제외, participants 순서 유지) */
    fun amounts(
        saleAmount: Long,
        feePercent: Int,
        sellerUid: String,
        participants: List<String>,
        weights: Map<String, Int>,
    ): Map<String, Long> {
        val net = netAmount(saleAmount, feePercent)
        val recipients = participants.filter { it != sellerUid }
        val weightOf = { uid: String -> (weights[uid] ?: 1).toLong() }
        val denominator = weightOf(sellerUid) * (100 - feePercent) + 100 * recipients.sumOf(weightOf)
        return recipients.associateWith { uid ->
            val exact = net * weightOf(uid) * 100 / denominator
            exact / ROUND_UNIT * ROUND_UNIT
        }
    }
}

object Money {
    /** "49,238,500메소" */
    fun meso(amount: Long): String = "%,d메소".format(amount)

    /** "4923만 8500" 처럼 억·만 단위로 읽기 쉽게 */
    fun korean(amount: Long): String {
        if (amount <= 0) return "0"
        val eok = amount / 100_000_000
        val man = amount % 100_000_000 / 10_000
        val rest = amount % 10_000
        return listOfNotNull(
            if (eok > 0) "${"%,d".format(eok)}억" else null,
            if (man > 0) "${man}만" else null,
            if (rest > 0) "$rest" else null,
        ).joinToString(" ")
    }
}
