package com.bossplanner.app.data

import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.onCompletion
import kotlinx.coroutines.flow.onStart
import kotlinx.coroutines.flow.toList
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class FlowUtilsTest {
    /** 원래 값: (키, 그 밖의 값). 키가 같으면 하위 구독을 다시 붙이지 않아야 한다. */
    private data class Source(val key: String, val value: Int)

    // 키가 같으면 하위 구독을 다시 붙이지 않고 새 값만 반영한다.
    // (테스트 이름은 영어로 둔다. 람다가 만드는 클래스 파일 이름에 한글이 들어가면 빌드 환경에 따라 컴파일이 실패한다.)
    @Test
    fun keepsDetailsSubscriptionWhileKeyIsUnchanged() = runTest {
        val source = MutableSharedFlow<Source>()
        val details = mutableMapOf<String, MutableStateFlow<String>>()
        val subscribed = mutableListOf<String>()
        var active = 0
        val results = mutableListOf<String>()

        val job = launch(UnconfinedTestDispatcher(testScheduler)) {
            source.withDetails(
                keyOf = { it.key },
                details = { key ->
                    details.getOrPut(key) { MutableStateFlow("$key-0") }
                        .onStart { subscribed += key; active++ }
                        .onCompletion { active-- }
                },
            ) { s, d -> "${s.value}/$d" }.toList(results)
        }

        source.emit(Source("A", 1))
        source.emit(Source("A", 2)) // 일정의 다른 값만 바뀜
        details.getValue("A").value = "A-1" // 하위 값이 바뀜
        source.emit(Source("B", 3)) // 지켜볼 대상이 바뀜

        assertEquals(listOf("A", "B"), subscribed)
        assertEquals(1, active) // A 구독은 끊기고 B만 남는다
        assertEquals(listOf("1/A-0", "2/A-0", "2/A-1", "3/B-0"), results)
        job.cancel()
    }

    // 새 하위 구독의 첫 값이 오기 전에는 내보내지 않는다.
    @Test
    fun waitsForFirstDetailsBeforeEmitting() = runTest {
        val source = MutableSharedFlow<Source>()
        val detail = MutableSharedFlow<String>()
        val results = mutableListOf<String>()

        val job = launch(UnconfinedTestDispatcher(testScheduler)) {
            source.withDetails(keyOf = { it.key }, details = { detail }) { s, d -> "${s.value}/$d" }.toList(results)
        }

        source.emit(Source("A", 1))
        source.emit(Source("A", 2))
        assertEquals(emptyList<String>(), results)

        detail.emit("first")
        assertEquals(listOf("2/first"), results)
        job.cancel()
    }
}
