package com.bossplanner.app.ui

import android.net.Uri
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.FilterChip
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import coil.compose.AsyncImage
import com.bossplanner.app.data.ChatMessage
import com.bossplanner.app.data.ImageCompressor
import com.bossplanner.app.data.Money
import com.bossplanner.app.data.Party
import com.bossplanner.app.data.PartyRepository
import com.bossplanner.app.data.Schedule
import com.bossplanner.app.data.SettlementCalc
import com.bossplanner.app.data.SettlementEntry
import com.bossplanner.app.data.TimeSlots
import com.bossplanner.app.data.userMessage
import com.google.firebase.firestore.FirebaseFirestoreException
import com.google.firebase.storage.StorageException
import kotlinx.coroutines.launch

/**
 * 클리어한 일정의 분배금 정산과 채팅.
 * 위쪽은 분배금 계산·상태(대기 → 지급함 → 수령 확인), 아래쪽은 수령 방법을 주고받는 채팅이다.
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
    val context = LocalContext.current

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
                error = when (e) {
                    is FirebaseFirestoreException -> "보내지 못했습니다. 다시 시도해 주세요."
                    is StorageException -> "이미지를 올리지 못했습니다. 네트워크 상태를 확인하고 다시 시도해 주세요."
                    is IllegalArgumentException -> e.message
                    else -> e.userMessage()
                }
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

        Column(modifier = Modifier.heightIn(max = 340.dp).verticalScroll(rememberScrollState())) {
            SettlementStatus(
                uid = uid,
                party = currentParty,
                schedule = currentSchedule,
                entries = entries,
                busy = busy,
                onRegister = { sale, fee, weights -> run { parties.registerSettlement(partyId, periodId, sale, fee, weights) } },
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
            onSendImage = { imageUri, text ->
                run {
                    val jpeg = ImageCompressor.toJpeg(context, imageUri)
                    val url = parties.uploadChatImage(partyId, periodId, uid, jpeg)
                    parties.sendMessage(partyId, periodId, uid, text, url)
                }
            },
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
    onRegister: (saleAmount: Long, feePercent: Int, weights: Map<String, Int>) -> Unit,
    onMarkPaid: (recipientUid: String) -> Unit,
    onConfirmReceived: () -> Unit,
) {
    val settlement = schedule.settlement
    val isSeller = settlement?.sellerUid == uid
    // 판매자는 아무에게도 지급하기 전까지 고쳐서 다시 등록할 수 있다.
    val canEdit = settlement == null || (isSeller && entries.all { it.status == "PENDING" } && !settlement.completed)
    var editing by remember(settlement) { mutableStateOf(settlement == null) }
    // 이 레이드에 참여한 사람 (확정 당시 파티원)
    val participants = schedule.confirmed?.memberUids?.takeIf { it.isNotEmpty() } ?: party.memberUids

    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        if (schedule.state != "SETTLED") {
            Text("클리어한 일정에서만 정산할 수 있습니다.", style = MaterialTheme.typography.bodyMedium)
            return@Column
        }

        if (settlement != null) {
            Card(modifier = Modifier.fillMaxWidth()) {
                Column(modifier = Modifier.padding(16.dp)) {
                    Text("판매자 ${party.nameOf(settlement.sellerUid)}", style = MaterialTheme.typography.labelMedium)
                    if (settlement.saleAmount != null && settlement.netAmount != null) {
                        Text(
                            "경매장 판매액 ${Money.meso(settlement.saleAmount)} · 수수료 ${settlement.feePercent}%",
                            style = MaterialTheme.typography.bodySmall,
                        )
                        Text("실수령액 ${Money.meso(settlement.netAmount)}", style = MaterialTheme.typography.titleMedium)
                    }
                    if (settlement.completed) {
                        Text("전원 수령 확인 · 정산 완료", color = MaterialTheme.colorScheme.primary)
                    }
                }
            }
            entries.sortedBy { participants.indexOf(it.uid) }.forEach { entry ->
                Row(modifier = Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                    Column(modifier = Modifier.weight(1f)) {
                        Text(
                            "${party.nameOf(entry.uid)}${if (entry.uid == uid) " (나)" else ""} 정산금",
                            style = MaterialTheme.typography.bodySmall,
                        )
                        Text(Money.meso(entry.amount), style = MaterialTheme.typography.titleMedium)
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
                Text(
                    "경매장에 물건을 내 정산금 가격으로 올리고, 아래 채팅으로 판매자에게 알려 주세요.",
                    style = MaterialTheme.typography.bodySmall,
                )
            }
        }

        if (canEdit && editing) {
            SettlementForm(
                sellerUid = uid,
                party = party,
                participants = participants,
                registered = settlement != null,
                busy = busy,
                onRegister = onRegister,
            )
        } else if (canEdit) {
            TextButton(enabled = !busy, onClick = { editing = true }) { Text("금액 고치기") }
        }
    }
}

/**
 * 분배금 계산·등록. 경매장 판매액과 수수료를 넣으면 실수령액과 파티원 정산금을 바로 보여 준다.
 * 등록하는 사람이 판매자다. 인원은 이 레이드에 참여한 파티원으로 고정이다.
 */
@Composable
private fun SettlementForm(
    sellerUid: String,
    party: Party,
    participants: List<String>,
    registered: Boolean,
    busy: Boolean,
    onRegister: (saleAmount: Long, feePercent: Int, weights: Map<String, Int>) -> Unit,
) {
    var input by remember { mutableStateOf("") }
    var feePercent by remember { mutableIntStateOf(SettlementCalc.FEE_PERCENTS.first()) }
    var detailed by remember { mutableStateOf(false) }
    // uid → 비율 입력값 (글자). 비어 있거나 범위를 벗어나면 등록할 수 없다.
    var weightInputs by remember(participants) { mutableStateOf(participants.associateWith { "1" }) }

    val saleAmount = input.toLongOrNull()?.takeIf { it in 1..SettlementCalc.MAX_SALE_AMOUNT }
    val weights = weightInputs.mapValues { it.value.toIntOrNull() }
    val weightsValid = !detailed || weights.values.all { it != null && it in 1..SettlementCalc.MAX_WEIGHT }
    val usedWeights = if (detailed && weightsValid) weights.mapValues { it.value ?: 1 } else emptyMap()
    val amounts = if (saleAmount != null && weightsValid) {
        SettlementCalc.amounts(saleAmount, feePercent, sellerUid, participants, usedWeights)
    } else {
        emptyMap()
    }
    val recipients = participants.filter { it != sellerUid }

    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text(
            if (registered) "고쳐서 다시 등록합니다." else "드롭 아이템을 판매한 분이 등록해 주세요. 등록한 사람이 판매자가 됩니다.",
            style = MaterialTheme.typography.bodySmall,
        )

        OutlinedTextField(
            value = input,
            onValueChange = { text -> input = text.filter { it.isDigit() }.take(13) },
            label = { Text("경매장 판매액 (메소)") },
            supportingText = { if (saleAmount != null) Text("${Money.korean(saleAmount)} 메소") },
            singleLine = true,
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
            modifier = Modifier.fillMaxWidth(),
        )

        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Text("수수료", style = MaterialTheme.typography.titleSmall)
            SettlementCalc.FEE_PERCENTS.forEach { percent ->
                FilterChip(
                    selected = percent == feePercent,
                    enabled = !busy,
                    onClick = { feePercent = percent },
                    label = { Text("$percent%") },
                )
            }
        }

        if (saleAmount != null) {
            val net = SettlementCalc.netAmount(saleAmount, feePercent)
            Text("실수령액", style = MaterialTheme.typography.labelMedium)
            Text("${Money.meso(net)} (${Money.korean(net)})", style = MaterialTheme.typography.titleMedium)
        }

        if (recipients.isNotEmpty()) {
            Row(
                modifier = Modifier.fillMaxWidth().clickable(enabled = !busy) { detailed = !detailed },
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text("상세 비율 설정", style = MaterialTheme.typography.titleSmall, modifier = Modifier.weight(1f))
                Switch(checked = detailed, onCheckedChange = null)
            }
        }
        if (detailed) {
            Text(
                "수수료를 뗀 뒤 실제로 받는 금액을 이 비율대로 나눕니다 (1~${SettlementCalc.MAX_WEIGHT}).",
                style = MaterialTheme.typography.bodySmall,
            )
            participants.forEach { member ->
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(
                        party.nameOf(member) + if (member == sellerUid) " (판매자)" else "",
                        modifier = Modifier.weight(1f),
                    )
                    OutlinedTextField(
                        value = weightInputs[member].orEmpty(),
                        onValueChange = { text ->
                            weightInputs = weightInputs + (member to text.filter { it.isDigit() }.take(3))
                        },
                        isError = weights[member].let { it == null || it !in 1..SettlementCalc.MAX_WEIGHT },
                        singleLine = true,
                        enabled = !busy,
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                        modifier = Modifier.width(88.dp),
                    )
                }
            }
        }

        // 결과: 받을 파티원의 정산금만 보여 준다.
        if (amounts.isNotEmpty()) {
            Card(modifier = Modifier.fillMaxWidth()) {
                Column(modifier = Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    if (detailed) {
                        recipients.forEach { member ->
                            val amount = amounts[member] ?: 0
                            Text("${party.nameOf(member)} 정산금", style = MaterialTheme.typography.labelMedium)
                            Text("${Money.meso(amount)} (${Money.korean(amount)})", style = MaterialTheme.typography.titleMedium)
                        }
                    } else {
                        val amount = amounts.values.first()
                        Text("파티원 1인 정산금 (${recipients.size}명)", style = MaterialTheme.typography.labelMedium)
                        Text("${Money.meso(amount)} (${Money.korean(amount)})", style = MaterialTheme.typography.titleLarge)
                    }
                    Text(
                        "파티원이 경매장에 올릴 금액입니다. 수수료를 뗀 뒤 받는 금액이 맞도록 수수료를 포함했고, 100메소 단위로 내렸습니다.",
                        style = MaterialTheme.typography.bodySmall,
                    )
                }
            }
        }

        OutlinedButton(
            enabled = saleAmount != null && weightsValid && !busy && (recipients.isEmpty() || amounts.values.all { it > 0 }),
            modifier = Modifier.fillMaxWidth(),
            onClick = { saleAmount?.let { onRegister(it, feePercent, usedWeights) } },
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
    onSendImage: (Uri, String) -> Unit,
) {
    var draft by remember { mutableStateOf("") }
    var viewing by remember { mutableStateOf<String?>(null) }
    val listState = rememberLazyListState()
    // 사진 선택기. 고르면 지금 적어 둔 글과 함께 바로 보낸다.
    val picker = rememberLauncherForActivityResult(ActivityResultContracts.PickVisualMedia()) { picked ->
        if (picked != null) {
            onSendImage(picked, draft.trim())
            draft = ""
        }
    }

    // 새 메시지가 오면 맨 아래로 내린다.
    LaunchedEffect(messages.size) {
        if (messages.isNotEmpty()) listState.animateScrollToItem(messages.lastIndex)
    }

    Column(modifier = modifier) {
        if (messages.isEmpty()) {
            Box(Modifier.weight(1f).fillMaxWidth(), contentAlignment = Alignment.Center) {
                Text("수령 방법이나 정산 화면 캡처를 여기에 남겨 주세요.", style = MaterialTheme.typography.bodySmall)
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
                        Card {
                            Column {
                                message.imageUrl?.let { url ->
                                    AsyncImage(
                                        model = url,
                                        contentDescription = "첨부 이미지",
                                        contentScale = ContentScale.Fit,
                                        modifier = Modifier
                                            .widthIn(max = 240.dp)
                                            .heightIn(min = 80.dp, max = 240.dp)
                                            .clickable { viewing = url },
                                    )
                                }
                                if (message.text.isNotEmpty()) {
                                    Text(message.text, modifier = Modifier.padding(horizontal = 12.dp, vertical = 8.dp))
                                }
                            }
                        }
                    }
                }
            }
        }
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
            TextButton(
                enabled = !busy,
                onClick = { picker.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly)) },
            ) {
                Text(if (busy) "…" else "사진")
            }
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

    // 이미지를 누르면 크게 본다.
    viewing?.let { url ->
        Dialog(onDismissRequest = { viewing = null }) {
            AsyncImage(
                model = url,
                contentDescription = "첨부 이미지",
                contentScale = ContentScale.Fit,
                modifier = Modifier.fillMaxWidth().clickable { viewing = null },
            )
        }
    }
}
