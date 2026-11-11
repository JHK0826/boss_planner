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
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.Checkbox
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
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
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.bossplanner.app.data.Bosses
import com.bossplanner.app.data.Party
import com.bossplanner.app.data.PartyMember
import com.bossplanner.app.data.PartyRepository
import com.bossplanner.app.data.Schedule
import com.bossplanner.app.data.TimeSlots
import com.bossplanner.app.data.Unavailable
import com.bossplanner.app.data.Vote
import com.bossplanner.app.data.userMessage
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.launch

/** 아직 못 읽은 것(null)과 읽었는데 없는 것(Loaded(null))을 구분한다. */
private data class Loaded<T>(val value: T)

private sealed interface Confirm {
    data object Leave : Confirm
    data class Delegate(val member: PartyMember) : Confirm
}

@Composable
fun PartyScreen(
    uid: String,
    partyId: String,
    onEditUnavailable: (UnavailableTarget) -> Unit,
    onBack: () -> Unit,
    parties: PartyRepository = remember { PartyRepository() },
) {
    val partyState by remember(partyId) { parties.party(partyId).map { Loaded(it) } }
        .collectAsStateWithLifecycle(initialValue = null)
    val scheduleState by remember(partyId) { parties.latestSchedule(partyId).map { Loaded(it) } }
        .collectAsStateWithLifecycle(initialValue = null)
    val schedule = scheduleState?.value
    val unavailable by remember(partyId, schedule?.id) {
        schedule?.let { parties.unavailable(partyId, it.id) } ?: flowOf(emptyMap())
    }.collectAsStateWithLifecycle(emptyMap())
    val votes by remember(partyId, schedule?.id) {
        schedule?.let { parties.votes(partyId, it.id) } ?: flowOf(emptyMap())
    }.collectAsStateWithLifecycle(emptyMap())

    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var confirm by remember { mutableStateOf<Confirm?>(null) }
    val scope = rememberCoroutineScope()

    BackHandler(enabled = !busy, onBack = onBack)

    val loadedParty = partyState
    val party = loadedParty?.value
    // 탈퇴했거나 파티가 없어지면 홈으로 돌아간다.
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
    val inputOpen = schedule?.state == "OPEN"

    Column(
        modifier = Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(24.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        TextButton(onClick = onBack, enabled = !busy) { Text("← 홈") }
        Text(party.name, style = MaterialTheme.typography.headlineSmall)
        Text(
            "${party.bossName} · ${Bosses.difficultyLabel(party.difficulty)} · ${if (party.isWeekly) "주간" else "월간"} · " +
                durationLabel(party.durationSlots * 30),
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

        Text("파티원 ${party.memberUids.size}명", style = MaterialTheme.typography.titleMedium)
        party.memberUids.forEach { memberUid ->
            val member = party.members[memberUid] ?: return@forEach
            MemberRow(
                member = member,
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
            busy = busy,
            onVote = { agreed, round -> run { parties.setVote(partyId, schedule!!.id, uid, agreed, round) } },
        )
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

        error?.let { Text(it, color = MaterialTheme.colorScheme.error) }

        TextButton(onClick = { confirm = Confirm.Leave }, enabled = !busy) { Text("파티 탈퇴") }
    }

    when (val current = confirm) {
        null -> Unit
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
    schedule == null || schedule.state != "OPEN" -> null
    unavailable?.submitted != true -> "미입력"
    schedule.candidates.isEmpty() -> "제출 완료"
    vote?.round == schedule.round -> "투표 완료"
    else -> "투표 전"
}

@Composable
private fun MemberRow(member: PartyMember, isLeader: Boolean, isMe: Boolean, status: String?, onDelegate: (() -> Unit)?) {
    Row(modifier = Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        Column(modifier = Modifier.weight(1f)) {
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
    busy: Boolean,
    onVote: (agreed: List<Int>, round: Int) -> Unit,
) {
    val memberCount = party.memberUids.size
    when {
        loading -> CircularProgressIndicator()
        schedule == null -> Text(
            "아직 시작된 주기가 없습니다. 다음 ${if (party.isWeekly) "목요일" else "달 1일"} 00:00에 첫 일정이 열립니다.",
            style = MaterialTheme.typography.bodyMedium,
        )
        schedule.state == "SKIPPED" -> Text(
            if (schedule.skippedReason == "NO_AGREEMENT") {
                "전원이 동의한 시간이 없어 이번 주기는 진행하지 않습니다."
            } else {
                "전원이 겹치는 시간이 없어 이번 주기는 진행하지 않습니다."
            },
            style = MaterialTheme.typography.bodyMedium,
        )
        schedule.state != "OPEN" -> Text("일정이 확정되었습니다.", style = MaterialTheme.typography.bodyMedium)
        schedule.candidates.isEmpty() -> Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Text(
                "불가 시간 제출 $submittedCount/${memberCount}명 · 마감 ${TimeSlots.dateTime(schedule.inputDeadlineMs - 60_000)}",
                style = MaterialTheme.typography.bodyMedium,
            )
            Text(
                if (myUnavailable?.submitted == true) "전원이 제출하면 추천 시간이 나옵니다."
                else "아직 제출하지 않았습니다. 안 되는 시간이 없어도 제출해 주세요.",
                style = MaterialTheme.typography.bodySmall,
            )
        }
        else -> CandidateVoting(schedule, memberCount, votes, myVote, busy, onVote)
    }
}

@Composable
private fun CandidateVoting(
    schedule: Schedule,
    memberCount: Int,
    votes: Map<String, Vote>,
    myVote: Vote?,
    busy: Boolean,
    onVote: (agreed: List<Int>, round: Int) -> Unit,
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
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .clickable(enabled = !busy) { selected = if (checked) selected - index else selected + index }
                    .padding(vertical = 6.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Checkbox(checked = checked, onCheckedChange = null)
                Column(modifier = Modifier.padding(start = 12.dp)) {
                    Text(TimeSlots.range(candidate.startMs, candidate.endMs), style = MaterialTheme.typography.titleSmall)
                    Text(
                        if (index in schedule.unanimous) "전원 동의"
                        else "동의 ${currentVotes.count { index in it.agreed }}/${memberCount}명",
                        style = MaterialTheme.typography.bodySmall,
                        color = if (index in schedule.unanimous) MaterialTheme.colorScheme.primary
                        else MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
        }
        Button(
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
                schedule.unanimous.isNotEmpty() -> "전원이 동의한 시간이 있습니다. 파티장의 확정을 기다립니다."
                currentVotes.size < memberCount -> "투표 ${currentVotes.size}/${memberCount}명. 전원이 투표했는데 전원 동의가 없으면 다음 후보로 넘어갑니다."
                else -> ""
            },
            style = MaterialTheme.typography.bodySmall,
        )
    }
}
