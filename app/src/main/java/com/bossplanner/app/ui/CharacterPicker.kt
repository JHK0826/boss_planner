package com.bossplanner.app.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.RadioButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.bossplanner.app.data.CharacterInfo

/** 파티에 넣을 캐릭터 한 명을 고른다. 온보딩에서 선택해 둔 캐릭터 중에서 고른다. */
@Composable
fun CharacterPicker(
    characters: List<CharacterInfo>,
    selectedId: String?,
    enabled: Boolean,
    onSelect: (String) -> Unit,
) {
    Column {
        Text("참여할 캐릭터", style = MaterialTheme.typography.titleSmall)
        if (characters.isEmpty()) {
            Text("선택한 캐릭터가 없습니다. 홈에서 캐릭터를 먼저 선택해 주세요.", style = MaterialTheme.typography.bodySmall)
        }
        characters.forEach { character ->
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .clickable(enabled = enabled) { onSelect(character.id) }
                    .padding(vertical = 6.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                RadioButton(selected = character.id == selectedId, onClick = null)
                Text(
                    "${character.name} · Lv.${character.level} ${character.job}",
                    modifier = Modifier.padding(start = 8.dp),
                )
            }
        }
    }
}
