package com.bossplanner.app.data

import com.google.firebase.Timestamp
import com.google.firebase.firestore.DocumentReference
import com.google.firebase.firestore.DocumentSnapshot
import com.google.firebase.firestore.FieldPath
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

    /**
     * 최근 주기의 일정들 (최신순). 첫 번째가 이번 주기이고, 나머지는 정산이 덜 끝난 지난 주기를 찾는 데 쓴다.
     * 아직 첫 주기가 시작되지 않았으면 빈 목록.
     */
    fun recentSchedules(partyId: String): Flow<List<Schedule>> =
        db.collection("parties").document(partyId).collection("schedules")
            .orderBy("periodStart", Query.Direction.DESCENDING)
            .limit(5)
            .listen(emptyList()) { snapshot -> snapshot.documents.mapNotNull(::toSchedule) }

    fun schedule(partyId: String, periodId: String): Flow<Schedule?> = callbackFlow {
        val registration = scheduleRef(partyId, periodId).addSnapshotListener { snapshot, error ->
            trySend(if (error != null || snapshot == null || !snapshot.exists()) null else toSchedule(snapshot))
        }
        awaitClose { registration.remove() }
    }

    fun settlementEntries(partyId: String, periodId: String): Flow<List<SettlementEntry>> =
        scheduleRef(partyId, periodId).collection("settlement").listen(emptyList()) { snapshot ->
            snapshot.documents.map { doc ->
                SettlementEntry(
                    uid = doc.id,
                    amount = doc.getLong("amount") ?: 0,
                    status = doc.getString("status") ?: "PENDING",
                )
            }
        }

    fun messages(partyId: String, periodId: String): Flow<List<ChatMessage>> =
        scheduleRef(partyId, periodId).collection("messages").orderBy("createdAt").listen(emptyList()) { snapshot ->
            snapshot.documents.map { doc ->
                ChatMessage(
                    id = doc.id,
                    senderUid = doc.getString("senderUid").orEmpty(),
                    text = doc.getString("text").orEmpty(),
                    // 방금 보낸 메시지는 서버 시각이 아직 없어서 추정값을 쓴다.
                    createdAtMs = doc.getTimestamp("createdAt", DocumentSnapshot.ServerTimestampBehavior.ESTIMATE)
                        ?.toMillis() ?: 0,
                )
            }
        }

    suspend fun sendMessage(partyId: String, periodId: String, uid: String, text: String) {
        scheduleRef(partyId, periodId).collection("messages")
            .add(mapOf("senderUid" to uid, "text" to text, "createdAt" to FieldValue.serverTimestamp()))
            .await()
    }

    suspend fun registerSettlement(partyId: String, periodId: String, amountPerPerson: Long) {
        call("registerSettlement", mapOf("partyId" to partyId, "periodId" to periodId, "amountPerPerson" to amountPerPerson))
    }

    suspend fun markPaid(partyId: String, periodId: String, recipientUid: String) {
        call("markPaid", mapOf("partyId" to partyId, "periodId" to periodId, "recipientUid" to recipientUid))
    }

    suspend fun confirmReceived(partyId: String, periodId: String) {
        call("confirmReceived", mapOf("partyId" to partyId, "periodId" to periodId))
    }

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

    /** 레이드가 끝난 뒤 결과를 직접 기록한다. 서버가 바로 SETTLED / RETRY / EXPIRED로 넘긴다. */
    suspend fun recordClear(partyId: String, periodId: String, uid: String, cleared: Boolean) {
        scheduleRef(partyId, periodId).collection("clears").document(uid)
            .set(
                mapOf(
                    "result" to if (cleared) "CLEARED" else "NOT_CLEARED",
                    "recordedAt" to FieldValue.serverTimestamp(),
                ),
            )
            .await()
    }

    /** 파티장이 전원 동의 후보를 확정한다. 다른 파티 일정과 겹치면 서버가 거절한다. */
    suspend fun confirmSchedule(partyId: String, periodId: String, candidateIndex: Int) {
        call("confirmSchedule", mapOf("partyId" to partyId, "periodId" to periodId, "candidateIndex" to candidateIndex))
    }

    suspend fun requestChange(partyId: String, periodId: String, reason: String) {
        call("requestChange", mapOf("partyId" to partyId, "periodId" to periodId, "reason" to reason))
    }

    suspend fun respondToChange(partyId: String, periodId: String, approve: Boolean) {
        call("approveChange", mapOf("partyId" to partyId, "periodId" to periodId, "approve" to approve))
    }

    /** 아직 끝나지 않은 내 확정 일정. 여러 파티의 일정을 시간순으로 모은다. */
    fun myRaids(uid: String): Flow<List<Raid>> {
        val now = System.currentTimeMillis()
        // busy는 30분 칸마다 문서가 하나씩 있다. 어제부터의 칸을 읽어 레이드 단위로 묶는다.
        return db.collection("users").document(uid).collection("busy")
            .orderBy(FieldPath.documentId())
            .startAt(TimeSlots.slotId(now - 24 * 60 * 60 * 1000L))
            .listen(emptyList()) { snapshot ->
                snapshot.documents.mapNotNull { doc ->
                    Raid(
                        partyId = doc.getString("partyId") ?: return@mapNotNull null,
                        partyName = doc.getString("partyName").orEmpty(),
                        bosses = toBosses(doc),
                        startMs = doc.getTimestamp("start")?.toMillis() ?: return@mapNotNull null,
                        endMs = doc.getTimestamp("end")?.toMillis() ?: return@mapNotNull null,
                    )
                }.distinct().filter { it.endMs > now }.sortedBy { it.startMs }
            }
    }

    suspend fun setVote(partyId: String, periodId: String, uid: String, agreed: List<Int>, round: Int) {
        scheduleRef(partyId, periodId).collection("votes").document(uid)
            .set(mapOf("agreed" to agreed.sorted(), "round" to round, "updatedAt" to FieldValue.serverTimestamp()))
            .await()
    }

    /** 파티로 갈 수 있는 보스 목록과 소요 시간 기준 */
    suspend fun getBossCatalog(): BossCatalog {
        val result = call("getBossCatalog", emptyMap())
        return BossCatalog(
            bosses = (result["bosses"] as? List<*>).orEmpty().mapNotNull { item ->
                val boss = item as? Map<*, *> ?: return@mapNotNull null
                BossCatalogEntry(
                    name = boss["name"] as? String ?: return@mapNotNull null,
                    difficulties = (boss["difficulties"] as? List<*>)?.filterIsInstance<String>().orEmpty(),
                    monthly = boss["cycle"] == "MONTHLY",
                )
            },
            minutesPerBoss = (result["minutesPerBoss"] as? Number)?.toInt() ?: 20,
            maxDurationMinutes = (result["maxDurationMinutes"] as? Number)?.toInt() ?: 240,
        )
    }

    /** 주기(주간/월간)는 고른 보스에 따라 서버가 정한다. @return 새 파티 ID */
    suspend fun createParty(
        name: String,
        bosses: List<PartyBoss>,
        durationMinutes: Int,
        characterId: String,
    ): String = call(
        "createParty",
        mapOf(
            "name" to name,
            "bosses" to bosses.map { mapOf("name" to it.name, "difficulty" to it.difficulty) },
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
                characterId = m["characterId"] as? String ?: "",
            )
        }.toMap()
        return Party(
            id = doc.id,
            name = doc.getString("name").orEmpty(),
            bosses = toBosses(doc),
            cycle = doc.getString("cycle") ?: "WEEKLY",
            durationMinutes = doc.getLong("durationMinutes")?.toInt() ?: ((doc.getLong("durationSlots")?.toInt() ?: 2) * 30),
            leaderUid = doc.getString("leaderUid").orEmpty(),
            memberUids = (doc.get("memberUids") as? List<*>)?.filterIsInstance<String>().orEmpty(),
            members = members,
            inviteCode = doc.getString("inviteCode").orEmpty(),
            scheduleStarted = doc.getBoolean("scheduleStarted") ?: false,
        )
    }

    private fun toBosses(doc: DocumentSnapshot): List<PartyBoss> =
        (doc.get("bosses") as? List<*>).orEmpty().mapNotNull { item ->
            val boss = item as? Map<*, *> ?: return@mapNotNull null
            PartyBoss(
                name = boss["name"] as? String ?: return@mapNotNull null,
                difficulty = boss["difficulty"] as? String ?: "",
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
            confirmed = (doc.get("confirmed") as? Map<*, *>)?.let { c ->
                val confirmedStart = (c["start"] as? Timestamp)?.toMillis() ?: return@let null
                val confirmedEnd = (c["end"] as? Timestamp)?.toMillis() ?: return@let null
                Confirmed(confirmedStart, confirmedEnd)
            },
            changeRequest = (doc.get("changeRequest") as? Map<*, *>)?.let { r ->
                ChangeRequest(
                    requestedBy = r["requestedBy"] as? String ?: "",
                    reason = r["reason"] as? String ?: "",
                    status = r["status"] as? String ?: "",
                )
            },
            retryCount = doc.getLong("retryCount")?.toInt() ?: 0,
            expiredReason = doc.getString("expiredReason"),
            settlement = (doc.get("settlement") as? Map<*, *>)?.let { m ->
                Settlement(
                    sellerUid = m["sellerUid"] as? String ?: return@let null,
                    amountPerPerson = (m["amountPerPerson"] as? Number)?.toLong() ?: 0,
                    completed = m["completed"] as? Boolean ?: false,
                )
            },
        )
    }
}

private fun Timestamp.toMillis(): Long = toDate().time
