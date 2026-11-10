package com.bossplanner.app.data

import com.google.firebase.firestore.FirebaseFirestore
import com.google.firebase.firestore.SetOptions
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.callbackFlow
import kotlinx.coroutines.tasks.await

class UserRepository(
    private val db: FirebaseFirestore = FirebaseFirestore.getInstance(),
) {
    /** users/{uid} 실시간 구독. 문서가 아직 없으면 빈 프로필을 낸다. */
    fun profile(uid: String): Flow<UserProfile> = callbackFlow {
        val registration = db.collection("users").document(uid).addSnapshotListener { snapshot, error ->
            if (error != null) {
                close(error)
                return@addSnapshotListener
            }
            trySend(
                UserProfile(
                    displayName = snapshot?.getString("displayName").orEmpty(),
                    apiKeyRegistered = snapshot?.getBoolean("apiKeyRegistered") ?: false,
                    selectedCharacterIds = (snapshot?.get("selectedCharacterIds") as? List<*>)
                        ?.filterIsInstance<String>()
                        .orEmpty(),
                ),
            )
        }
        awaitClose { registration.remove() }
    }

    suspend fun setSelectedCharacters(uid: String, characterIds: List<String>) {
        db.collection("users").document(uid)
            .set(mapOf("selectedCharacterIds" to characterIds), SetOptions.merge())
            .await()
    }

    /** getCharacterInfo가 캐시해 둔 캐릭터 기본 정보 */
    suspend fun cachedCharacters(uid: String, characterIds: List<String>): List<CharacterInfo> {
        val snapshot = db.collection("users").document(uid).collection("characters").get().await()
        val byId = snapshot.documents.associateBy { it.id }
        return characterIds.mapNotNull { id ->
            val doc = byId[id] ?: return@mapNotNull null
            CharacterInfo(
                id = id,
                name = doc.getString("name").orEmpty(),
                world = doc.getString("world").orEmpty(),
                job = doc.getString("job").orEmpty(),
                level = doc.getLong("level")?.toInt() ?: 0,
                imageUrl = doc.getString("imageUrl"),
                guild = doc.getString("guild"),
            )
        }
    }
}
