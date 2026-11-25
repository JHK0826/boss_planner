package com.bossplanner.app.ui

import android.net.Uri
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
import com.bossplanner.app.data.Mercenary
import com.bossplanner.app.data.Money
import com.bossplanner.app.data.Party
import com.bossplanner.app.data.PartyRepository
import com.bossplanner.app.data.Schedule
import com.bossplanner.app.data.SettlementCalc
import com.bossplanner.app.data.SettlementEntry
import com.bossplanner.app.data.TimeSlots
import com.bossplanner.app.data.isMercenaryId
import com.bossplanner.app.data.mercenaryLabel
import com.bossplanner.app.data.userMessage
import com.google.firebase.firestore.FirebaseFirestoreException
import com.google.firebase.storage.StorageException
import kotlinx.coroutines.launch

/**
 * 클리어한 일정의 분배금 정산과 채팅. 파티 화면의 정산 탭 안에 들어간다.
 * 위쪽은 분배금 계산·상태(대기 → 지급함 → 수령 확인), 아래쪽은 수령 방법을 주고받는 채팅이다.
 */
@Composable
fun SettlementContent(
    uid: String,
    party: Party,
    periodId: String,
    modifier: Modifier = Modifier,
    parties: PartyRepository = remember { PartyRepository() },
) {
    val partyId = party.id
    val schedule by remember(partyId, periodId) { parties.schedule(partyId, periodId) }.collectAsStateWithLifecycle(null)
    val entries by remember(partyId, periodId) { parties.settlementEntries(partyId, periodId) }
        .collectAsStateWithLifecycle(emptyList())
    val messages by remember(partyId, periodId) { parties.messages(partyId, periodId) }
        .collectAsStateWithLifecycle(emptyList())

    var busy by remember { mutableStateOf(false) }
    val showMessage = LocalShowMessage.current
    val scope = rememberCoroutineScope()
    val context = LocalContext.current

    val currentParty = party
    val currentSchedule = schedule
    if (currentSchedule == null) {
        Box(modifier.fillMaxWidth(), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
        return
    }

    /** 서버에 보내고 결과를 화면 아래 알림으로 보여 준다. */
    fun run(success: String?, action: suspend () -> Unit) =
        scope.runAction(showMessage, { busy = it }, success, { e ->
            when (e) {
                is FirebaseFirestoreException -> "보내지 못했습니다. 다시 시도해 주세요."
                is StorageException -> "이미지를 올리지 못했습니다. 네트워크 상태를 확인하고 다시 시도해 주세요."
                is IllegalArgumentException -> e.message
                else -> e.userMessage()
            }
        }, action)

    Column(modifier = modifier, verticalArrangement = Arrangement.spacedBy(8.dp)) {
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
                onRegister = { sale, fee, weights -> run("분배금을 등록했습니다. 파티원에게 알림을 보냈습니다") { parties.registerSettlement(partyId, periodId, sale, fee, weights) } },
                onMarkPaid = { recipient ->
                    val message = if (isMercenaryId(recipient)) "${currentParty.nameOf(recipient, currentSchedule.mercenaries)}에게 직접 지급했습니다"
                    else "${currentParty.nameOf(recipient)}님에게 지급함으로 표시했습니다"
                    run(message) { parties.markPaid(partyId, periodId, recipient) }
                },
                onConfirmReceived = { run("수령을 확인했습니다") { parties.confirmReceived(partyId, periodId) } },
            )
        }

        HorizontalDivider()

        Chat(
            uid = uid,
            party = currentParty,
            messages = messages,
            busy = busy,
            modifier = Modifier.weight(1f),
            onSend = { text -> run(null) { parties.sendMessage(partyId, periodId, uid, text) } },
            onSendImage = { imageUri, text ->
                run(null) {
                    val jpeg = ImageCompressor.toJpeg(context, imageUri)
                    val url = parties.uploadChatImage(partyId, periodId, uid, jpeg)
                    parties.sendMessage(partyId, periodId, uid, text, url)
                }
            },
        )
    }
}

/** 이름: 파티원 또는 그 주기 용병 */
private fun Party.nameOf(uid: String, mercenaries: List<Mercenary> = emptyList()): String =
    mercenaries.firstOrNull { it.id == uid }?.let { mercenaryLabel(it) }
        ?: members[uid]?.let { it.displayName.ifBlank { it.characterName } } ?: "파티원"

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
    // 이 레이드에 참여한 사람 (확정 당시 파티원) + 용병. 용병은 1인분을 받고 판매자가 직접 지급한다.
    val mercenaries = schedule.mercenaries
    val participants = (schedule.confirmed?.memberUids?.takeIf { it.isNotEmpty() } ?: party.memberUids) + mercenaries.map { it.id }

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
                            "${party.nameOf(entry.uid, mercenaries)}${if (entry.uid == uid) " (나)" else ""} 정산금",
                            style = MaterialTheme.typography.bodySmall,
                        )
                        Text(Money.meso(entry.amount), style = MaterialTheme.typography.titleMedium)
                        Text(
                            when {
                                isMercenaryId(entry.uid) && entry.status == "RECEIVED" -> "직접 지급 완료"
                                isMercenaryId(entry.uid) -> "대기 · 판매자가 게임에서 직접 지급"
                                entry.status == "PAID" -> "지급함 · 수령 확인 대기"
                                entry.status == "RECEIVED" -> "수령 확인"
                                else -> "대기"
                            },
                            style = MaterialTheme.typography.bodySmall,
                            color = if (entry.status == "RECEIVED") MaterialTheme.colorScheme.primary
                            else MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                    when {
                        isSeller && entry.status == "PENDING" ->
                            Button(enabled = !busy, onClick = { onMarkPaid(entry.uid) }) {
                                Text(if (isMercenaryId(entry.uid)) "직접 지급함" else "지급함")
                            }
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
                mercenaries = mercenaries,
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
 * 등록하는 사람이 판매자다. 인원은 이 레이드에 참여한 파티원과 그 주기 용병으로 고정이다.
 */
@Composable
private fun SettlementForm(
    sellerUid: String,
    party: Party,
    participants: List<String>,
    mercenaries: List<Mercenary>,
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
                        party.nameOf(member, mercenaries) + if (member == sellerUid) " (판매자)" else "",
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
                            Text("${party.nameOf(member, mercenaries)} 정산금", style = MaterialTheme.typography.labelMedium)
                            Text("${Money.meso(amount)} (${Money.korean(amount)})", style = MaterialTheme.typography.titleMedium)
                        }
                    } else {
                        val amount = amounts.values.first()
                        Text(
                            if (mercenaries.isNotEmpty()) "1인 정산금 (${recipients.size}명 · 용병 ${mercenaries.size}명 포함)"
                            else "파티원 1인 정산금 (${recipients.size}명)",
                            style = MaterialTheme.typography.labelMedium,
                        )
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
