#!/usr/bin/env bash
# ⛔ 已作废（2026-10-25）：票套已通过 REST API 直接发布到 GitHub
#    Spec=#109，工单 01-19 = #110-#128（依赖边已接线，含 sub-issue 挂接）。
#    再跑本脚本会创建重复票！仅留作存档/参考。
# ---------------------------------------------
# 设界 · 前端整体改版票套上传脚本（dev 机执行，需 gh 已认证）
# 前置：git pull 拿到本套件（spec + .scratch/frontend-rework/）
# 动作：1) 建 Spec 父票  2) 按依赖顺序建 19 张票（ready-for-agent）
#       3) 二次编辑：把 Parent / Blocked by 解析为真实 issue 号
set -euo pipefail

REPO="QIUZI-HONG/DesignForge"
DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(git -C "$DIR" rev-parse --show-toplevel)"
ISSUES="$DIR/issues"

# 0) Spec 父票
SPEC_URL=$(gh issue create -R "$REPO" \
  --title "Spec · 前端整体改版与双层验收（ADR-0005，阶段 0-4）" \
  --label "ready-for-agent" \
  --body-file "$ROOT/docs/spec/frontend-rework-spec-v1.md")
SPEC_NUM=${SPEC_URL##*/}
echo "✓ Spec issue: #$SPEC_NUM"

# 1) 按依赖顺序建票（文件名 NN- 前缀即依赖序）
declare -A NUM
for f in "$ISSUES"/*.md; do
  nn=$(basename "$f" | cut -d- -f1)
  title=$(head -n1 "$f" | sed 's/^#[0-9]*: //')
  url=$(gh issue create -R "$REPO" --title "$title" --label "ready-for-agent" --body-file "$f")
  NUM[$nn]=${url##*/}
  echo "✓ $nn -> #${NUM[$nn]}  $title"
done

# 2) 解析 Parent 与 Blocked by（本地 NN -> 真实 # 号）
for f in "$ISSUES"/*.md; do
  nn=$(basename "$f" | cut -d- -f1)
  raw=$(grep -m1 '^blockers:' "$f" | sed 's/^blockers:[[:space:]]*//' || true)
  refs=""
  for b in ${raw:-}; do
    refs+="#${NUM[$b]} "
  done
  body=$(mktemp)
  {
    awk '/^blockers:/{next} {print}' "$f"
    echo
    echo "## Parent"
    echo
    echo "- #$SPEC_NUM（Spec · 前端整体改版与双层验收）"
    if [ -n "$refs" ]; then
      echo
      echo "## Blocked by"
      echo
      echo "- $refs"
    fi
  } > "$body"
  gh issue edit -R "$REPO" "${NUM[$nn]}" --body-file "$body"
  rm -f "$body"
  echo "✓ wired #${NUM[$nn]} (blocked by: ${raw:-none})"
done

echo "完成：Spec #$SPEC_NUM + ${#NUM[@]} 张票已发布并接线。"
