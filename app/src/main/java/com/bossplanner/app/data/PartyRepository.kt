package com.bossplanner.app.data

import com.google.firebase.Timestamp
import com.google.firebase.firestore.DocumentReference
import com.google.firebase.firestore.DocumentSnapshot
import com.google.firebase.firestore.FieldPath
import com.google.firebase.firestore.FieldValue
import com.google.firebase.firestore.FirebaseFirestore
import com.google.firebase.firestore.Query
import com.google.firebase.functions.FirebaseFunctions
import com.google.firebase.storage.FirebaseStorage
import com.google.firebase.storage.StorageMetadata
import java.util.UUID
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
    private val storage: FirebaseStorage = FirebaseStorage.getInstance(),
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

    /** 파티의 가장 최근 일정을 한 번만 읽는다. 없으면 null */
    suspend fun latestScheduleOnce(partyId: String): Schedule? =
        db.collection("parties").document(partyId).collection("schedules")
            .orderBy("periodStart", Query.Direction.DESCENDING)
            .limit(1)
            .get()
            .await()
            .documents.firstOrNull()?.let(::toSchedule)

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
                    imageUrl = doc.getString("imageUrl"),
                )
            }
        }

    suspend fun sendMessage(partyId: String, periodId: String, uid: String, text: String, imageUrl: String? = null) {
        val message = mutableMapOf<String, Any>(
            "senderUid" to uid,
            "text" to text,
            "createdAt" to FieldValue.serverTimestamp(),
        )
        if (imageUrl != null) message["imageUrl"] = imageUrl
        scheduleRef(partyId, periodId).collection("messages").add(message).await()
    }

    /**
     * 채팅에 첨부할 이미지를 Firebase Storage에 올리고 내려받기 주소를 돌려준다.
     * 경로는 storage.rules와 맞춰야 한다: 파티원만 읽고, 자기 폴더에만 올릴 수 있다.
     */
    suspend fun uploadChatImage(partyId: String, periodId: String, uid: String, jpeg: ByteArray): String {
        val ref = storage.reference
            .child("parties/$partyId/schedules/$periodId/chat/$uid/${UUID.randomUUID()}.jpg")
        ref.putBytes(jpeg, StorageMetadata.Builder().setContentType("image/jpeg").build()).await()
        return ref.downloadUrl.await().toString()
    }

    /**
     * 경매장 판매액과 수수료로 분배금을 등록한다. 파티원별 정산금은 서버가 계산한다.
     * @param weights 실수령 기준 분배 비율 (uid → 1~100). 비어 있으면 전원 같은 몫
     */
    suspend fun registerSettlement(
        partyId: String,
        periodId: String,
        saleAmount: Long,
        feePercent: Int,
        weights: Map<String, Int>,
    ) {
        call(
            "registerSettlement",
            mapOf(
                "partyId" to partyId,
                "periodId" to periodId,
                "saleAmount" to saleAmount,
                "feePercent" to feePercent,
                "weights" to weights,
            ),
        )
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

    /**
     * fromMs 이후의 내 확정 일정. 여러 파티의 일정을 시간순으로 모은다.
     * busy는 30분 칸마다 문서가 하나씩 있어서, 같은 레이드의 칸을 하나로 묶는다.
     */
    fun myRaids(uid: String, fromMs: Long): Flow<List<Raid>> =
        db.collection("users").document(uid).collection("busy")
            .orderBy(FieldPath.documentId())
            .startAt(TimeSlots.slotId(fromMs))
            .listen(emptyList()) { snapshot ->
                snapshot.documents.mapNotNull { doc ->
                    Raid(
                        partyId = doc.getString("partyId") ?: return@mapNotNull null,
                        partyName = doc.getString("partyName").orEmpty(),
                        bosses = toBosses(doc),
                        startMs = doc.getTimestamp("start")?.toMillis() ?: return@mapNotNull null,
                        endMs = doc.getTimestamp("end")?.toMillis() ?: return@mapNotNull null,
                    )
                }.distinct().sortedBy { it.startMs }
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
        preferredWindow: PreferredWindow?,
        minLeadMinutes: Int,
    ): String {
        val data = mutableMapOf<String, Any>(
            "name" to name,
            "bosses" to bosses.map { mapOf("name" to it.name, "difficulty" to it.difficulty) },
            "durationMinutes" to durationMinutes,
            "characterId" to characterId,
            "minLeadMinutes" to minLeadMinutes,
        )
        if (preferredWindow != null) data["preferredWindow"] = preferredWindow.toMap()
        return call("createParty", data)["partyId"] as? String ?: ""
    }

    /** 파티장이 추천 설정을 바꾼다. 조율 중이면 서버가 후보를 다시 계산한다. */
    suspend fun updatePartyPreferences(partyId: String, preferredWindow: PreferredWindow?, minLeadMinutes: Int) {
        // 선호 시간대를 없앨 때는 null을 보내야 한다.
        val data = HashMap<String, Any?>()
        data["partyId"] = partyId
        data["minLeadMinutes"] = minLeadMinutes
        data["preferredWindow"] = preferredWindow?.toMap()
        functions.getHttpsCallable("updatePartyPreferences").call(data).await()
    }

    /**
     * 파티원들이 파티에 넣은 캐릭터의 이미지 주소 (uid → 주소).
     * 각자의 캐릭터 정보 캐시(users/{uid}/characters/{characterId})에서 읽는다. 없으면 빠진다.
     */
    suspend fun memberImages(party: Party): Map<String, String> =
        party.members.values.mapNotNull { member ->
            if (member.characterId.isEmpty()) return@mapNotNull null
            val url = runCatching {
                db.collection("users").document(member.uid).collection("characters").document(member.characterId)
                    .get().await().getString("imageUrl")
            }.getOrNull()
            if (url.isNullOrEmpty()) null else member.uid to url
        }.toMap()

    private fun PreferredWindow.toMap(): Map<String, Any> =
        mapOf("days" to days, "startRow" to startRow, "endRow" to endRow)

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
            preferredWindow = (doc.get("preferredWindow") as? Map<*, *>)?.let { w ->
                PreferredWindow(
                    days = (w["days"] as? List<*>)?.mapNotNull { (it as? Number)?.toInt() }.orEmpty(),
                    startRow = (w["startRow"] as? Number)?.toInt() ?: return@let null,
                    endRow = (w["endRow"] as? Number)?.toInt() ?: return@let null,
                )
            },
            // 설정이 없는 예전 파티에는 서버 기본값(3시간)이 적용된다.
            minLeadMinutes = doc.getLong("minLeadMinutes")?.toInt() ?: 180,
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
                Confirmed(
                    startMs = confirmedStart,
                    endMs = confirmedEnd,
                    memberUids = (c["memberUids"] as? List<*>)?.filterIsInstance<String>().orEmpty(),
                )
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
                    saleAmount = (m["saleAmount"] as? Number)?.toLong(),
                    feePercent = (m["feePercent"] as? Number)?.toInt(),
                    netAmount = (m["netAmount"] as? Number)?.toLong(),
                    amountPerPerson = (m["amountPerPerson"] as? Number)?.toLong(),
                    completed = m["completed"] as? Boolean ?: false,
                )
            },
        )
    }
}

private fun Timestamp.toMillis(): Long = toDate().time
