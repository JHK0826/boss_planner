package com.bossplanner.app.ui

import android.content.Context
import android.content.Intent
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Person
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material.icons.filled.ShoppingCart
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Badge
import androidx.compose.material3.BadgedBox
import androidx.compose.material3.FilterChip
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.RadioButton
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
import androidx.compose.runtime.key
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.DialogProperties
import androidx.compose.ui.window.Dialog
import androidx.compose.material3.Surface
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import coil.compose.AsyncImage
import com.bossplanner.app.data.Bosses
import com.bossplanner.app.data.Candidate
import com.bossplanner.app.data.Confirmed
import com.bossplanner.app.data.MAX_PARTY_SIZE
import com.bossplanner.app.data.Mercenary
import com.bossplanner.app.data.mercenaryLabel
import com.bossplanner.app.data.participantUids
import com.bossplanner.app.data.Party
import com.bossplanner.app.data.PartyMember
import com.bossplanner.app.data.PartyRepository
import com.bossplanner.app.data.PartySnapshot
import com.bossplanner.app.data.PartyStatuses
import com.bossplanner.app.data.TabTodos
import com.bossplanner.app.data.currentPeriod
import com.bossplanner.app.data.Schedule
import com.bossplanner.app.data.TimeSlots
import com.bossplanner.app.data.Unavailable
import com.bossplanner.app.data.Vote
import com.bossplanner.app.data.userMessage
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.launch

/** 아직 못 읽은 것(null)과 읽었는데 없는 것(Loaded(null))을 구분한다. */
private data class Loaded<T>(val value: T)

private sealed interface Confirm {
    data object StartNow : Confirm
    data object Leave : Confirm
    data class Delegate(val member: PartyMember) : Confirm
    data class Lock(val index: Int, val label: String) : Confirm
    data class Record(val cleared: Boolean) : Confirm
    data object RequestChange : Confirm
    data class SwitchCandidate(val index: Int, val label: String) : Confirm
    data object MercenaryReplace : Confirm
    data object MercenaryAdd : Confirm
    data class MercenaryRemove(val mercenary: Mercenary) : Confirm
}

/** 미리 연 다음 주 일정이면 "다음 주", 아니면 "이번 주기" */
private fun periodWord(schedule: Schedule?): String =
    if (schedule != null && schedule.periodStartMs > System.currentTimeMillis()) "다음 주" else "이번 주기"

/** 파티 화면 하단 탭 */
enum class PartyTab(val label: String, val icon: ImageVector) {
    Info("파티", Icons.Filled.Person),
    Schedule("투표", Icons.Filled.CheckCircle),
    Settlement("정산", Icons.Filled.ShoppingCart),
    Settings("설정", Icons.Filled.Settings),
}

/**
 * 파티 화면: 하단 탭 4개(파티 / 투표 / 정산 / 설정).
 * 파티·최근 일정·불가 시간·투표는 여기서 한 번 구독해 탭에 넘긴다. 정산 채팅·분배금은 정산 탭을 열었을 때만 구독한다.
 *
 * @param initialTab 처음 보여 줄 탭. null이면 할 일이 있는 탭(투표 → 정산)을, 없으면 파티 탭을 연다.
 */
@Composable
fun PartyScreen(
    uid: String,
    partyId: String,
    initialTab: PartyTab?,
    onEditUnavailable: (UnavailableTarget) -> Unit,
    onBack: () -> Unit,
    parties: PartyRepository = remember { PartyRepository() },
) {
    val partyState by remember(partyId) { parties.party(partyId).map { Loaded(it) } }
        .collectAsStateWithLifecycle(initialValue = null)
    val scheduleState by remember(partyId) { parties.recentSchedules(partyId).map { Loaded(it) } }
        .collectAsStateWithLifecycle(initialValue = null)
    val schedules = scheduleState?.value
    val schedule = schedules?.firstOrNull()
    val unavailableState by remember(partyId, schedule?.id) {
        (schedule?.let { parties.unavailable(partyId, it.id) } ?: flowOf(emptyMap())).map { Loaded(it) }
    }.collectAsStateWithLifecycle(null)
    val votesState by remember(partyId, schedule?.id) {
        (schedule?.let { parties.votes(partyId, it.id) } ?: flowOf(emptyMap())).map { Loaded(it) }
    }.collectAsStateWithLifecycle(null)
    // 탭 배지용: 정산이 진행 중인 주기의 분배금 상태만 지켜본다.
    val settlementIds = schedules.orEmpty().filter { it.settlementOpen && it.settlement != null }.map { it.id }
    val settlementsState by remember(partyId, settlementIds) {
        val flow = if (settlementIds.isEmpty()) {
            flowOf(emptyMap())
        } else {
            combine(settlementIds.map { id -> parties.settlementEntries(partyId, id).map { id to it } }) { it.toMap() }
        }
        flow.map { Loaded(it) }
    }.collectAsStateWithLifecycle(null)
    val unavailable = unavailableState?.value.orEmpty()
    val votes = votesState?.value.orEmpty()

    var busy by remember { mutableStateOf(false) }
    val showMessage = LocalShowMessage.current
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
    // 화면 표시용 시각. 마감·권한 검사는 서버가 서버 시각으로 한다.
    val now by produceState(System.currentTimeMillis()) {
        while (true) {
            delay(30_000)
            value = System.currentTimeMillis()
        }
    }

    // 탭 배지: 파티 목록과 같은 할 일 계산을 쓰고, 정산 할 일과 나머지를 나눈다. 다 읽기 전에는 계산하지 않는다.
    val loaded = schedules != null && unavailableState != null && votesState != null && settlementsState != null
    val todos = if (party != null && loaded) {
        TabTodos.of(PartyStatuses.of(uid, party, PartySnapshot(schedules!!, unavailable, votes, settlementsState!!.value), now))
    } else {
        null
    }
    var tab by rememberSaveable(partyId) { mutableStateOf(initialTab) }
    LaunchedEffect(todos) {
        if (tab == null && todos != null) {
            tab = when {
                todos.schedule -> PartyTab.Schedule
                todos.settlement -> PartyTab.Settlement
                else -> PartyTab.Info
            }
        }
    }

    if (party == null) {
        Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
        return
    }

    /** 서버에 보내고 결과를 화면 아래 알림으로 보여 준다. */
    fun run(success: String?, action: suspend () -> Unit) =
        scope.runAction(showMessage, { busy = it }, success, { it.userMessage() }, action)

    Column(modifier = Modifier.fillMaxSize()) {
        Column(modifier = Modifier.padding(start = 24.dp, end = 24.dp, top = 8.dp)) {
            TextButton(onClick = onBack, enabled = !busy) { Text("← 파티 목록") }
            Text(party.name, style = MaterialTheme.typography.headlineSmall)
        }
        Box(modifier = Modifier.weight(1f).fillMaxWidth()) {
            when (tab) {
                null -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
                PartyTab.Info -> PartyInfoTab(uid, party, schedule, unavailable, votes, memberImages, now, busy, onAsk = { confirm = it })
                PartyTab.Schedule -> ScheduleTab(
                    party = party,
                    schedule = schedule,
                    thisWeek = schedules.orEmpty().currentPeriod(now),
                    loading = scheduleState == null,
                    unavailable = unavailable,
                    votes = votes,
                    uid = uid,
                    now = now,
                    busy = busy,
                    onVote = { agreed, round ->
                        run(if (agreed.isEmpty()) "모두 안 됨으로 투표했습니다" else "투표했습니다") {
                            parties.setVote(partyId, schedule!!.id, uid, agreed, round)
                        }
                    },
                    onAsk = { confirm = it },
                    onRespondToChange = { approve ->
                        run(if (approve) "변경 요청을 승인했습니다. 다시 조율합니다" else "변경 요청을 거절했습니다") {
                            parties.respondToChange(partyId, schedule!!.id, approve)
                        }
                    },
                    onEditUnavailable = onEditUnavailable,
                )
                PartyTab.Settlement -> SettlementTab(uid, party, schedules.orEmpty(), loading = scheduleState == null, parties = parties)
                PartyTab.Settings -> PartySettingsTab(
                    uid = uid,
                    party = party,
                    schedule = schedule,
                    busy = busy,
                    onSave = { settings ->
                        run("추천 설정을 저장했습니다") {
                            parties.updatePartyPreferences(partyId, settings.preferredWindow, settings.minLeadMinutes, settings.autoAssign)
                        }
                    },
                    onAsk = { confirm = it },
                )
            }
        }
        // 화면 가장자리 여백은 MainActivity가 이미 주고 있어서 여기서는 더하지 않는다.
        NavigationBar(windowInsets = WindowInsets(0, 0, 0, 0)) {
            PartyTab.entries.forEach { item ->
                val dot = when (item) {
                    PartyTab.Schedule -> todos?.schedule == true
                    PartyTab.Settlement -> todos?.settlement == true
                    else -> false
                }
                NavigationBarItem(
                    selected = item == tab,
                    onClick = { tab = item },
                    icon = {
                        // 내가 할 일이 있는 탭에는 점을 붙인다.
                        if (dot) {
                            BadgedBox(badge = { Badge() }) { Icon(item.icon, contentDescription = null) }
                        } else {
                            Icon(item.icon, contentDescription = null)
                        }
                    },
                    label = { Text(item.label) },
                )
            }
        }
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
                    run("이번 주기 일정을 시작했습니다") { parties.startSchedule(partyId) }
                }) { Text("시작") }
            },
            dismissButton = { TextButton(onClick = { confirm = null }) { Text("취소") } },
        )
        is Confirm.Lock -> AlertDialog(
            onDismissRequest = { confirm = null },
            title = { Text("일정 확정") },
            text = { Text("${current.label}로 확정할까요? 파티원이 속한 다른 파티 일정과 겹치면 확정되지 않습니다.") },
            confirmButton = {
                TextButton(onClick = {
                    confirm = null
                    run("일정을 확정했습니다") { parties.confirmSchedule(partyId, schedule!!.id, current.index) }
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
                    run(if (current.cleared) "클리어로 기록했습니다" else "미클리어로 기록했습니다. 남은 기간에서 다시 조율합니다") {
                        parties.recordClear(partyId, schedule!!.id, uid, current.cleared)
                    }
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
                        run("변경을 요청했습니다. 파티장의 승인을 기다립니다") { parties.requestChange(partyId, schedule!!.id, reason.trim()) }
                    }) { Text("요청") }
                },
                dismissButton = { TextButton(onClick = { confirm = null }) { Text("취소") } },
            )
        }
        Confirm.MercenaryReplace -> {
            var name by remember { mutableStateOf("") }
            val word = periodWord(schedule)
            AlertDialog(
                onDismissRequest = { confirm = null },
                title = { Text("$word 용병으로 대체") },
                text = {
                    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        Text(
                            if (schedule?.state == "LOCKED") {
                                "확정된 시간은 그대로 두고, 나는 이 레이드에서 빠집니다. 내 일정도 풀립니다. 확정된 뒤에는 대체를 취소할 수 없습니다."
                            } else {
                                "나는 이번 주기 불가 시간 입력과 투표에서 빠지고, 나머지 파티원으로 추천을 다시 계산합니다. 확정 전에는 취소할 수 있습니다."
                            },
                        )
                        Text("용병은 분배금 1인분을 받고, 판매자가 직접 지급합니다.", style = MaterialTheme.typography.bodySmall)
                        OutlinedTextField(
                            value = name,
                            onValueChange = { name = it.take(12) },
                            label = { Text("용병 이름 (선택)") },
                            singleLine = true,
                            modifier = Modifier.fillMaxWidth(),
                        )
                    }
                },
                confirmButton = {
                    TextButton(onClick = {
                        confirm = null
                        run("${word}를 용병으로 대체했습니다") { parties.replaceWithMercenary(partyId, schedule!!.id, name.trim()) }
                    }) { Text("대체") }
                },
                dismissButton = { TextButton(onClick = { confirm = null }) { Text("취소") } },
            )
        }
        Confirm.MercenaryAdd -> {
            var name by remember { mutableStateOf("") }
            AlertDialog(
                onDismissRequest = { confirm = null },
                title = { Text("임시 용병 추가") },
                text = {
                    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        Text(
                            "${periodWord(schedule)}에만 인원이 한 명 늘어납니다. 용병은 시간 제약이 없어 추천에는 영향이 없고, 결정석은 늘어난 인원수로 나눕니다.",
                        )
                        Text("용병은 분배금 1인분을 받고, 판매자가 직접 지급합니다.", style = MaterialTheme.typography.bodySmall)
                        OutlinedTextField(
                            value = name,
                            onValueChange = { name = it.take(12) },
                            label = { Text("용병 이름 (선택)") },
                            singleLine = true,
                            modifier = Modifier.fillMaxWidth(),
                        )
                    }
                },
                confirmButton = {
                    TextButton(onClick = {
                        confirm = null
                        run("임시 용병을 추가했습니다") { parties.addMercenary(partyId, schedule!!.id, name.trim()) }
                    }) { Text("추가") }
                },
                dismissButton = { TextButton(onClick = { confirm = null }) { Text("취소") } },
            )
        }
        is Confirm.MercenaryRemove -> {
            val replacement = current.mercenary.replaces != null
            AlertDialog(
                onDismissRequest = { confirm = null },
                title = { Text(if (replacement) "용병 대체 취소" else "임시 용병 빼기") },
                text = {
                    Text(
                        if (replacement) "다시 이번 주기에 참여합니다. 불가 시간을 낸 적이 없다면 입력해야 추천이 나옵니다."
                        else "${party.mercenaryLabel(current.mercenary)}을(를) 뺄까요?",
                    )
                },
                confirmButton = {
                    TextButton(onClick = {
                        confirm = null
                        run(if (replacement) "대체를 취소했습니다. 불가 시간을 확인해 주세요" else "임시 용병을 뺐습니다") {
                            parties.removeMercenary(partyId, schedule!!.id, current.mercenary.id)
                        }
                    }) { Text(if (replacement) "대체 취소" else "빼기") }
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
                    run("${party.name}에서 탈퇴했습니다") { parties.leaveParty(partyId) }
                }) { Text("탈퇴") }
            },
            dismissButton = { TextButton(onClick = { confirm = null }) { Text("취소") } },
        )
        is Confirm.SwitchCandidate -> AlertDialog(
            onDismissRequest = { confirm = null },
            title = { Text("다른 순위로 바꾸기") },
            text = { Text("${current.label}로 바꿀까요? 파티원에게 알림이 갑니다. 파티원이 속한 다른 파티 일정과 겹치면 바뀌지 않습니다.") },
            confirmButton = {
                TextButton(onClick = {
                    confirm = null
                    run("일정을 바꿨습니다") { parties.switchAssignedCandidate(partyId, schedule!!.id, current.index) }
                }) { Text("바꾸기") }
            },
            dismissButton = { TextButton(onClick = { confirm = null }) { Text("취소") } },
        )
        is Confirm.Delegate -> AlertDialog(
            onDismissRequest = { confirm = null },
            title = { Text("파티장 위임") },
            text = { Text("${current.member.label()}에게 파티장을 넘길까요? 넘긴 뒤에는 새 파티장만 되돌릴 수 있습니다.") },
            confirmButton = {
                TextButton(onClick = {
                    confirm = null
                    run("${current.member.label()}님에게 파티장을 넘겼습니다") { parties.delegateLeader(partyId, current.member.uid) }
                }) { Text("위임") }
            },
            dismissButton = { TextButton(onClick = { confirm = null }) { Text("취소") } },
        )
    }
}

/** 탭 안의 내용: 세로로 넘기고 가장자리 여백을 준다. */
@Composable
private fun TabColumn(content: @Composable ColumnScope.() -> Unit) {
    Column(
        modifier = Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = 24.dp, vertical = 12.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
        content = content,
    )
}

/** 파티 탭: 파티 정보, 초대 코드, 파티원 */
@Composable
private fun PartyInfoTab(
    uid: String,
    party: Party,
    schedule: Schedule?,
    unavailable: Map<String, Unavailable>,
    votes: Map<String, Vote>,
    memberImages: Map<String, String>,
    now: Long,
    busy: Boolean,
    onAsk: (Confirm) -> Unit,
) {
    val context = LocalContext.current
    val clipboard = LocalClipboardManager.current
    // 끝나지 않은 주기의 일정만 용병을 보여 준다(미리 연 다음 주면 다음 주).
    val live = schedule?.takeIf { it.periodEndMs > now }
    val mercenaries = live?.mercenaries.orEmpty()
    val showMessage = LocalShowMessage.current
    // 시간표를 보고 있는 파티원
    var viewingMember by remember { mutableStateOf<PartyMember?>(null) }

    TabColumn {
        Text(
            "${party.bossLabel}\n${if (party.isWeekly) "주간" else "월간"} · ${durationLabel(party.durationMinutes)}",
            style = MaterialTheme.typography.bodyMedium,
        )

        Card(modifier = Modifier.fillMaxWidth()) {
            Column(modifier = Modifier.padding(16.dp)) {
                Text("초대 코드", style = MaterialTheme.typography.labelMedium)
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(
                        party.inviteCode,
                        style = MaterialTheme.typography.headlineMedium,
                        fontFamily = FontFamily.Monospace,
                        modifier = Modifier.weight(1f),
                    )
                    TextButton(onClick = {
                        clipboard.setText(AnnotatedString(party.inviteCode))
                        showMessage.show("초대 코드를 복사했습니다")
                    }) { Text("복사") }
                    TextButton(onClick = { shareInvite(context, party) }) { Text("공유") }
                }
                Text(
                    if (party.scheduleStarted) {
                        "가입·탈퇴·위임은 ${if (party.isWeekly) "목요일" else "매월 1일"}에, 일정이 확정되기 전에만 할 수 있습니다."
                    } else {
                        "첫 일정을 시작하기 전까지는 언제든 가입할 수 있습니다."
                    },
                    style = MaterialTheme.typography.bodySmall,
                )
            }
        }

        Text(
            "파티원 ${party.memberUids.size}명" + if (mercenaries.isNotEmpty()) " · 용병 ${mercenaries.size}명" else "",
            style = MaterialTheme.typography.titleMedium,
        )
        party.memberUids.forEach { memberUid ->
            val member = party.members[memberUid] ?: return@forEach
            MemberRow(
                member = member,
                imageUrl = memberImages[memberUid],
                isLeader = memberUid == party.leaderUid,
                isMe = memberUid == uid,
                status = if (live?.isReplaced(memberUid) == true) "${periodWord(live)} 용병으로 대체"
                else memberStatus(schedule, unavailable[memberUid], votes[memberUid]),
                onViewTimetable = { viewingMember = member },
            )
        }
        mercenaries.forEach { merc ->
            MercenaryRow(
                label = party.mercenaryLabel(merc),
                period = periodWord(live),
                onRemove = if (merc.replaces == null && party.leaderUid == uid && live?.canEditMercenaries(now) == true) {
                    { onAsk(Confirm.MercenaryRemove(merc)) }
                } else {
                    null
                },
                busy = busy,
            )
        }
        if (live != null && live.canEditMercenaries(now)) MercenaryCard(uid, party, live, busy, onAsk)
    }

    viewingMember?.let { member ->
        MemberTimetableDialog(
            member = member,
            // 끝난 주기의 일정은 "이번 주기"로 보지 않는다.
            schedule = schedule?.takeIf { it.periodEndMs > now },
            entry = unavailable[member.uid],
            now = now,
            onDismiss = { viewingMember = null },
        )
    }
}

/** 투표 탭: 이번 주기 일정 (불가 시간 입력, 추천·투표, 확정, 변경 요청, 결과 기록) */
@Composable
private fun ScheduleTab(
    party: Party,
    schedule: Schedule?,
    /** 지금 진행 중인 주기의 일정. 다음 주를 미리 열었으면 이번 주 결과를 한 줄로 보여 준다 */
    thisWeek: Schedule?,
    loading: Boolean,
    unavailable: Map<String, Unavailable>,
    votes: Map<String, Vote>,
    uid: String,
    now: Long,
    busy: Boolean,
    onVote: (agreed: List<Int>, round: Int) -> Unit,
    onAsk: (Confirm) -> Unit,
    onRespondToChange: (approve: Boolean) -> Unit,
    onEditUnavailable: (UnavailableTarget) -> Unit,
) {
    val isLeader = party.leaderUid == uid
    // 이번 주 레이드가 끝나 미리 연 다음 주 일정 (확정은 목요일부터)
    val upcoming = schedule?.isUpcoming(now) == true
    TabColumn {
        if (upcoming && schedule != null) {
            thisWeek?.let { week ->
                thisWeekResult(week).takeIf { it.isNotEmpty() }?.let {
                    Text(it, style = MaterialTheme.typography.titleSmall, color = MaterialTheme.colorScheme.primary)
                }
            }
            Text(
                "다음 주 일정 (${TimeSlots.dayWithWeekday(schedule.periodStartMs)} ~ ${TimeSlots.dayWithWeekday(schedule.periodEndMs - 1)}) 미리 조율",
                style = MaterialTheme.typography.titleMedium,
            )
            Text(
                if (party.autoAssign) {
                    "이번 주 레이드가 끝나 다음 주 일정을 미리 조율합니다. 불가 시간을 먼저 내 두면 목요일 00:00에 투표 없이 점수 1위 시간으로 확정합니다."
                } else {
                    "이번 주 레이드가 끝나 다음 주 일정을 미리 조율합니다. 불가 시간 입력과 투표를 먼저 하고, 확정은 목요일 00:00부터 할 수 있습니다."
                },
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        } else {
            Text("이번 주기 일정", style = MaterialTheme.typography.titleMedium)
        }
        ScheduleSection(
            party = party,
            schedule = schedule,
            early = upcoming,
            loading = loading,
            myUnavailable = unavailable[uid],
            submittedCount = party.participantUids(schedule).count { unavailable[it]?.submitted == true },
            votes = votes,
            myVote = votes[uid],
            isLeader = isLeader,
            uid = uid,
            now = now,
            busy = busy,
            onVote = onVote,
            onAsk = onAsk,
            onRespondToChange = onRespondToChange,
        )
        // 이번 주기 일정이 아직 없으면 파티장이 바로 열 수 있다.
        val noCurrentSchedule = !loading && (schedule == null || schedule.periodEndMs <= now)
        if (isLeader && noCurrentSchedule) {
            Button(enabled = !busy, modifier = Modifier.fillMaxWidth(), onClick = { onAsk(Confirm.StartNow) }) {
                Text("이번 주기 지금 시작")
            }
            Text(
                "파티원을 다 모은 뒤에 눌러 주세요. 시작하면 남은 기간 안에서 바로 일정을 조율합니다.",
                style = MaterialTheme.typography.bodySmall,
            )
        }
        // 이번 주기를 용병으로 대체했으면 입력하지 않는다.
        if (schedule != null && schedule.acceptsInput && !schedule.isReplaced(uid)) {
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
                Text((if (upcoming) "다음 주 " else "") + if (unavailable[uid]?.submitted == true) "불가 시간 수정" else "불가 시간 입력")
            }
            if (unavailable[uid]?.carried == true) {
                Text(
                    "다른 파티에 낸 ${if (upcoming) "다음 주 " else ""}불가 시간으로 자동 제출했습니다. 이 파티만 다르면 고쳐 주세요.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
    }
}

/** 정산 탭: 정산할 주기가 여러 개면(이번 주기 + 끝나지 않은 지난 주기) 위에서 고른다. */
@Composable
private fun SettlementTab(uid: String, party: Party, schedules: List<Schedule>, loading: Boolean, parties: PartyRepository) {
    // 최근 주기 중 클리어한 주기 전부. 정산이 끝난 주기도 내역을 다시 볼 수 있게 남긴다.
    val periods = schedules.filter { it.state == "SETTLED" }
    var chosen by rememberSaveable(party.id) { mutableStateOf<String?>(null) }
    val selected = chosen?.takeIf { id -> periods.any { it.id == id } } ?: periods.firstOrNull()?.id

    Column(modifier = Modifier.fillMaxSize().padding(horizontal = 16.dp, vertical = 8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        when {
            loading -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
            selected == null -> Text(
                "클리어한 일정이 생기면 여기서 분배금을 정산합니다.",
                style = MaterialTheme.typography.bodyMedium,
                modifier = Modifier.padding(horizontal = 8.dp),
            )
            else -> {
                if (periods.size > 1) {
                    Row(
                        modifier = Modifier.horizontalScroll(rememberScrollState()),
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        periods.forEach { period ->
                            FilterChip(
                                selected = period.id == selected,
                                onClick = { chosen = period.id },
                                label = {
                                    Text(
                                        (period.confirmed?.let { "${TimeSlots.dateTime(it.startMs)} 레이드" } ?: period.id) +
                                            if (period.settlement?.completed == true) " · 정산 완료" else "",
                                    )
                                },
                            )
                        }
                    }
                }
                key(selected) {
                    SettlementContent(uid = uid, party = party, periodId = selected, modifier = Modifier.weight(1f), parties = parties)
                }
            }
        }
    }
}

/** 파티 설정 탭: 추천 설정, 파티장 위임, 파티 탈퇴 */
@Composable
private fun PartySettingsTab(
    uid: String,
    party: Party,
    schedule: Schedule?,
    busy: Boolean,
    onSave: (RecommendSettings) -> Unit,
    onAsk: (Confirm) -> Unit,
) {
    val isLeader = party.leaderUid == uid
    val saved = RecommendSettings(party.preferredWindow, party.minLeadMinutes, party.autoAssign)
    // 다른 기기에서 바뀌거나 저장되면 편집 중인 값도 맞춘다.
    var draft by remember(saved) { mutableStateOf(saved) }
    val others = party.memberUids.filter { it != uid }.mapNotNull { party.members[it] }
    var delegateTo by remember(party.leaderUid) { mutableStateOf<PartyMember?>(null) }

    TabColumn {
        Text("추천 설정", style = MaterialTheme.typography.titleMedium)
        if (isLeader) {
            RecommendSettingsEditor(draft, enabled = !busy) { draft = it }
            if (schedule?.acceptsInput == true && schedule.candidates.isNotEmpty()) {
                Text(
                    if (draft.autoAssign && !party.autoAssign) {
                        "지금 투표 중입니다. 자동 지정을 켜면 투표 없이 점수 1위 시간으로 바로 확정합니다(미리 연 다음 주는 목요일 00:00)."
                    } else {
                        "지금 조율 중입니다. 설정을 바꾸면 추천 시간을 다시 계산합니다."
                    },
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.error,
                )
            }
            Button(enabled = !busy && draft != saved, modifier = Modifier.fillMaxWidth(), onClick = { onSave(draft) }) { Text("저장") }
        } else {
            Text(recommendSettingsSummary(party.preferredWindow, party.minLeadMinutes, party.autoAssign), style = MaterialTheme.typography.bodyMedium)
            Text("추천 설정은 파티장만 바꿀 수 있습니다.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }

        if (isLeader) {
            HorizontalDivider()
            Text("파티장 위임", style = MaterialTheme.typography.titleMedium)
            if (others.isEmpty()) {
                Text("파티장을 넘길 파티원이 없습니다.", style = MaterialTheme.typography.bodySmall)
            } else {
                others.forEach { member ->
                    Row(
                        modifier = Modifier.fillMaxWidth().clickable(enabled = !busy) { delegateTo = member },
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        RadioButton(selected = delegateTo?.uid == member.uid, onClick = null)
                        Text("${member.label()} (${member.characterName})", modifier = Modifier.padding(start = 8.dp))
                    }
                }
                OutlinedButton(
                    enabled = !busy && delegateTo != null,
                    modifier = Modifier.fillMaxWidth(),
                    onClick = { delegateTo?.let { onAsk(Confirm.Delegate(it)) } },
                ) { Text("위임") }
            }
        }

        HorizontalDivider()
        Text("파티 탈퇴", style = MaterialTheme.typography.titleMedium)
        Text(
            if (party.scheduleStarted) {
                "일정을 시작한 뒤에는 가입·탈퇴·위임을 ${if (party.isWeekly) "목요일" else "매월 1일"}에, 일정이 확정되기 전에만 할 수 있습니다."
            } else {
                "첫 일정을 시작하기 전까지는 언제든 탈퇴할 수 있습니다."
            },
            style = MaterialTheme.typography.bodySmall,
        )
        OutlinedButton(enabled = !busy, modifier = Modifier.fillMaxWidth(), onClick = { onAsk(Confirm.Leave) }) {
            Text("파티 탈퇴", color = MaterialTheme.colorScheme.error)
        }
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

/** 용병 한 줄. 계정이 없는 더미라 시간표 보기 버튼이 없다. */
@Composable
private fun MercenaryRow(label: String, period: String, onRemove: (() -> Unit)?, busy: Boolean) {
    Row(modifier = Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        Spacer(Modifier.size(56.dp))
        Column(modifier = Modifier.weight(1f).padding(start = 8.dp)) {
            Text(label, style = MaterialTheme.typography.titleSmall)
            Text("용병 · ${period}만", style = MaterialTheme.typography.bodySmall)
        }
        if (onRemove != null) TextButton(enabled = !busy, onClick = onRemove) { Text("빼기") }
    }
}

/**
 * 이번 주기 용병: 내가 못 가면 용병으로 대체하고, 파티장은 임시 용병을 추가한다.
 * 확정 전, 또는 확정 후 레이드 시작 전에만 보인다.
 */
@Composable
private fun MercenaryCard(uid: String, party: Party, schedule: Schedule, busy: Boolean, onAsk: (Confirm) -> Unit) {
    val word = periodWord(schedule)
    val mine = schedule.replacementOf(uid)
    val lastOne = party.participantUids(schedule).size <= 1
    val full = party.memberUids.size + schedule.extraMercenaryCount >= MAX_PARTY_SIZE
    Card(modifier = Modifier.fillMaxWidth()) {
        Column(modifier = Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text("$word 용병", style = MaterialTheme.typography.titleSmall)
            Text(
                if (schedule.state == "LOCKED") {
                    "확정된 시간은 그대로 두고, 못 가는 파티원을 용병으로 대체하거나 용병을 더할 수 있습니다(레이드 시작 전까지)."
                } else {
                    "못 가는 파티원은 용병으로 대체하면 입력·투표에서 빠지고, 나머지로 다시 추천합니다. 용병은 분배금 1인분을 받습니다."
                },
                style = MaterialTheme.typography.bodySmall,
            )
            when {
                mine != null && schedule.canCancelReplacement ->
                    OutlinedButton(enabled = !busy, modifier = Modifier.fillMaxWidth(), onClick = { onAsk(Confirm.MercenaryRemove(mine)) }) {
                        Text("대체 취소")
                    }
                mine != null -> Text("${word}는 용병으로 대체했습니다. 확정된 뒤에는 취소할 수 없습니다.", style = MaterialTheme.typography.bodySmall)
                !lastOne ->
                    OutlinedButton(enabled = !busy, modifier = Modifier.fillMaxWidth(), onClick = { onAsk(Confirm.MercenaryReplace) }) {
                        Text("$word 용병으로 대체")
                    }
            }
            if (party.leaderUid == uid) {
                if (full) {
                    Text("파티 인원이 가득 차 용병을 더할 수 없습니다(최대 ${MAX_PARTY_SIZE}명).", style = MaterialTheme.typography.bodySmall)
                } else {
                    OutlinedButton(enabled = !busy, modifier = Modifier.fillMaxWidth(), onClick = { onAsk(Confirm.MercenaryAdd) }) {
                        Text("임시 용병 추가")
                    }
                }
            }
        }
    }
}

@Composable
private fun MemberRow(
    member: PartyMember,
    imageUrl: String?,
    isLeader: Boolean,
    isMe: Boolean,
    status: String?,
    onViewTimetable: () -> Unit,
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
            if (status != null) {
                Text(
                    status,
                    style = MaterialTheme.typography.labelMedium,
                    color = if (status == "미입력" || status == "투표 전") MaterialTheme.colorScheme.error
                    else MaterialTheme.colorScheme.primary,
                )
            }
        }
        // 그 파티원의 이번 주기 불가 시간을 본다.
        TextButton(onClick = onViewTimetable) { Text("시간표 보기") }
    }
}

@Composable
private fun ScheduleSection(
    party: Party,
    schedule: Schedule?,
    /** 미리 연 다음 주 일정 (확정은 목요일부터) */
    early: Boolean,
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
    // 이번 주기 참여 파티원 (용병으로 대체한 사람 제외)
    val participants = party.participantUids(schedule)
    val memberCount = participants.size
    val replaced = schedule?.isReplaced(uid) == true
    val confirmed = schedule?.confirmed
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        when {
            loading -> CircularProgressIndicator()
            schedule == null -> Text(
                "아직 일정이 시작되지 않았습니다. 파티장이 '이번 주기 지금 시작'을 누르면 바로 열리고, " +
                    "누르지 않으면 다음 ${if (party.isWeekly) "목요일" else "달 1일"} 00:00에 자동으로 열립니다.",
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
            schedule.state == "SETTLED" -> {
                Text(
                    "클리어 완료" + (confirmed?.let { " · ${TimeSlots.range(it.startMs, it.endMs)}" } ?: ""),
                    style = MaterialTheme.typography.titleSmall,
                    color = MaterialTheme.colorScheme.primary,
                )
                Text("분배금은 정산 탭에서 정산합니다.", style = MaterialTheme.typography.bodySmall)
            }
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
                            if (schedule.state == "OPEN" && !early) " · 마감 ${TimeSlots.dateTime(schedule.inputDeadlineMs - 60_000)}" else "",
                        style = MaterialTheme.typography.bodyMedium,
                    )
                    Text(
                        when {
                            replaced -> "이번 주기는 용병으로 대체했습니다. 나머지 파티원이 조율합니다. 파티 탭에서 대체를 취소할 수 있습니다."
                            myUnavailable?.submitted != true -> "아직 제출하지 않았습니다. 안 되는 시간이 없어도 제출해 주세요."
                            party.autoAssign -> "전원이 제출하면 투표 없이 점수가 가장 높은 시간으로 자동으로 정해집니다."
                            else -> "전원이 제출하면 추천 시간이 나옵니다."
                        },
                        style = MaterialTheme.typography.bodySmall,
                    )
                } else if (schedule.isAutoAssigned) {
                    AutoPlan(schedule)
                } else {
                    // 참여 파티원의 투표만 센다.
                    CandidateVoting(
                        schedule, early, memberCount, votes.filterKeys { it in participants }, myVote, canVote = !replaced,
                        isLeader, busy, onVote, onAsk,
                    )
                }
            }
        }
    }
}

/** 순위 후보 한 줄: "1위 · 11/21 (토) 21:00 ~ 22:00" + 이유 */
@Composable
private fun RankedCandidate(rank: Int, candidate: Candidate, action: (@Composable () -> Unit)? = null) {
    Row(modifier = Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        Column(modifier = Modifier.weight(1f)) {
            Text(
                "${rank}위 · ${TimeSlots.range(candidate.startMs, candidate.endMs)}",
                style = if (rank == 1) MaterialTheme.typography.titleSmall else MaterialTheme.typography.bodyMedium,
            )
            val why = reasonText(candidate.reasons)
            if (why.isNotEmpty()) {
                Text(why, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
        action?.invoke()
    }
}

/** 투표 없이 자동 지정: 미리 연 다음 주라 아직 확정하지 않고 예정만 보여 준다 (웹 VoteTab.tsx의 AutoPlan과 같음) */
@Composable
private fun AutoPlan(schedule: Schedule) {
    val upcoming = schedule.periodStartMs > System.currentTimeMillis()
    // 다른 파티 이름은 이 파티원 모두가 볼 수 있는 정보가 아니라 쓰지 않는다.
    val deferred = !upcoming && schedule.autoDeferredAtMs != null
    Card(modifier = Modifier.fillMaxWidth()) {
        Column(modifier = Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Text(
                when {
                    upcoming -> "자동 지정 예정 · ${TimeSlots.dateTime(schedule.periodStartMs)}에 확정"
                    deferred -> "자동 지정 대기"
                    else -> "자동 지정 중"
                },
                style = MaterialTheme.typography.labelMedium,
            )
            if (deferred) {
                Text(
                    "같은 파티원이 있는 다른 파티가 먼저 정하는 중입니다. 정해지면 그 시간을 피해 바로 확정합니다.",
                    style = MaterialTheme.typography.bodySmall,
                )
            }
            schedule.candidates.forEachIndexed { index, candidate -> RankedCandidate(index + 1, candidate) }
            Text("투표 없이 점수가 가장 높은 시간으로 정합니다. 불가 시간을 고치면 다시 계산합니다.", style = MaterialTheme.typography.bodySmall)
        }
    }
}

/** 자동으로 정한 일정을 파티장이 다른 순위로 바꾸는 목록 (변경 요청 마감 = 레이드 4시간 전까지) */
@Composable
private fun SwitchCandidates(schedule: Schedule, confirmed: Confirmed, now: Long, busy: Boolean, onAsk: (Confirm) -> Unit) {
    val others = schedule.candidates.withIndex().filter { it.value.startMs != confirmed.startMs }
    if (others.isEmpty()) return
    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Text("다른 순위로 바꾸기 (레이드 4시간 전까지)", style = MaterialTheme.typography.labelMedium)
        others.forEach { (index, candidate) ->
            val tooSoon = now >= TimeSlots.changeRequestDeadline(candidate.startMs)
            RankedCandidate(index + 1, candidate) {
                OutlinedButton(
                    enabled = !busy && !tooSoon,
                    onClick = { onAsk(Confirm.SwitchCandidate(index, TimeSlots.range(candidate.startMs, candidate.endMs))) },
                ) { Text(if (tooSoon) "4시간 안" else "이 시간으로") }
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
            Text(
                when {
                    !schedule.isAutoAssigned -> "확정된 시간"
                    schedule.confirmedBy == "AUTO" -> "투표 없이 자동으로 정한 시간"
                    else -> "파티장이 순위에서 고른 시간"
                },
                style = MaterialTheme.typography.labelMedium,
            )
            Text(TimeSlots.range(confirmed.startMs, confirmed.endMs), style = MaterialTheme.typography.titleLarge)
            val why = schedule.candidates.firstOrNull { it.startMs == confirmed.startMs }?.let { reasonText(it.reasons) }.orEmpty()
            if (schedule.isAutoAssigned && why.isNotEmpty()) {
                Text(why, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            if (schedule.mercenaries.isNotEmpty()) {
                Text(
                    "참여: 파티원 ${confirmed.memberUids.size}명 + 용병 ${schedule.mercenaries.size}명",
                    style = MaterialTheme.typography.bodySmall,
                )
            }
        }
    }

    if (schedule.isAutoAssigned && isLeader && schedule.state == "LOCKED" && now < TimeSlots.changeRequestDeadline(confirmed.startMs)) {
        SwitchCandidates(schedule, confirmed, now, busy, onAsk)
    }

    if (schedule.isReplaced(uid)) {
        Text("이 레이드는 용병으로 대체했습니다. 결과 기록과 변경 요청은 참여하는 파티원이 합니다.", style = MaterialTheme.typography.bodySmall)
        return
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
    // 변경 요청은 레이드 시작 4시간 전까지
    val deadline = TimeSlots.changeRequestDeadline(confirmed.startMs)
    if (now < deadline) {
        OutlinedButton(enabled = !busy, modifier = Modifier.fillMaxWidth(), onClick = { onAsk(Confirm.RequestChange) }) {
            Text("일정 변경 요청")
        }
        Text("변경 요청 마감: ${TimeSlots.dateTime(deadline)} (레이드 시작 4시간 전)", style = MaterialTheme.typography.bodySmall)
    } else {
        Text("변경 요청 기간(레이드 시작 4시간 전까지)이 지났습니다.", style = MaterialTheme.typography.bodySmall)
    }
}

@Composable
private fun CandidateVoting(
    schedule: Schedule,
    /** 미리 연 다음 주 일정이면 확정 버튼을 보여 주지 않는다 (확정은 목요일부터) */
    early: Boolean,
    memberCount: Int,
    votes: Map<String, Vote>,
    myVote: Vote?,
    /** 용병으로 대체한 사람은 투표하지 않는다(파티장이면 확정은 한다) */
    canVote: Boolean,
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
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(
                if (canVote) "가능한 시간에 모두 동의해 주세요. 전원이 동의한 시간 중에서 파티장이 확정합니다."
                else "이번 주기는 용병으로 대체해 투표하지 않습니다. 나머지 파티원이 투표합니다.",
                style = MaterialTheme.typography.bodySmall,
                modifier = Modifier.weight(1f),
            )
            // 한 번에 전부 고르거나 비운다. 투표는 아래 버튼으로 보낸다(골라 놓고 몇 개만 뺄 수 있게).
            val allSelected = schedule.candidates.indices.all { it in selected }
            if (canVote) {
                TextButton(
                    enabled = !busy,
                    onClick = { selected = if (allSelected) emptySet() else schedule.candidates.indices.toSet() },
                ) {
                    Text(if (allSelected) "모두 해제" else "모두 가능")
                }
            }
        }
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
                    .clickable(enabled = !busy && canVote) { selected = if (checked) selected - index else selected + index }
                    .padding(vertical = 6.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                if (canVote) Checkbox(checked = checked, onCheckedChange = null)
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
                    val why = reasonText(candidate.reasons)
                    if (why.isNotEmpty()) {
                        Text(why, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                }
                if (unanimous && isLeader && !early) {
                    Button(enabled = !busy, onClick = { onAsk(Confirm.Lock(index, label)) }) { Text("확정") }
                }
            }
        }
        if (canVote) {
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
        }
        Text(
            when {
                schedule.unanimous.isNotEmpty() && early -> "전원이 동의한 시간이 있습니다. 목요일 00:00부터 파티장이 확정할 수 있습니다."
                schedule.unanimous.isNotEmpty() && isLeader -> "전원이 동의한 시간 중 하나를 확정해 주세요."
                schedule.unanimous.isNotEmpty() -> "전원이 동의한 시간이 있습니다. 파티장의 확정을 기다립니다."
                currentVotes.size < memberCount -> "투표 ${currentVotes.size}/${memberCount}명. 전원이 투표했는데 전원 동의가 없으면 다음 후보로 넘어갑니다."
                else -> ""
            },
            style = MaterialTheme.typography.bodySmall,
        )
    }
}

/** 카카오톡 등으로 초대 코드를 보낸다. */
private fun shareInvite(context: Context, party: Party) {
    val text = buildString {
        append("[보스 스케줄 매니저] '${party.name}' 파티 초대\n")
        append("${party.bossLabel}\n")
        append("초대 코드: ${party.inviteCode}\n")
        append("앱의 파티 메뉴에서 '코드로 가입'을 누르고 코드를 입력해 주세요.")
    }
    val send = Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT, text)
    context.startActivity(Intent.createChooser(send, "초대 코드 보내기"))
}

/**
 * 파티원 한 명이 이 파티 이번 주기에 제출한 불가 시간을 보여 준다 (보기 전용).
 * 데이터는 파티 화면이 이미 받고 있는 이번 주기 불가 시간을 그대로 쓴다.
 */
@Composable
private fun MemberTimetableDialog(
    member: PartyMember,
    schedule: Schedule?,
    entry: Unavailable?,
    now: Long,
    onDismiss: () -> Unit,
) {
    Dialog(onDismissRequest = onDismiss, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        Surface(modifier = Modifier.fillMaxSize()) {
            Column(modifier = Modifier.fillMaxSize().padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text("${member.label()}님의 불가 시간", style = MaterialTheme.typography.headlineSmall)
                Text(
                    "${member.characterName} · Lv.${member.level} ${member.job}",
                    style = MaterialTheme.typography.bodySmall,
                )
                if (schedule == null) {
                    Text(
                        "이번 주기 일정이 아직 시작되지 않아 볼 시간표가 없습니다.",
                        style = MaterialTheme.typography.bodyMedium,
                        modifier = Modifier.weight(1f),
                    )
                } else {
                    Text(
                        "${TimeSlots.dayLabel(schedule.periodStartMs)} ~ ${TimeSlots.dayLabel(schedule.periodEndMs - 1)} · " +
                            when {
                                entry == null -> "아직 입력하지 않았습니다"
                                entry.submitted -> "제출함"
                                else -> "제출 전 (마지막으로 저장된 시간)"
                            },
                        style = MaterialTheme.typography.bodyMedium,
                    )
                    Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                        Legend(MaterialTheme.colorScheme.error, "불가")
                        Legend(MaterialTheme.colorScheme.surfaceVariant, "가능")
                    }
                    val columns = remember(schedule.periodStartMs, schedule.periodEndMs) {
                        periodColumns(schedule.periodStartMs, schedule.periodEndMs)
                    }
                    SlotGrid(
                        columns = columns,
                        selected = entry?.slots?.toSet().orEmpty(),
                        enabled = false,
                        onChange = {},
                        modifier = Modifier.weight(1f).fillMaxWidth(),
                        // 지난 시간은 흐리게
                        pastBefore = ((now - schedule.periodStartMs) / TimeSlots.SLOT_MS).toInt() + 1,
                    )
                }
                Button(onClick = onDismiss, modifier = Modifier.fillMaxWidth()) { Text("닫기") }
            }
        }
    }
}

/** 미리 연 다음 주 일정 위에 보여 줄 이번 주 결과 한 줄 */
private fun thisWeekResult(schedule: Schedule): String = when (schedule.state) {
    "SETTLED" -> "이번 주 클리어 완료" +
        (schedule.confirmed?.let { " · ${TimeSlots.range(it.startMs, it.endMs)}" } ?: "") +
        ". 분배금은 정산 탭에서 정산합니다."
    "SKIPPED" -> "이번 주는 진행하지 않았습니다."
    "EXPIRED" -> "이번 주 일정이 종료됐습니다."
    else -> ""
}
