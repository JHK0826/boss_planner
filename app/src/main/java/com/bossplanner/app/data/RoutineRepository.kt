package com.bossplanner.app.data

import com.google.firebase.firestore.FieldValue
import com.google.firebase.firestore.FirebaseFirestore
import kotlinx.coroutines.tasks.await

/**
 * 고정 불가 시간: 매주 반복되는 안 되는 시간(출근, 수면 등).
 *
 * 한 번 저장해 두면 새 주기의 불가 시간표가 이 값으로 미리 채워진다.
 * 칸은 "D{요일}-{HHmm}" 형식이고 요일은 1(월)~7(일)이다. 본인만 읽을 수 있는
 * users/{uid}/private/routine에 저장한다.
 */
class RoutineRepository(
    private val db: FirebaseFirestore = FirebaseFirestore.getInstance(),
) {
    private fun ref(uid: String) =
        db.collection("users").document(uid).collection("private").document("routine")

    suspend fun load(uid: String): Set<String> =
        (ref(uid).get().await().get("slots") as? List<*>)?.filterIsInstance<String>().orEmpty().toSet()

    suspend fun save(uid: String, slots: Set<String>) {
        ref(uid).set(mapOf("slots" to slots.sorted(), "updatedAt" to FieldValue.serverTimestamp())).await()
    }

    companion object {
        /** 요일(1=월 ~ 7=일)과 하루 안의 칸 번호(0~47)로 만든 고정 시간 칸 ID */
        fun key(weekday: Int, row: Int): String = "D%d-%02d%02d".format(weekday, row / 2, (row % 2) * 30)
    }
}
