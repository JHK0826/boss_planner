package com.bossplanner.app.data

import org.junit.Assert.assertEquals
import org.junit.Test

/** 웹 test/guide.test.ts와 같은 규칙 (JSON 읽기는 org.json이라 기기에서만 동작해, 여기서는 나누기 규칙만 본다) */
class GuideTest {
    @Test
    fun `본문은 문단과, 이어진 점 항목 묶음으로 나뉜다`() {
        assertEquals(
            listOf(
                GuideBlock.Paragraph("요약"),
                GuideBlock.Bullets(listOf("하나", "둘")),
                GuideBlock.Paragraph("다음 문단"),
                GuideBlock.Bullets(listOf("셋")),
            ),
            Guide.blocks(listOf("요약", "- 하나", "- 둘", "다음 문단", "- 셋")),
        )
    }
}
