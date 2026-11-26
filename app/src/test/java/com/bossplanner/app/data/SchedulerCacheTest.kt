package com.bossplanner.app.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.ZonedDateTime

/** 웹 test/schedulerCache.test.ts와 같은 경우 (저장·읽기는 org.json이라 기기에서만 동작해, 판단 규칙만 본다) */
class SchedulerCacheTest {
    private fun kst(iso: String) = ZonedDateTime.parse("$iso+09:00[Asia/Seoul]").toInstant().toEpochMilli()
    private val sat = kst("2026-11-28T12:00")
    private fun state(fetchedAtMs: Long?) = CharacterScheduler(emptyList(), fetchedAtMs, null)
    private fun saved(characters: Map<String, CharacterScheduler> = mapOf("c1" to state(sat), "c2" to state(sat - 10 * 60_000))) =
        SavedScheduler(sat, "c1,c2", "p1:2,p2:3", characters)

    private fun fresh(s: SavedScheduler, nowMs: Long, characterKey: String = "c1,c2", partyKey: String? = "p1:2,p2:3") =
        SchedulerCache.isFresh(s, characterKey, partyKey, nowMs)

    @Test
    fun `받은 시각은 캐릭터 중 가장 오래된 값이고, 없으면 저장한 시각이다`() {
        assertEquals(sat - 10 * 60_000, SchedulerCache.dataAt(saved()))
        assertEquals(sat, SchedulerCache.dataAt(saved(mapOf("c1" to state(null)))))
    }

    @Test
    fun `받은 지 1시간 안이면 그대로 쓰고, 지나면 다시 받는다`() {
        val oldest = sat - 10 * 60_000
        assertTrue(fresh(saved(), oldest + SchedulerCache.TTL_MS - 1))
        assertFalse(fresh(saved(), oldest + SchedulerCache.TTL_MS))
    }

    @Test
    fun `주나 달이 바뀌면 1시간 안이어도 다시 받는다`() {
        assertFalse(fresh(saved(mapOf("c1" to state(kst("2026-11-25T23:40")))), kst("2026-11-26T00:10")))
        assertFalse(fresh(saved(mapOf("c1" to state(kst("2026-11-30T23:40")))), kst("2026-12-01T00:10")))
    }

    @Test
    fun `캐릭터나 파티 구성이 다르면 다시 받는다 (파티 목록을 아직 못 받았으면 구성은 보지 않음)`() {
        assertFalse(fresh(saved(), sat + 60_000, characterKey = "c1"))
        assertFalse(fresh(saved(), sat + 60_000, partyKey = "p1:3,p2:3"))
        assertTrue(fresh(saved(), sat + 60_000, partyKey = null))
    }

    @Test
    fun `파티 구성 서명은 파티 ID와 인원을 정렬해 잇는다`() {
        assertEquals("a:1,b:2", SchedulerCache.partyKeyOf(listOf("b" to 2, "a" to 1)))
        assertNull(SchedulerCache.partyKeyOf(null))
    }
}
