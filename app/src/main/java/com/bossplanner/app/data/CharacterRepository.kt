package com.bossplanner.app.data

import com.google.firebase.functions.FirebaseFunctions
import com.google.firebase.functions.FirebaseFunctionsException
import kotlinx.coroutines.tasks.await

private const val REGION = "asia-northeast3"

/**
 * NEXON API는 Cloud Functions가 대신 호출한다.
 * API Key는 registerApiKey로 한 번 보낸 뒤 앱에 저장하지 않는다.
 */
class CharacterRepository(
    private val functions: FirebaseFunctions = FirebaseFunctions.getInstance(REGION),
) {
    suspend fun registerApiKey(apiKey: String): List<CharacterSummary> =
        parseList(call("registerApiKey", mapOf("apiKey" to apiKey)))

    suspend fun listCharacters(refresh: Boolean = false): List<CharacterSummary> =
        parseList(call("listCharacters", mapOf("refresh" to refresh)))

    suspend fun getCharacterInfo(characterId: String): CharacterInfo {
        val map = call("getCharacterInfo", mapOf("characterId" to characterId))
        return CharacterInfo(
            id = map["id"] as? String ?: characterId,
            name = map["name"] as? String ?: "",
            world = map["world"] as? String ?: "",
            job = map["job"] as? String ?: "",
            level = (map["level"] as? Number)?.toInt() ?: 0,
            imageUrl = map["imageUrl"] as? String,
            guild = map["guild"] as? String,
        )
    }

    private suspend fun call(name: String, data: Map<String, Any>): Map<*, *> =
        functions.getHttpsCallable(name).call(data).await().getData() as? Map<*, *> ?: emptyMap<Any, Any>()

    private fun parseList(map: Map<*, *>): List<CharacterSummary> =
        (map["characters"] as? List<*>).orEmpty().mapNotNull { item ->
            val c = item as? Map<*, *> ?: return@mapNotNull null
            CharacterSummary(
                id = c["id"] as? String ?: return@mapNotNull null,
                name = c["name"] as? String ?: "",
                world = c["world"] as? String ?: "",
                job = c["job"] as? String ?: "",
                level = (c["level"] as? Number)?.toInt() ?: 0,
            )
        }
}

/** 서버가 보낸 한국어 메시지를 그대로 쓰고, 그 밖의 오류는 일반 문구로 바꾼다. */
fun Throwable.userMessage(): String = when {
    this is FirebaseFunctionsException && code != FirebaseFunctionsException.Code.INTERNAL && !message.isNullOrBlank() ->
        message!!
    else -> "요청을 처리하지 못했습니다. 네트워크 상태를 확인하고 다시 시도해 주세요."
}
