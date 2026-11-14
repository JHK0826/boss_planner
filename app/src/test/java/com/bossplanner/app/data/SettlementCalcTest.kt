package com.bossplanner.app.data

import org.junit.Assert.assertEquals
import org.junit.Test

/** 서버(functions/test/unit/settlementCalc.test.ts)와 같은 입력에 같은 금액이 나와야 한다. */
class SettlementCalcTest {
    private fun amounts(sale: Long, fee: Int, participants: List<String>, weights: Map<String, Int> = emptyMap()) =
        SettlementCalc.amounts(sale, fee, "s", participants, weights)

    @Test
    fun `판매액 1억 수수료 3퍼센트 2명 균등`() {
        assertEquals(97_000_000L, SettlementCalc.netAmount(100_000_000, 3))
        assertEquals(mapOf("a" to 49_238_500L), amounts(100_000_000, 3, listOf("s", "a")))
    }

    @Test
    fun `수수료 5퍼센트`() {
        assertEquals(95_000_000L, SettlementCalc.netAmount(100_000_000, 5))
        assertEquals(mapOf("a" to 48_717_900L), amounts(100_000_000, 5, listOf("s", "a")))
    }

    @Test
    fun `3명 균등`() {
        assertEquals(mapOf("a" to 32_659_900L, "c" to 32_659_900L), amounts(100_000_000, 3, listOf("a", "s", "c")))
    }

    @Test
    fun `비율을 주면 그 비율대로 나뉜다`() {
        val result = amounts(300_000_000, 3, listOf("s", "a", "b"), mapOf("a" to 3))
        // 291,000,000 × 3 × 100 ÷ (97 + 400) = 175,653,923.5… / 58,551,307.8…
        assertEquals(175_653_900L, result["a"])
        assertEquals(58_551_300L, result["b"])
    }

    @Test
    fun `큰 금액에서도 넘치지 않는다`() {
        val everyone = listOf("s", "a", "b", "c", "d", "e")
        val result = amounts(999_999_999_999, 5, everyone, everyone.associateWith { 100 })
        assertEquals(159_663_865_500L, result["a"])
    }

    @Test
    fun `억 만 단위 읽기`() {
        assertEquals("1억", Money.korean(100_000_000))
        assertEquals("4923만 8500", Money.korean(49_238_500))
        assertEquals("12억 3456만 7890", Money.korean(1_234_567_890))
        assertEquals("49,238,500메소", Money.meso(49_238_500))
    }
}
