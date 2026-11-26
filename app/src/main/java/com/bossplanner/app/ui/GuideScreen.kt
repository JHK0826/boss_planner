package com.bossplanner.app.ui

import androidx.activity.compose.BackHandler
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.KeyboardArrowDown
import androidx.compose.material.icons.filled.KeyboardArrowRight
import androidx.compose.material3.Card
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.bossplanner.app.data.Guide
import com.bossplanner.app.data.GuideBlock
import com.bossplanner.app.data.GuideItem

/** 사용 가이드: 기본 사용 흐름, 기능별 설명, 자주 묻는 질문 (웹 GuideScreen.tsx와 같은 내용) */
@Composable
fun GuideScreen(onBack: () -> Unit) {
    val context = LocalContext.current
    val sections = remember { Guide.load(context) }
    BackHandler(onBack = onBack)

    LazyColumn(
        modifier = Modifier.fillMaxSize().padding(horizontal = 16.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        item { TextButton(onClick = onBack, modifier = Modifier.padding(top = 8.dp)) { Text("← 설정") } }
        item { Text("사용 가이드", style = MaterialTheme.typography.headlineSmall) }
        if (sections.isEmpty()) {
            item { Text("가이드를 불러오지 못했습니다.", style = MaterialTheme.typography.bodyMedium) }
        }
        sections.forEachIndexed { sectionIndex, section ->
            item(key = section.id) {
                Text(section.title, style = MaterialTheme.typography.titleMedium, modifier = Modifier.padding(top = 12.dp))
            }
            items(section.items, key = { "${section.id}/${it.id}" }) { item ->
                // 처음 여는 사람이 바로 읽을 수 있게 첫 항목만 펴 둔다.
                GuideEntry(item, initiallyOpen = sectionIndex == 0 && item == section.items.first())
            }
        }
        item {
            Text(
                "Data based on NEXON Open API",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(vertical = 16.dp),
            )
        }
    }
}

@Composable
private fun GuideEntry(item: GuideItem, initiallyOpen: Boolean) {
    var open by rememberSaveable(item.id) { mutableStateOf(initiallyOpen) }
    Card(modifier = Modifier.fillMaxWidth()) {
        Row(
            modifier = Modifier.fillMaxWidth().clickable { open = !open }.padding(horizontal = 12.dp, vertical = 14.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            Icon(
                if (open) Icons.Filled.KeyboardArrowDown else Icons.Filled.KeyboardArrowRight,
                contentDescription = null,
                tint = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Text(item.title, style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold)
        }
        AnimatedVisibility(visible = open) {
            Column(
                modifier = Modifier.padding(start = 42.dp, end = 16.dp, bottom = 14.dp),
                verticalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                Guide.blocks(item.body).forEach { block ->
                    when (block) {
                        is GuideBlock.Paragraph -> Text(block.text, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        is GuideBlock.Bullets -> block.items.forEach { text ->
                            Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                                Text("•", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                                Text(text, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                            }
                        }
                    }
                }
            }
        }
    }
}
