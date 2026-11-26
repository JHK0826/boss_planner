package com.bossplanner.app.data

import android.content.Context
import org.json.JSONObject

/**
 * 설정 탭의 사용 가이드. 문구는 저장소 최상위 guide/guide.json 한 곳에 두고 웹앱과 같이 쓴다
 * (app/build.gradle.kts가 이 폴더를 앱 자산으로 넣는다).
 */
data class GuideItem(val id: String, val title: String, val body: List<String>)

data class GuideSection(val id: String, val title: String, val items: List<GuideItem>)

/** 화면에 그릴 덩어리: 문단 하나, 또는 이어진 점 항목 묶음 */
sealed interface GuideBlock {
    data class Paragraph(val text: String) : GuideBlock
    data class Bullets(val items: List<String>) : GuideBlock
}

object Guide {
    private const val ASSET = "guide.json"

    /** 앱 자산의 가이드를 읽는다. 읽지 못하면 빈 목록 */
    fun load(context: Context): List<GuideSection> =
        runCatching { parse(context.assets.open(ASSET).bufferedReader().use { it.readText() }) }.getOrDefault(emptyList())

    fun parse(json: String): List<GuideSection> {
        val sections = JSONObject(json).getJSONArray("sections")
        return (0 until sections.length()).map { i ->
            val section = sections.getJSONObject(i)
            val items = section.getJSONArray("items")
            GuideSection(
                id = section.getString("id"),
                title = section.getString("title"),
                items = (0 until items.length()).map { j ->
                    val item = items.getJSONObject(j)
                    val body = item.getJSONArray("body")
                    GuideItem(item.getString("id"), item.getString("title"), (0 until body.length()).map { body.getString(it) })
                },
            )
        }
    }

    /** 본문 줄을 문단과 점 항목 묶음으로 나눈다. "- "로 시작하면 점 항목 (웹 lib/guide.ts와 같은 규칙) */
    fun blocks(body: List<String>): List<GuideBlock> {
        val blocks = mutableListOf<GuideBlock>()
        for (line in body) {
            if (line.startsWith("- ")) {
                val last = blocks.lastOrNull()
                if (last is GuideBlock.Bullets) {
                    blocks[blocks.lastIndex] = GuideBlock.Bullets(last.items + line.removePrefix("- "))
                } else {
                    blocks += GuideBlock.Bullets(listOf(line.removePrefix("- ")))
                }
            } else {
                blocks += GuideBlock.Paragraph(line)
            }
        }
        return blocks
    }
}
