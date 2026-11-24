package com.bossplanner.app.ui

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Card
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.bossplanner.app.data.CharacterInfo
import com.bossplanner.app.data.CharacterScheduler
import com.bossplanner.app.data.Earnings
import com.bossplanner.app.data.EarningsRepository
import com.bossplanner.app.data.Money
import com.bossplanner.app.data.TimeSlots

/** "105억 8049만 9999 메소"처럼 크게 보여 줄 금액 */
private fun big(amount: Long): String = if (amount > 0) "${Money.korean(amount)} 메소" else "0 메소"

/**
 * 캐릭터 수익 보기: 이번 주 예상 수익, 이번 주에 번 돈(결정석 + 정산금), 월별 지표 (웹 EarningsScreen.tsx와 같음).
 * 스케줄러는 내 캐릭터 탭이 받아 둔 값을 쓴다.
 */
@Composable
fun EarningsScreen(
    uid: String,
    character: CharacterInfo?,
    characterId: String,
    scheduler: SchedulerUiState,
    onBack: () -> Unit,
    repository: EarningsRepository = remember { EarningsRepository() },
) {
    val records by remember(uid) { repository.earnings(uid) }.collectAsStateWithLifecycle(null)
    val state: CharacterScheduler? = scheduler.characters?.get(characterId)
    val now = remember { System.currentTimeMillis() }
    BackHandler(onBack = onBack)

    Column(
        modifier = Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(24.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        TextButton(onClick = onBack) { Text("← 내 캐릭터") }
        Text(character?.let { "${it.name} 수익" } ?: "수익", style = MaterialTheme.typography.headlineSmall)
        scheduler.error?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.error) }

        val loadedRecords = records
        if (state == null || loadedRecords == null) {
            if (scheduler.loading || loadedRecords == null) Loading() else Text("게임 스케줄러를 받지 못했습니다.")
            return@Column
        }
        val bosses = state.bosses
        val unpriced = bosses.filter { it.price == null }

        Card(modifier = Modifier.fillMaxWidth()) {
            Column(modifier = Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Text("이번 주 예상 수익 (결정석)", style = MaterialTheme.typography.labelMedium)
                Text(big(Earnings.expectedThisWeek(bosses)), style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
                Text(
                    "스케줄러에 등록한 주간 보스 ${bosses.count { it.isWeekly }}개" +
                        (if (bosses.any { !it.isWeekly && !it.cleared }) "와 이번 달에 아직 잡지 않은 월간 보스" else "") +
                        "의 결정석 가격 ÷ 인원수",
                    style = MaterialTheme.typography.bodySmall,
                )
                if (unpriced.isNotEmpty()) {
                    Text(
                        "가격 미등록 (0으로 계산): " + unpriced.joinToString(", ") { "${it.name}(${Earnings.short(it.difficulty)})" },
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.error,
                    )
                }
            }
        }

        val week = Earnings.earnedThisWeek(bosses, loadedRecords, characterId, now)
        Card(modifier = Modifier.fillMaxWidth()) {
            Column(modifier = Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Text("이번 주에 번 돈", style = MaterialTheme.typography.labelMedium)
                Text(big(week.total), style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
                AmountRow("결정석 (${bosses.count { it.isWeekly && it.cleared }}개 클리어)", week.crystal)
                AmountRow("정산금", week.settlement)
                week.settlements.forEach {
                    Row(modifier = Modifier.fillMaxWidth().padding(start = 12.dp)) {
                        Text("${it.partyName} · ${TimeSlots.dateTime(it.raidAtMs)}", style = MaterialTheme.typography.bodySmall, modifier = Modifier.weight(1f))
                        Text(Money.meso(it.amount), style = MaterialTheme.typography.bodySmall)
                    }
                }
                Text(
                    "정산금은 받은 사람은 수령 확인한 뒤(경매장 수수료를 뗀 금액), 판매자는 정산이 끝난 뒤에 들어갑니다.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }

        Text("월별", style = MaterialTheme.typography.titleMedium)
        Earnings.monthly(loadedRecords, characterId, now).forEach { month ->
            Row(modifier = Modifier.fillMaxWidth().padding(vertical = 6.dp)) {
                Text(month.label, fontWeight = FontWeight.SemiBold, modifier = Modifier.width(96.dp))
                if (month.recorded) {
                    Column(modifier = Modifier.weight(1f)) {
                        Text(Money.meso(month.total), fontWeight = FontWeight.Bold)
                        Text(
                            "결정석 ${Money.meso(month.crystal)} · 정산금 ${Money.meso(month.settlement)}",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                } else {
                    Text("기록 없음", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
            HorizontalDivider()
        }
        Text(
            "주간 기록은 시작일(목요일)이 속한 달로 묶고, 검은 마법사 같은 월간 보스 결정석은 잡은 달에 더합니다. " +
                "지난 주 결정석은 매주 목요일 05:00에 확정합니다" +
                (state.fetchedAtMs?.let { " · 스케줄러 ${TimeSlots.dateTime(it)} 기준" } ?: "") + ".",
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Text("Data based on NEXON Open API", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

@Composable
private fun AmountRow(label: String, amount: Long) {
    Row(modifier = Modifier.fillMaxWidth()) {
        Text(label, modifier = Modifier.weight(1f))
        Text(Money.meso(amount), fontWeight = FontWeight.Bold)
    }
}
