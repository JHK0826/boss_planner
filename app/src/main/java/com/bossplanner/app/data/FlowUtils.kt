package com.bossplanner.app.data

import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.channelFlow
import kotlinx.coroutines.launch

/**
 * 원래 값(source)과, 그 값에 따라 정해지는 하위 값(details)을 함께 내보낸다.
 *
 * 하위 구독은 keyOf(원래 값)이 바뀔 때만 끊고 다시 붙인다. 원래 값이 바뀌어도 키가 같으면
 * 하위 구독은 그대로 두고 새 원래 값만 반영한다. 새로 붙인 하위 구독이 첫 값을 줄 때까지는 내보내지 않는다.
 *
 * 파티 목록에서 "일정 문서가 바뀔 때마다 불가 시간·투표 구독을 다시 붙이는" 낭비를 막는 데 쓴다.
 */
fun <S, K, D, R> Flow<S>.withDetails(
    keyOf: (S) -> K,
    details: (K) -> Flow<D>,
    merge: (S, D) -> R,
): Flow<R> {
    val source = this
    return channelFlow {
        var latest: S? = null
        var hasLatest = false
        var key: K? = null
        var hasKey = false
        var current: D? = null
        var hasCurrent = false
        var job: Job? = null

        suspend fun publish() {
            @Suppress("UNCHECKED_CAST")
            if (hasLatest && hasCurrent) send(merge(latest as S, current as D))
        }

        source.collect { value ->
            latest = value
            hasLatest = true
            val newKey = keyOf(value)
            if (!hasKey || newKey != key) {
                key = newKey
                hasKey = true
                hasCurrent = false
                job?.cancel()
                job = launch {
                    details(newKey).collect {
                        current = it
                        hasCurrent = true
                        publish()
                    }
                }
            } else {
                publish()
            }
        }
    }
}
