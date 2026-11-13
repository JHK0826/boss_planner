#!/bin/sh
# CHANGELOG.md에서 한 버전의 내용만 뽑는다. 릴리스 노트로 쓴다.
#   사용법: scripts/changelog-section.sh 1.0.0
# 해당 버전 항목이 없으면 아무것도 출력하지 않고 1로 끝난다.
set -eu
version="$1"
file="${2:-CHANGELOG.md}"
section=$(awk -v version="$version" '
  /^## / {
    if (printing) exit
    if ($2 == version) { printing = 1; found = 1; next }
  }
  printing { print }
  END { exit found ? 0 : 1 }
' "$file") || exit 1
# 제목 바로 다음의 빈 줄을 뺀다.
printf '%s\n' "$section" | sed -e '1{/^$/d;}'
