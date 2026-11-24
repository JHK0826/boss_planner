package com.bossplanner.app.ui

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Check
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.bossplanner.app.data.Earnings
import com.bossplanner.app.data.SchedulerBoss

private val CHIP_WIDTH = 52.dp

/**
 * 게임 스케줄러에 등록한 보스 칩: 보스 이름, 클리어면 체크, 아래에 난이도 배지.
 * 앱에 그 보스로 들어간 파티가 있으면 배지에 인원수를 붙인다 (예: H/3). 웹 ui/BossChips.tsx와 같다.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun BossChips(bosses: List<SchedulerBoss>) {
    FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        bosses.forEach { boss -> BossChip(boss) }
    }
}

@Composable
private fun BossChip(boss: SchedulerBoss) {
    val badge = Earnings.short(boss.difficulty) + if (boss.partySize > 1) "/${boss.partySize}" else ""
    val label = "${boss.name} $badge" + if (boss.cleared) " 클리어" else ""
    Column(
        modifier = Modifier.width(CHIP_WIDTH).semantics { contentDescription = label },
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Box(
            modifier = Modifier
                .size(CHIP_WIDTH)
                .background(MaterialTheme.colorScheme.surfaceVariant, RoundedCornerShape(8.dp))
                .padding(2.dp),
            contentAlignment = Alignment.Center,
        ) {
            if (!boss.isWeekly) {
                Text(
                    "월",
                    fontSize = 10.sp,
                    fontWeight = FontWeight.Bold,
                    color = MaterialTheme.colorScheme.primary,
                    modifier = Modifier.align(Alignment.TopStart).padding(start = 2.dp),
                )
            }
            Text(
                boss.name,
                fontSize = 11.sp,
                lineHeight = 12.sp,
                textAlign = TextAlign.Center,
                modifier = Modifier.alpha(if (boss.cleared) 0.45f else 1f),
            )
            if (boss.cleared) Icon(Icons.Filled.Check, contentDescription = null, modifier = Modifier.size(30.dp))
        }
        DifficultyBadge(boss.difficulty, badge, Modifier.padding(top = 4.dp).fillMaxWidth())
    }
}

@Composable
private fun DifficultyBadge(difficulty: String, text: String, modifier: Modifier) {
    val shape = RoundedCornerShape(9.dp)
    val (background, content, border) = when (difficulty) {
        "EXTREME" -> Triple(Color(0xFF3B0B0A), Color(0xFFFFB4AB), Color(0xFF8C1D18))
        "CHAOS" -> Triple(Color.Transparent, MaterialTheme.colorScheme.onSurface, MaterialTheme.colorScheme.outline)
        "HARD" -> Triple(Color(0xFFC2185B), Color.White, Color.Transparent)
        "NORMAL" -> Triple(Color(0xFF00838F), Color.White, Color.Transparent)
        else -> Triple(MaterialTheme.colorScheme.surfaceVariant, MaterialTheme.colorScheme.onSurfaceVariant, Color.Transparent)
    }
    Text(
        text,
        fontSize = 11.sp,
        fontWeight = FontWeight.Bold,
        color = content,
        textAlign = TextAlign.Center,
        modifier = modifier.background(background, shape).border(BorderStroke(1.dp, border), shape).padding(vertical = 1.dp),
    )
}
