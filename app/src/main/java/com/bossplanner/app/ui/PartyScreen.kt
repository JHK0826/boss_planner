package com.bossplanner.app.ui

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.Checkbox
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import coil.compose.AsyncImage
import com.bossplanner.app.data.Bosses
import com.bossplanner.app.data.Confirmed
import com.bossplanner.app.data.Party
import com.bossplanner.app.data.PartyMember
import com.bossplanner.app.data.PartyRepository
import com.bossplanner.app.data.Schedule
import com.bossplanner.app.data.TimeSlots
import com.bossplanner.app.data.Unavailable
import com.bossplanner.app.data.Vote
import com.bossplanner.app.data.userMessage
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.launch

/** 아직 못 읽은 것(null)과 읽었는데 없는 것(Loaded(null))을 구분한다. */
private data class Loaded<T>(val value: T)

private sealed interface Confirm {
    data object StartNow : Confirm
    data object Settings : Confirm
    data object Leave : Confirm
    data class Delegate(val member: PartyMember) : Confirm
    data class Lock(val index: Int, val label: String) : Confirm
    data class Record(val cleared: Boolean) : Confirm
    data object RequestChange : Confirm
}

@Composable
fun PartyScreen(
    uid: String,
    partyId: String,
    onEditUnavailable: (UnavailableTarget) -> Unit,
    onOpenSettlement: (periodId: String) -> Unit,
    onBack: () -> Unit,
    parties: PartyRepository = remember { PartyRepository() },
) {
    val partyState by remember(partyId) { parties.party(partyId).map { Loaded(it) } }
        .collectAsStateWithLifecycle(initialValue = null)
    val scheduleState by remember(partyId) { parties.recentSchedules(partyId).map { Loaded(it) } }
        .collectAsStateWithLifecycle(initialValue = null)
    val schedule = scheduleState?.value?.firstOrNull()
    // 다음 주기가 시작된 뒤에도 끝나지 않은 지난 주기 정산
    val pastSettlements = scheduleState?.value.orEmpty().drop(1).filter { it.settlementOpen }
    val unavailable by remember(partyId, schedule?.id) {
        schedule?.let { parties.unavailable(partyId, it.id) } ?: flowOf(emptyMap())
    }.collectAsStateWithLifecycle(emptyMap())
    val votes by remember(partyId, schedule?.id) {
        schedule?.let { parties.votes(partyId, it.id) } ?: flowOf(emptyMap())
    }.collectAsStateWithLifecycle(emptyMap())

    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var confirm by remember { mutableStateOf<Confirm?>(null) }
    // 파티원 캐릭터 이미지 (uid → 주소)
    var memberImages by remember { mutableStateOf<Map<String, String>>(emptyMap()) }
    val memberCharacters = partyState?.value?.members?.values?.map { it.uid to it.characterId }
    LaunchedEffect(memberCharacters) {
        partyState?.value?.let { memberImages = parties.memberImages(it) }
    }
    val scope = rememberCoroutineScope()

    BackHandler(enabled = !busy, onBack = onBack)

    val loadedParty = partyState
    val party = loadedParty?.value
    // 탈퇴했거나 파티가 없어지면 파티 목록으로 돌아간다.
    LaunchedEffect(loadedParty) {
        if (loadedParty != null && loadedParty.value == null) onBack()
    }
    if (party == null) {
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
                error = e.userMessage()
            } finally {
                busy = false
            }
        }
    }

    val isLeader = party.leaderUid == uid
    val inputOpen = schedule?.acceptsInput == true
    // 화면 표시용 시각. 마감·권한 검사는 서버가 서버 시각으로 한다.
    val now by produceState(System.currentTimeMillis()) {
        while (true) {
            delay(30_000)
            value = System.currentTimeMillis()
        }
    }

    Column(
        modifier = Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(24.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        TextButton(onClick = onBack, enabled = !busy) { Text("← 파티 목록") }
        Text(party.name, style = MaterialTheme.typography.headlineSmall)
        Text(
            "${party.bossLabel}\n${if (party.isWeekly) "주간" else "월간"} · ${durationLabel(party.durationMinutes)}",
            style = MaterialTheme.typography.bodyMedium,
        )

        Card(modifier = Modifier.fillMaxWidth()) {
            Column(modifier = Modifier.padding(16.dp)) {
                Text("초대 코드", style = MaterialTheme.typography.labelMedium)
                Text(party.inviteCode, style = MaterialTheme.typography.headlineMedium, fontFamily = FontFamily.Monospace)
                Text(
                    if (party.scheduleStarted) {
                        "가입·탈퇴·위임은 ${if (party.isWeekly) "목요일" else "매월 1일"}에, 일정이 확정되기 전에만 할 수 있습니다."
                    } else {
                        "첫 주기가 시작되기 전까지는 언제든 가입할 수 있습니다."
                    },
                    style = MaterialTheme.typography.bodySmall,
                )
            }
        }

        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(
                "추천 설정 · " + recommendSettingsSummary(party.preferredWindow, party.minLeadMinutes),
                style = MaterialTheme.typography.bodySmall,
                modifier = Modifier.weight(1f),
            )
            if (isLeader) TextButton(enabled = !busy, onClick = { confirm = Confirm.Settings }) { Text("바꾸기") }
        }

        Text("파티원 ${party.memberUids.size}명", style = MaterialTheme.typography.titleMedium)
        party.memberUids.forEach { memberUid ->
            val member = party.members[memberUid] ?: return@forEach
            MemberRow(
                member = member,
                imageUrl = memberImages[memberUid],
                isLeader = memberUid == party.leaderUid,
                isMe = memberUid == uid,
                status = memberStatus(schedule, unavailable[memberUid], votes[memberUid]),
                onDelegate = if (isLeader && memberUid != uid && !busy) ({ confirm = Confirm.Delegate(member) }) else null,
            )
        }

        Text("이번 주기 일정", style = MaterialTheme.typography.titleMedium, modifier = Modifier.padding(top = 8.dp))
        ScheduleSection(
            party = party,
            schedule = schedule,
            loading = scheduleState == null,
            myUnavailable = unavailable[uid],
            submittedCount = party.memberUids.count { unavailable[it]?.submitted == true },
            votes = votes,
            myVote = votes[uid],
            isLeader = isLeader,
            uid = uid,
            now = now,
            busy = busy,
            onVote = { agreed, round -> run { parties.setVote(partyId, schedule!!.id, uid, agreed, round) } },
            onAsk = { confirm = it },
            onRespondToChange = { approve -> run { parties.respondToChange(partyId, schedule!!.id, approve) } },
        )
        // 이번 주기 일정이 아직 없으면 파티장이 바로 열 수 있다.
        val noCurrentSchedule = scheduleState != null && (schedule == null || schedule.periodEndMs <= now)
        if (isLeader && noCurrentSchedule) {
            Button(enabled = !busy, modifier = Modifier.fillMaxWidth(), onClick = { confirm = Confirm.StartNow }) {
                Text("이번 주기 지금 시작")
            }
            Text(
                "파티원을 다 모은 뒤에 눌러 주세요. 시작하면 남은 기간 안에서 바로 일정을 조율합니다.",
                style = MaterialTheme.typography.bodySmall,
            )
        }
        if (inputOpen && schedule != null) {
            OutlinedButton(
                enabled = !busy,
                modifier = Modifier.fillMaxWidth(),
                onClick = {
                    onEditUnavailable(
                        UnavailableTarget(
                            periodId = schedule.id,
                            periodStartMs = schedule.periodStartMs,
                            periodEndMs = schedule.periodEndMs,
                            hasCandidates = schedule.candidates.isNotEmpty(),
                        ),
                    )
                },
            ) {
                Text(if (unavailable[uid]?.submitted == true) "불가 시간 수정" else "불가 시간 입력")
            }
        }

        if (schedule?.state == "SETTLED") {
            Button(enabled = !busy, modifier = Modifier.fillMaxWidth(), onClick = { onOpenSettlement(schedule.id) }) {
                Text(
                    when {
                        schedule.settlement == null -> "분배금 등록·정산 채팅"
                        schedule.settlement.completed -> "정산 완료 · 내역 보기"
                        else -> "분배금 정산 진행 중"
                    },
                )
            }
        }
        pastSettlements.forEach { past ->
            OutlinedButton(enabled = !busy, modifier = Modifier.fillMaxWidth(), onClick = { onOpenSettlement(past.id) }) {
                Text("지난 주기 정산 (${past.confirmed?.let { TimeSlots.dateTime(it.startMs) } ?: past.id})")
            }
        }

        error?.let { Text(it, color = MaterialTheme.colorScheme.error) }

        TextButton(onClick = { confirm = Confirm.Leave }, enabled = !busy) { Text("파티 탈퇴") }
    }

    when (val current = confirm) {
        null -> Unit
        Confirm.StartNow -> AlertDialog(
            onDismissRequest = { confirm = null },
            title = { Text("이번 주기 지금 시작") },
            text = {
                Text(
                    "지금 일정을 열면 파티원 ${party.memberUids.size}명에게 알림이 가고, 오늘 23:59까지 불가 시간을 입력하게 됩니다.\n\n" +
                        "시작한 뒤에는 가입과 탈퇴가 ${if (party.isWeekly) "목요일" else "매월 1일"}로 제한됩니다. 파티원이 다 모였는지 확인해 주세요.",
                )
            },
            confirmButton = {
                TextButton(onClick = {
                    confirm = null
                    run { parties.startSchedule(partyId) }
                }) { Text("시작") }
            },
            dismissButton = { TextButton(onClick = { confirm = null }) { Text("취소") } },
        )
        Confirm.Settings -> {
            var draft by remember { mutableStateOf(RecommendSettings(party.preferredWindow, party.minLeadMinutes)) }
            AlertDialog(
                onDismissRequest = { confirm = null },
                title = { Text("추천 설정") },
                text = {
                    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        RecommendSettingsEditor(draft, enabled = true) { draft = it }
                        if (schedule?.acceptsInput == true && schedule.candidates.isNotEmpty()) {
                            Text(
                                "지금 투표 중입니다. 설정을 바꾸면 추천 시간을 다시 계산하고 투표도 다시 합니다.",
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.error,
                            )
                        }
                    }
                },
                confirmButton = {
                    TextButton(onClick = {
                        confirm = null
                        run { parties.updatePartyPreferences(partyId, draft.preferredWindow, draft.minLeadMinutes) }
                    }) { Text("저장") }
                },
                dismissButton = { TextButton(onClick = { confirm = null }) { Text("취소") } },
            )
        }
        is Confirm.Lock -> AlertDialog(
            onDismissRequest = { confirm = null },
            title = { Text("일정 확정") },
            text = { Text("${current.label}로 확정할까요? 파티원이 속한 다른 파티 일정과 겹치면 확정되지 않습니다.") },
            confirmButton = {
                TextButton(onClick = {
                    confirm = null
                    run { parties.confirmSchedule(partyId, schedule!!.id, current.index) }
                }) { Text("확정") }
            },
            dismissButton = { TextButton(onClick = { confirm = null }) { Text("취소") } },
        )
        is Confirm.Record -> AlertDialog(
            onDismissRequest = { confirm = null },
            title = { Text(if (current.cleared) "클리어 기록" else "미클리어 기록") },
            text = {
                Text(
                    if (current.cleared) "클리어로 기록하면 일정이 완료 처리됩니다. 되돌릴 수 없습니다."
                    else "미클리어로 기록하면 확정 시간이 풀리고 남은 기간 안에서 다시 조율합니다. 되돌릴 수 없습니다.",
                )
            },
            confirmButton = {
                TextButton(onClick = {
                    confirm = null
                    run { parties.recordClear(partyId, schedule!!.id, uid, current.cleared) }
                }) { Text("기록") }
            },
            dismissButton = { TextButton(onClick = { confirm = null }) { Text("취소") } },
        )
        Confirm.RequestChange -> {
            var reason by remember { mutableStateOf("") }
            AlertDialog(
                onDismissRequest = { confirm = null },
                title = { Text("일정 변경 요청") },
                text = {
                    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        Text("파티장이 승인하면 확정이 풀리고 다시 조율합니다. 승인 후 불가 시간을 고쳐 다시 제출해 주세요.")
                        OutlinedTextField(
                            value = reason,
                            onValueChange = { reason = it.take(200) },
                            label = { Text("사유 (선택)") },
                            modifier = Modifier.fillMaxWidth(),
                        )
                    }
                },
                confirmButton = {
                    TextButton(onClick = {
                        confirm = null
                        run { parties.requestChange(partyId, schedule!!.id, reason.trim()) }
                    }) { Text("요청") }
                },
                dismissButton = { TextButton(onClick = { confirm = null }) { Text("취소") } },
            )
        }
        Confirm.Leave -> AlertDialog(
            onDismissRequest = { confirm = null },
            title = { Text("파티 탈퇴") },
            text = {
                Text(
                    if (party.memberUids.size == 1) "마지막 파티원이 나가면 파티가 삭제됩니다. 탈퇴할까요?"
                    else "${party.name}에서 탈퇴할까요?",
                )
            },
            confirmButton = {
                TextButton(onClick = {
                    confirm = null
                    run { parties.leaveParty(partyId) }
                }) { Text("탈퇴") }
            },
            dismissButton = { TextButton(onClick = { confirm = null }) { Text("취소") } },
        )
        is Confirm.Delegate -> AlertDialog(
            onDismissRequest = { confirm = null },
            title = { Text("파티장 위임") },
            text = { Text("${current.member.label()}에게 파티장을 넘길까요?") },
            confirmButton = {
                TextButton(onClick = {
                    confirm = null
                    run { parties.delegateLeader(partyId, current.member.uid) }
                }) { Text("위임") }
            },
            dismissButton = { TextButton(onClick = { confirm = null }) { Text("취소") } },
        )
    }
}

private fun PartyMember.label(): String = displayName.ifBlank { characterName }

/** 파티원 옆에 붙이는 진행 상태 */
private fun memberStatus(schedule: Schedule?, unavailable: Unavailable?, vote: Vote?): String? = when {
    schedule == null || !schedule.acceptsInput -> null
    unavailable?.submitted != true -> "미입력"
    schedule.candidates.isEmpty() -> "제출 완료"
    vote?.round == schedule.round -> "투표 완료"
    else -> "투표 전"
}

@Composable
private fun MemberRow(
    member: PartyMember,
    imageUrl: String?,
    isLeader: Boolean,
    isMe: Boolean,
    status: String?,
    onDelegate: (() -> Unit)?,
) {
    Row(modifier = Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        // 이미지가 없어도 자리를 비워 두어 줄이 가지런하게 한다.
        AsyncImage(model = imageUrl, contentDescription = null, modifier = Modifier.size(56.dp))
        Column(modifier = Modifier.weight(1f).padding(start = 8.dp)) {
            Text(
                member.label() + (if (isMe) " (나)" else "") + (if (isLeader) " · 파티장" else ""),
                style = MaterialTheme.typography.titleSmall,
            )
            Text("${member.characterName} · Lv.${member.level} ${member.job}", style = MaterialTheme.typography.bodySmall)
        }
        if (status != null) {
            Text(
                status,
                style = MaterialTheme.typography.labelMedium,
                color = if (status == "미입력" || status == "투표 전") MaterialTheme.colorScheme.error
                else MaterialTheme.colorScheme.primary,
            )
        }
        if (onDelegate != null) TextButton(onClick = onDelegate) { Text("위임") }
    }
}

@Composable
private fun ScheduleSection(
    party: Party,
    schedule: Schedule?,
    loading: Boolean,
    myUnavailable: Unavailable?,
    submittedCount: Int,
    votes: Map<String, Vote>,
    myVote: Vote?,
    isLeader: Boolean,
    uid: String,
    now: Long,
    busy: Boolean,
    onVote: (agreed: List<Int>, round: Int) -> Unit,
    onAsk: (Confirm) -> Unit,
    onRespondToChange: (approve: Boolean) -> Unit,
) {
    val memberCount = party.memberUids.size
    val confirmed = schedule?.confirmed
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        when {
            loading -> CircularProgressIndicator()
            schedule == null -> Text(
                "아직 시작된 주기가 없습니다. 다음 ${if (party.isWeekly) "목요일" else "달 1일"} 00:00에 첫 일정이 열립니다.",
                style = MaterialTheme.typography.bodyMedium,
            )
            schedule.state == "SKIPPED" -> Text(
                when (schedule.skippedReason) {
                    "NO_AGREEMENT" -> "전원이 동의한 시간이 없어 이번 주기는 진행하지 않습니다."
                    "PERIOD_ENDED" -> "일정을 확정하지 못한 채 주기가 끝났습니다."
                    else -> "전원이 겹치는 시간이 없어 이번 주기는 진행하지 않습니다."
                },
                style = MaterialTheme.typography.bodyMedium,
            )
            schedule.state == "SETTLED" -> Text(
                "클리어 완료" + (confirmed?.let { " · ${TimeSlots.range(it.startMs, it.endMs)}" } ?: ""),
                style = MaterialTheme.typography.titleSmall,
                color = MaterialTheme.colorScheme.primary,
            )
            schedule.state == "EXPIRED" -> Text(
                when (schedule.expiredReason) {
                    "NOT_CLEARED" -> "미클리어로 끝났고 다시 잡을 기간이 남지 않았습니다."
                    "UNVERIFIED" -> "클리어 여부를 확인하지 못한 채 주기가 끝났습니다."
                    else -> "다시 잡을 수 있는 시간이 없어 이번 주기는 종료되었습니다."
                },
                style = MaterialTheme.typography.bodyMedium,
            )
            (schedule.state == "LOCKED" || schedule.state == "VERIFYING") && confirmed != null ->
                LockedSchedule(schedule, confirmed, party, isLeader, uid, now, busy, onAsk, onRespondToChange)
            else -> {
                if (schedule.state == "RETRY") {
                    Text(
                        "미클리어로 재조정 중입니다 (${schedule.retryCount}번째). 이전 불가 시간으로 다시 추천합니다. 필요하면 불가 시간을 고쳐 주세요.",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.error,
                    )
                }
                if (schedule.candidates.isEmpty()) {
                    Text(
                        "불가 시간 제출 $submittedCount/${memberCount}명" +
                            if (schedule.state == "OPEN") " · 마감 ${TimeSlots.dateTime(schedule.inputDeadlineMs - 60_000)}" else "",
                        style = MaterialTheme.typography.bodyMedium,
                    )
                    Text(
                        if (myUnavailable?.submitted == true) "전원이 제출하면 추천 시간이 나옵니다."
                        else "아직 제출하지 않았습니다. 안 되는 시간이 없어도 제출해 주세요.",
                        style = MaterialTheme.typography.bodySmall,
                    )
                } else {
                    CandidateVoting(schedule, memberCount, votes, myVote, isLeader, busy, onVote, onAsk)
                }
            }
        }
    }
}

/** 확정된 일정: 시작 전에는 변경 요청, 시작 후에는 결과 기록 */
@Composable
private fun LockedSchedule(
    schedule: Schedule,
    confirmed: Confirmed,
    party: Party,
    isLeader: Boolean,
    uid: String,
    now: Long,
    busy: Boolean,
    onAsk: (Confirm) -> Unit,
    onRespondToChange: (approve: Boolean) -> Unit,
) {
    Card(modifier = Modifier.fillMaxWidth()) {
        Column(modifier = Modifier.padding(16.dp)) {
            Text("확정된 시간", style = MaterialTheme.typography.labelMedium)
            Text(TimeSlots.range(confirmed.startMs, confirmed.endMs), style = MaterialTheme.typography.titleLarge)
        }
    }

    if (now >= confirmed.startMs) {
        Text(
            if (now >= confirmed.endMs) "레이드가 끝났나요? 결과를 기록해 주세요." else "레이드 진행 중입니다. 끝나면 결과를 기록해 주세요.",
            style = MaterialTheme.typography.bodyMedium,
        )
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Button(enabled = !busy, modifier = Modifier.weight(1f), onClick = { onAsk(Confirm.Record(cleared = true)) }) {
                Text("클리어")
            }
            OutlinedButton(enabled = !busy, modifier = Modifier.weight(1f), onClick = { onAsk(Confirm.Record(cleared = false)) }) {
                Text("미클리어")
            }
        }
        Text("기록하지 않으면 다음 날 05:00에 자동으로 확인합니다.", style = MaterialTheme.typography.bodySmall)
        return
    }

    val request = schedule.changeRequest
    if (request != null && request.isPending) {
        val requester = party.members[request.requestedBy]?.label() ?: "파티원"
        Text(
            "$requester 님이 일정 변경을 요청했습니다." + if (request.reason.isNotBlank()) "\n사유: ${request.reason}" else "",
            style = MaterialTheme.typography.bodyMedium,
        )
        if (isLeader) {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Button(enabled = !busy, modifier = Modifier.weight(1f), onClick = { onRespondToChange(true) }) { Text("승인") }
                OutlinedButton(enabled = !busy, modifier = Modifier.weight(1f), onClick = { onRespondToChange(false) }) {
                    Text("거절")
                }
            }
        } else {
            Text("파티장의 승인을 기다립니다.", style = MaterialTheme.typography.bodySmall)
        }
        return
    }

    if (request?.status == "REJECTED" && request.requestedBy == uid) {
        Text("변경 요청이 거절되었습니다.", style = MaterialTheme.typography.bodySmall)
    }
    // 변경 요청은 레이드 전날 23:59까지
    val deadline = TimeSlots.startOfDay(confirmed.startMs)
    if (now < deadline) {
        OutlinedButton(enabled = !busy, modifier = Modifier.fillMaxWidth(), onClick = { onAsk(Confirm.RequestChange) }) {
            Text("일정 변경 요청")
        }
        Text("변경 요청 마감: ${TimeSlots.dateTime(deadline - 60_000)}", style = MaterialTheme.typography.bodySmall)
    } else {
        Text("변경 요청 기간(레이드 전날 23:59까지)이 지났습니다.", style = MaterialTheme.typography.bodySmall)
    }
}

@Composable
private fun CandidateVoting(
    schedule: Schedule,
    memberCount: Int,
    votes: Map<String, Vote>,
    myVote: Vote?,
    isLeader: Boolean,
    busy: Boolean,
    onVote: (agreed: List<Int>, round: Int) -> Unit,
    onAsk: (Confirm) -> Unit,
) {
    val savedVote = myVote?.takeIf { it.round == schedule.round }
    // 후보가 바뀌면(round) 선택을 처음부터 다시 한다.
    var selected by remember(schedule.round, savedVote) { mutableStateOf(savedVote?.agreed.orEmpty().toSet()) }
    val currentVotes = votes.values.filter { it.round == schedule.round }

    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Text(
            "가능한 시간에 모두 동의해 주세요. 전원이 동의한 시간 중에서 파티장이 확정합니다.",
            style = MaterialTheme.typography.bodySmall,
        )
        schedule.candidates.forEachIndexed { index, candidate ->
            val checked = index in selected
            val unanimous = index in schedule.unanimous
            val label = TimeSlots.range(candidate.startMs, candidate.endMs)
            // 후보는 시간순이다. 날짜가 바뀔 때마다 요일을 한 번 적어 요일별로 묶어 보이게 한다.
            val day = TimeSlots.dayWithWeekday(candidate.startMs)
            if (index == 0 || TimeSlots.dayWithWeekday(schedule.candidates[index - 1].startMs) != day) {
                Text(
                    day,
                    style = MaterialTheme.typography.labelLarge,
                    color = MaterialTheme.colorScheme.primary,
                    modifier = Modifier.padding(top = 6.dp),
                )
            }
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .clickable(enabled = !busy) { selected = if (checked) selected - index else selected + index }
                    .padding(vertical = 6.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Checkbox(checked = checked, onCheckedChange = null)
                Column(modifier = Modifier.weight(1f).padding(start = 12.dp)) {
                    Text(
                        "${TimeSlots.time(candidate.startMs)} ~ ${TimeSlots.time(candidate.endMs)}",
                        style = MaterialTheme.typography.titleSmall,
                    )
                    Text(
                        if (unanimous) "전원 동의" else "동의 ${currentVotes.count { index in it.agreed }}/${memberCount}명",
                        style = MaterialTheme.typography.bodySmall,
                        color = if (unanimous) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                if (unanimous && isLeader) {
                    Button(enabled = !busy, onClick = { onAsk(Confirm.Lock(index, label)) }) { Text("확정") }
                }
            }
        }
        OutlinedButton(
            enabled = !busy && (savedVote == null || savedVote.agreed.toSet() != selected),
            modifier = Modifier.fillMaxWidth(),
            onClick = { onVote(selected.toList(), schedule.round) },
        ) {
            Text(
                when {
                    savedVote == null && selected.isEmpty() -> "모두 안 됨으로 투표"
                    savedVote == null -> "투표하기"
                    else -> "투표 바꾸기"
                },
            )
        }
        Text(
            when {
                schedule.unanimous.isNotEmpty() && isLeader -> "전원이 동의한 시간 중 하나를 확정해 주세요."
                schedule.unanimous.isNotEmpty() -> "전원이 동의한 시간이 있습니다. 파티장의 확정을 기다립니다."
                currentVotes.size < memberCount -> "투표 ${currentVotes.size}/${memberCount}명. 전원이 투표했는데 전원 동의가 없으면 다음 후보로 넘어갑니다."
                else -> ""
            },
            style = MaterialTheme.typography.bodySmall,
        )
    }
}
