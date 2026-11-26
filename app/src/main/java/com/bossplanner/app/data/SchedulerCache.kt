package com.bossplanner.app.data

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import java.time.Instant
import java.time.ZoneId

/** 기기에 저장해 둔 게임 스케줄러 (서버 getSchedulerState의 응답) */
data class SavedScheduler(
    val savedAt: Long,
    /** 골라 둔 캐릭터 ID를 이은 값 */
    val characterKey: String,
    /** 파티 구성(파티 ID·인원). 인원수(H/3)가 바뀌었는지 본다. 파티 목록을 아직 못 받았으면 null */
    val partyKey: String?,
    val characters: Map<String, CharacterScheduler>,
)

/**
 * 내 캐릭터 탭의 게임 스케줄러를 기기에 저장해 두고, 앱을 다시 열면 바로 보여 준다 (웹 lib/schedulerCache.ts와 같은 규칙).
 * 저장한 값이 아직 새것이면 서버를 부르지 않는다. 서버도 같은 시간(1시간) 동안 NEXON을 다시 부르지 않는다.
 */
object SchedulerCache {
    /** 이 시간 안에 받은 값이면 서버를 다시 부르지 않는다 (서버의 SCHEDULER_CACHE_MS와 같음) */
    const val TTL_MS = 60 * 60 * 1000L
    private const val FILE = "scheduler_cache"
    private val KST: ZoneId = ZoneId.of("Asia/Seoul")

    /** 파티 구성 서명: 파티 ID와 파티원 수. 파티 목록을 아직 못 받았으면 null */
    fun partyKeyOf(parties: List<Pair<String, Int>>?): String? =
        parties?.map { (id, members) -> "$id:$members" }?.sorted()?.joinToString(",")

    /** 저장한 값이 받아 온 시각 (캐릭터 중 가장 오래된 값). 받은 시각이 없으면 저장한 시각 */
    fun dataAt(saved: SavedScheduler): Long = saved.characters.values.mapNotNull { it.fetchedAtMs }.minOrNull() ?: saved.savedAt

    /**
     * 저장한 값을 그대로 써도 되는가: 같은 캐릭터·같은 파티 구성이고, 받은 지 1시간 안이며,
     * 그 사이 주(목요일)나 달(1일)이 바뀌지 않았다(클리어가 초기화됨).
     */
    fun isFresh(saved: SavedScheduler, characterKey: String, partyKey: String?, nowMs: Long): Boolean {
        if (saved.characterKey != characterKey) return false
        if (saved.partyKey != null && partyKey != null && saved.partyKey != partyKey) return false
        val at = dataAt(saved)
        if (nowMs - at >= TTL_MS) return false
        return TimeSlots.weekStart(at) == TimeSlots.weekStart(nowMs) && monthOf(at) == monthOf(nowMs)
    }

    private fun monthOf(ms: Long): Int = Instant.ofEpochMilli(ms).atZone(KST).let { it.year * 100 + it.monthValue }

    /** 저장한 값. 없거나 읽을 수 없으면 null */
    fun load(context: Context, uid: String): SavedScheduler? = runCatching {
        val raw = context.getSharedPreferences(FILE, Context.MODE_PRIVATE).getString(uid, null) ?: return null
        fromJson(JSONObject(raw))
    }.getOrNull()

    fun save(context: Context, uid: String, saved: SavedScheduler) {
        runCatching {
            context.getSharedPreferences(FILE, Context.MODE_PRIVATE).edit().putString(uid, toJson(saved).toString()).apply()
        }
    }

    private fun toJson(saved: SavedScheduler): JSONObject = JSONObject().apply {
        put("savedAt", saved.savedAt)
        put("characterKey", saved.characterKey)
        put("partyKey", saved.partyKey ?: JSONObject.NULL)
        put(
            "characters",
            JSONObject().apply {
                saved.characters.forEach { (id, state) ->
                    put(
                        id,
                        JSONObject().apply {
                            put("fetchedAtMs", state.fetchedAtMs ?: JSONObject.NULL)
                            put("error", state.error ?: JSONObject.NULL)
                            put(
                                "bosses",
                                JSONArray().apply {
                                    state.bosses.forEach { boss ->
                                        put(
                                            JSONObject().apply {
                                                put("name", boss.name)
                                                put("difficulty", boss.difficulty)
                                                put("cycle", boss.cycle)
                                                put("cleared", boss.cleared)
                                                put("partySize", boss.partySize)
                                                put("price", boss.price ?: JSONObject.NULL)
                                                put("share", boss.share)
                                            },
                                        )
                                    }
                                },
                            )
                        },
                    )
                }
            },
        )
    }

    private fun fromJson(json: JSONObject): SavedScheduler {
        val characters = json.getJSONObject("characters")
        return SavedScheduler(
            savedAt = json.getLong("savedAt"),
            characterKey = json.getString("characterKey"),
            partyKey = if (json.isNull("partyKey")) null else json.getString("partyKey"),
            characters = characters.keys().asSequence().associateWith { id ->
                val state = characters.getJSONObject(id)
                val bosses = state.getJSONArray("bosses")
                CharacterScheduler(
                    bosses = (0 until bosses.length()).map { i ->
                        val boss = bosses.getJSONObject(i)
                        SchedulerBoss(
                            name = boss.getString("name"),
                            difficulty = boss.getString("difficulty"),
                            cycle = boss.getString("cycle"),
                            cleared = boss.getBoolean("cleared"),
                            partySize = boss.getInt("partySize"),
                            price = if (boss.isNull("price")) null else boss.getLong("price"),
                            share = boss.getLong("share"),
                        )
                    },
                    fetchedAtMs = if (state.isNull("fetchedAtMs")) null else state.getLong("fetchedAtMs"),
                    error = if (state.isNull("error")) null else state.getString("error"),
                )
            },
        )
    }
}
