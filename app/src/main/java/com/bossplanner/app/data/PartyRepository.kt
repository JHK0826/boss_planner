package com.bossplanner.app.data

import com.google.firebase.Timestamp
import com.google.firebase.firestore.DocumentReference
import com.google.firebase.firestore.DocumentSnapshot
import com.google.firebase.firestore.FieldValue
import com.google.firebase.firestore.FirebaseFirestore
import com.google.firebase.firestore.Query
import com.google.firebase.functions.FirebaseFunctions
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.callbackFlow
import kotlinx.coroutines.tasks.await

/**
 * 파티·일정 데이터.
 * - 읽기와 "내 불가 시간·내 투표" 쓰기는 Firestore로 직접 한다.
 * - 파티 개설·가입·탈퇴·위임은 서버 시각으로 요일을 검사해야 해서 callable로 한다.
 */
class PartyRepository(
    private val db: FirebaseFirestore = FirebaseFirestore.getInstance(),
    private val functions: FirebaseFunctions = FirebaseFunctions.getInstance("asia-northeast3"),
) {
    fun myParties(uid: String): Flow<List<Party>> =
        db.collection("parties").whereArrayContains("memberUids", uid).listen(emptyList()) { snapshot ->
            snapshot.documents.mapNotNull(::toParty).sortedBy { it.name }
        }

    /** 탈퇴했거나 없어진 파티는 null */
    fun party(partyId: String): Flow<Party?> = callbackFlow {
        val registration = db.collection("parties").document(partyId).addSnapshotListener { snapshot, error ->
            trySend(if (error != null || snapshot == null) null else toParty(snapshot))
        }
        awaitClose { registration.remove() }
    }

    /** 가장 최근 주기의 일정. 아직 첫 주기가 시작되지 않았으면 null */
    fun latestSchedule(partyId: String): Flow<Schedule?> =
        db.collection("parties").document(partyId).collection("schedules")
            .orderBy("periodStart", Query.Direction.DESCENDING)
            .limit(1)
            .listen(null) { snapshot -> snapshot.documents.firstOrNull()?.let(::toSchedule) }

    fun unavailable(partyId: String, periodId: String): Flow<Map<String, Unavailable>> =
        scheduleRef(partyId, periodId).collection("unavailable").listen(emptyMap()) { snapshot ->
            snapshot.documents.associate { doc ->
                doc.id to Unavailable(
                    slots = (doc.get("slots") as? List<*>)?.filterIsInstance<String>().orEmpty(),
                    submitted = doc.getBoolean("submitted") ?: false,
                )
            }
        }

    fun votes(partyId: String, periodId: String): Flow<Map<String, Vote>> =
        scheduleRef(partyId, periodId).collection("votes").listen(emptyMap()) { snapshot ->
            snapshot.documents.associate { doc ->
                doc.id to Vote(
                    agreed = (doc.get("agreed") as? List<*>)?.mapNotNull { (it as? Number)?.toInt() }.orEmpty(),
                    round = doc.getLong("round")?.toInt() ?: 0,
                )
            }
        }

    suspend fun setUnavailable(partyId: String, periodId: String, uid: String, slots: List<String>, submitted: Boolean) {
        scheduleRef(partyId, periodId).collection("unavailable").document(uid)
            .set(mapOf("slots" to slots.sorted(), "submitted" to submitted, "updatedAt" to FieldValue.serverTimestamp()))
            .await()
    }

    suspend fun setVote(partyId: String, periodId: String, uid: String, agreed: List<Int>, round: Int) {
        scheduleRef(partyId, periodId).collection("votes").document(uid)
            .set(mapOf("agreed" to agreed.sorted(), "round" to round, "updatedAt" to FieldValue.serverTimestamp()))
            .await()
    }

    /** @return 새 파티 ID */
    suspend fun createParty(
        name: String,
        bossName: String,
        difficulty: String,
        cycle: String,
        durationMinutes: Int,
        characterId: String,
    ): String = call(
        "createParty",
        mapOf(
            "name" to name,
            "bossName" to bossName,
            "difficulty" to difficulty,
            "cycle" to cycle,
            "durationMinutes" to durationMinutes,
            "characterId" to characterId,
        ),
    )["partyId"] as? String ?: ""

    /** @return 가입한 파티 ID */
    suspend fun joinParty(inviteCode: String, characterId: String): String =
        call("joinParty", mapOf("inviteCode" to inviteCode, "characterId" to characterId))["partyId"] as? String ?: ""

    suspend fun leaveParty(partyId: String) {
        call("leaveParty", mapOf("partyId" to partyId))
    }

    suspend fun delegateLeader(partyId: String, newLeaderUid: String) {
        call("delegateLeader", mapOf("partyId" to partyId, "newLeaderUid" to newLeaderUid))
    }

    private fun scheduleRef(partyId: String, periodId: String): DocumentReference =
        db.collection("parties").document(partyId).collection("schedules").document(periodId)

    private suspend fun call(name: String, data: Map<String, Any>): Map<*, *> =
        functions.getHttpsCallable(name).call(data).await().getData() as? Map<*, *> ?: emptyMap<Any, Any>()

    /** 쿼리 실시간 구독. 권한 오류 등으로 끊기면 예외 대신 fallback 값을 낸다. */
    private fun <T> Query.listen(
        fallback: T,
        transform: (com.google.firebase.firestore.QuerySnapshot) -> T,
    ): Flow<T> = callbackFlow {
        val registration = addSnapshotListener { snapshot, error ->
            trySend(if (error != null || snapshot == null) fallback else transform(snapshot))
        }
        awaitClose { registration.remove() }
    }

    private fun toParty(doc: DocumentSnapshot): Party? {
        if (!doc.exists()) return null
        val members = (doc.get("members") as? Map<*, *>).orEmpty().mapNotNull { (key, value) ->
            val uid = key as? String ?: return@mapNotNull null
            val m = value as? Map<*, *> ?: return@mapNotNull null
            uid to PartyMember(
                uid = uid,
                displayName = m["displayName"] as? String ?: "",
                characterName = m["characterName"] as? String ?: "",
                job = m["job"] as? String ?: "",
                level = (m["level"] as? Number)?.toInt() ?: 0,
            )
        }.toMap()
        return Party(
            id = doc.id,
            name = doc.getString("name").orEmpty(),
            bossName = doc.getString("bossName").orEmpty(),
            difficulty = doc.getString("difficulty").orEmpty(),
            cycle = doc.getString("cycle") ?: "WEEKLY",
            durationSlots = doc.getLong("durationSlots")?.toInt() ?: 2,
            leaderUid = doc.getString("leaderUid").orEmpty(),
            memberUids = (doc.get("memberUids") as? List<*>)?.filterIsInstance<String>().orEmpty(),
            members = members,
            inviteCode = doc.getString("inviteCode").orEmpty(),
            scheduleStarted = doc.getBoolean("scheduleStarted") ?: false,
        )
    }

    private fun toSchedule(doc: DocumentSnapshot): Schedule? {
        val start = doc.getTimestamp("periodStart")?.toMillis() ?: return null
        val end = doc.getTimestamp("periodEnd")?.toMillis() ?: return null
        return Schedule(
            id = doc.id,
            state = doc.getString("state") ?: "OPEN",
            periodStartMs = start,
            periodEndMs = end,
            inputDeadlineMs = doc.getTimestamp("inputDeadline")?.toMillis() ?: start,
            durationSlots = doc.getLong("durationSlots")?.toInt() ?: 2,
            round = doc.getLong("round")?.toInt() ?: 0,
            candidates = (doc.get("candidates") as? List<*>).orEmpty().mapNotNull { item ->
                val c = item as? Map<*, *> ?: return@mapNotNull null
                Candidate(
                    slotId = c["slotId"] as? String ?: return@mapNotNull null,
                    startMs = (c["start"] as? Timestamp)?.toMillis() ?: return@mapNotNull null,
                    endMs = (c["end"] as? Timestamp)?.toMillis() ?: return@mapNotNull null,
                )
            },
            unanimous = (doc.get("unanimous") as? List<*>)?.mapNotNull { (it as? Number)?.toInt() }.orEmpty(),
            skippedReason = doc.getString("skippedReason"),
        )
    }
}

private fun Timestamp.toMillis(): Long = toDate().time
