package com.bossplanner.app.ui

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.bossplanner.app.data.ChatMessage
import com.bossplanner.app.data.Party
import com.bossplanner.app.data.PartyRepository
import com.bossplanner.app.data.Schedule
import com.bossplanner.app.data.SettlementEntry
import com.bossplanner.app.data.TimeSlots
import com.bossplanner.app.data.userMessage
import com.google.firebase.firestore.FirebaseFirestoreException
import kotlinx.coroutines.launch

/** 1인 분배금 최대 입력값 (서버와 같은 값) */
private const val MAX_AMOUNT = 1_000_000_000_000L

/**
 * 클리어한 일정의 분배금 정산과 채팅.
 * 위쪽은 분배금 상태(대기 → 지급함 → 수령 확인), 아래쪽은 수령 방법을 주고받는 채팅이다.
 */
@Composable
fun SettlementScreen(
    uid: String,
    partyId: String,
    periodId: String,
    onBack: () -> Unit,
    parties: PartyRepository = remember { PartyRepository() },
) {
    val party by remember(partyId) { parties.party(partyId) }.collectAsStateWithLifecycle(null)
    val schedule by remember(partyId, periodId) { parties.schedule(partyId, periodId) }.collectAsStateWithLifecycle(null)
    val entries by remember(partyId, periodId) { parties.settlementEntries(partyId, periodId) }
        .collectAsStateWithLifecycle(emptyList())
    val messages by remember(partyId, periodId) { parties.messages(partyId, periodId) }
        .collectAsStateWithLifecycle(emptyList())

    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()

    BackHandler(enabled = !busy, onBack = onBack)

    val currentParty = party
    val currentSchedule = schedule
    if (currentParty == null || currentSchedule == null) {
        Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
        return
    }

    fun run(action: suspend () -> Unit) {
        busy = true
        error = null
        scope.launch {
            try {
                action()
            } catch (e: Exception) {
                error = if (e is FirebaseFirestoreException) "보내지 못했습니다. 다시 시도해 주세요." else e.userMessage()
            } finally {
                busy = false
            }
        }
    }

    Column(modifier = Modifier.fillMaxSize().padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        TextButton(onClick = onBack, enabled = !busy) { Text("← ${currentParty.name}") }
        Text("분배금 정산", style = MaterialTheme.typography.headlineSmall)
        currentSchedule.confirmed?.let {
            Text("${TimeSlots.range(it.startMs, it.endMs)} 레이드", style = MaterialTheme.typography.bodySmall)
        }

        Column(modifier = Modifier.heightIn(max = 300.dp).verticalScroll(rememberScrollState())) {
            SettlementStatus(
                uid = uid,
                party = currentParty,
                schedule = currentSchedule,
                entries = entries,
                busy = busy,
                onRegister = { amount -> run { parties.registerSettlement(partyId, periodId, amount) } },
                onMarkPaid = { recipient -> run { parties.markPaid(partyId, periodId, recipient) } },
                onConfirmReceived = { run { parties.confirmReceived(partyId, periodId) } },
            )
        }

        error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
        HorizontalDivider()

        Chat(
            uid = uid,
            party = currentParty,
            messages = messages,
            busy = busy,
            modifier = Modifier.weight(1f),
            onSend = { text -> run { parties.sendMessage(partyId, periodId, uid, text) } },
        )
    }
}

private fun Party.nameOf(uid: String): String =
    members[uid]?.let { it.displayName.ifBlank { it.characterName } } ?: "파티원"

@Composable
private fun SettlementStatus(
    uid: String,
    party: Party,
    schedule: Schedule,
    entries: List<SettlementEntry>,
    busy: Boolean,
    onRegister: (Long) -> Unit,
    onMarkPaid: (recipientUid: String) -> Unit,
    onConfirmReceived: () -> Unit,
) {
    val settlement = schedule.settlement
    val isSeller = settlement?.sellerUid == uid
    // 판매자는 아무에게도 지급하기 전까지 금액을 고칠 수 있다.
    val canEditAmount = settlement == null || (isSeller && entries.all { it.status == "PENDING" } && !settlement.completed)
    var editing by remember(settlement?.amountPerPerson) { mutableStateOf(settlement == null) }

    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        if (schedule.state != "SETTLED") {
            Text("클리어한 일정에서만 정산할 수 있습니다.", style = MaterialTheme.typography.bodyMedium)
            return@Column
        }

        if (settlement != null) {
            Card(modifier = Modifier.fillMaxWidth()) {
                Column(modifier = Modifier.padding(16.dp)) {
                    Text("1인 분배금 · 판매자 ${party.nameOf(settlement.sellerUid)}", style = MaterialTheme.typography.labelMedium)
                    Text(TimeSlots.meso(settlement.amountPerPerson), style = MaterialTheme.typography.titleLarge)
                    if (settlement.completed) {
                        Text("전원 수령 확인 · 정산 완료", color = MaterialTheme.colorScheme.primary)
                    }
                }
            }
            entries.sortedBy { party.memberUids.indexOf(it.uid) }.forEach { entry ->
                Row(modifier = Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                    Column(modifier = Modifier.weight(1f)) {
                        Text(
                            party.nameOf(entry.uid) + if (entry.uid == uid) " (나)" else "",
                            style = MaterialTheme.typography.titleSmall,
                        )
                        Text(
                            when (entry.status) {
                                "PAID" -> "지급함 · 수령 확인 대기"
                                "RECEIVED" -> "수령 확인"
                                else -> "대기"
                            },
                            style = MaterialTheme.typography.bodySmall,
                            color = if (entry.status == "RECEIVED") MaterialTheme.colorScheme.primary
                            else MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                    when {
                        isSeller && entry.status == "PENDING" ->
                            Button(enabled = !busy, onClick = { onMarkPaid(entry.uid) }) { Text("지급함") }
                        entry.uid == uid && entry.status == "PAID" ->
                            Button(enabled = !busy, onClick = onConfirmReceived) { Text("수령 확인") }
                    }
                }
            }
            if (!isSeller && entries.any { it.uid == uid && it.status == "PENDING" }) {
                Text("아래 채팅으로 판매자에게 수령 방법을 알려 주세요.", style = MaterialTheme.typography.bodySmall)
            }
        }

        if (canEditAmount && editing) {
            AmountForm(
                registered = settlement != null,
                recipientCount = (party.memberUids.size - 1).coerceAtLeast(0),
                busy = busy,
                onRegister = onRegister,
            )
        } else if (canEditAmount) {
            TextButton(enabled = !busy, onClick = { editing = true }) { Text("금액 고치기") }
        }
    }
}

@Composable
private fun AmountForm(registered: Boolean, recipientCount: Int, busy: Boolean, onRegister: (Long) -> Unit) {
    var input by remember { mutableStateOf("") }
    val amount = input.toLongOrNull()?.takeIf { it in 1..MAX_AMOUNT }

    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Text(
            if (registered) "금액을 고쳐 다시 등록합니다."
            else "드롭 아이템을 판매한 분이 한 사람이 받을 금액을 등록해 주세요. 등록한 사람이 판매자가 됩니다.",
            style = MaterialTheme.typography.bodySmall,
        )
        OutlinedTextField(
            value = input,
            onValueChange = { text -> input = text.filter { it.isDigit() }.take(13) },
            label = { Text("1인 분배금 (메소)") },
            supportingText = { if (amount != null) Text("${TimeSlots.meso(amount)} × ${recipientCount}명") },
            singleLine = true,
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
            modifier = Modifier.fillMaxWidth(),
        )
        OutlinedButton(
            enabled = amount != null && !busy,
            modifier = Modifier.fillMaxWidth(),
            onClick = { amount?.let(onRegister) },
        ) {
            Text(if (registered) "다시 등록" else "분배금 등록")
        }
    }
}

@Composable
private fun Chat(
    uid: String,
    party: Party,
    messages: List<ChatMessage>,
    busy: Boolean,
    modifier: Modifier,
    onSend: (String) -> Unit,
) {
    var draft by remember { mutableStateOf("") }
    val listState = rememberLazyListState()

    // 새 메시지가 오면 맨 아래로 내린다.
    LaunchedEffect(messages.size) {
        if (messages.isNotEmpty()) listState.animateScrollToItem(messages.lastIndex)
    }

    Column(modifier = modifier) {
        if (messages.isEmpty()) {
            Box(Modifier.weight(1f).fillMaxWidth(), contentAlignment = Alignment.Center) {
                Text("수령 방법을 여기에 남겨 주세요.", style = MaterialTheme.typography.bodySmall)
            }
        } else {
            LazyColumn(state = listState, modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                items(messages, key = { it.id }) { message ->
                    val mine = message.senderUid == uid
                    Column(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalAlignment = if (mine) Alignment.End else Alignment.Start,
                    ) {
                        Text(
                            "${if (mine) "나" else party.nameOf(message.senderUid)} · ${TimeSlots.dateTime(message.createdAtMs)}",
                            style = MaterialTheme.typography.labelSmall,
                        )
                        Card { Text(message.text, modifier = Modifier.padding(horizontal = 12.dp, vertical = 8.dp)) }
                    }
                }
            }
        }
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            OutlinedTextField(
                value = draft,
                onValueChange = { draft = it.take(500) },
                placeholder = { Text("메시지") },
                maxLines = 3,
                modifier = Modifier.weight(1f),
            )
            Button(
                enabled = draft.isNotBlank() && !busy,
                onClick = {
                    onSend(draft.trim())
                    draft = ""
                },
            ) {
                Text("보내기")
            }
        }
    }
}
