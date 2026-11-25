package com.bossplanner.app.ui

import androidx.annotation.DrawableRes
import com.bossplanner.app.R

/**
 * 내 캐릭터 탭 보스 칩에 쓰는 보스 이미지. 이미지는 scripts/boss_images.py로 원본 카드를 잘라 만든다.
 * 웹 lib/bossImages.ts와 같은 표다. 표에 없는 보스는 이름 글씨로 보여 준다.
 */
private val BOSS_IMAGES: Map<String, Int> = mapOf(
    "자쿰" to R.drawable.boss_zakum,
    "매그너스" to R.drawable.boss_magnus,
    "파풀라투스" to R.drawable.boss_papulatus,
    "피에르" to R.drawable.boss_pierre,
    "반반" to R.drawable.boss_vonbon,
    "블러디퀸" to R.drawable.boss_crimson_queen,
    "벨룸" to R.drawable.boss_vellum,
    "스우" to R.drawable.boss_lotus,
    "데미안" to R.drawable.boss_damien,
    "가디언 엔젤 슬라임" to R.drawable.boss_guardian_angel_slime,
    "루시드" to R.drawable.boss_lucid,
    "윌" to R.drawable.boss_will,
    "더스크" to R.drawable.boss_gloom,
    "진 힐라" to R.drawable.boss_verus_hilla,
    "듄켈" to R.drawable.boss_darknell,
    "검은 마법사" to R.drawable.boss_black_mage,
    "선택받은 세렌" to R.drawable.boss_seren,
    "감시자 칼로스" to R.drawable.boss_kalos,
    "카링" to R.drawable.boss_kaling,
    "림보" to R.drawable.boss_limbo,
    "발드릭스" to R.drawable.boss_baldrix,
    "최초의 대적자" to R.drawable.boss_first_adversary,
    "찬란한 흉성" to R.drawable.boss_radiant_malefic_star,
    "유피테르" to R.drawable.boss_jupiter,
    "벨로나" to R.drawable.boss_bellona,
).mapKeys { (name, _) -> name.filterNot { it.isWhitespace() } }

/** 보스 이미지 리소스. 이름의 띄어쓰기는 보지 않는다. 이미지가 없으면 null */
@DrawableRes
fun bossImageRes(name: String): Int? = BOSS_IMAGES[name.filterNot { it.isWhitespace() }]
