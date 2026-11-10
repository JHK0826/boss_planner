package com.bossplanner.app.data

/** 캐릭터 목록 항목. ocid는 서버에만 있고 앱은 id로만 가리킨다. */
data class CharacterSummary(
    val id: String,
    val name: String,
    val world: String,
    val job: String,
    val level: Int,
)

data class CharacterInfo(
    val id: String,
    val name: String,
    val world: String,
    val job: String,
    val level: Int,
    val imageUrl: String?,
    val guild: String?,
)

data class UserProfile(
    val displayName: String = "",
    val apiKeyRegistered: Boolean = false,
    val selectedCharacterIds: List<String> = emptyList(),
)
