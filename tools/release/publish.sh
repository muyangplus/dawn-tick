#!/usr/bin/env bash
# 发布或更新 Release：由 .github/workflows/publish.yml 的「发布或更新」步骤调用。
# 需要的环境变量：GH_TOKEN、GITHUB_REPOSITORY、GITHUB_SHA、RUNNER_TEMP，
# 以及 plan 任务给出的 CHANNEL / VERSION / TAG / ROLLING / PRERELEASE / TITLE / BUILD_REF。
set -euo pipefail

REMOTE="https://github.com/${GITHUB_REPOSITORY}.git"

# 打 v* 标签触发时标签已存在：此时不传 --target；标签对象要用 ^{} 解引用成提交
TAG_EXISTS=false
TARGET=$(git ls-remote "$REMOTE" "refs/heads/${BUILD_REF}" | cut -f1 || true)
if [[ -z "$TARGET" ]]; then
  TARGET=$(git ls-remote "$REMOTE" "refs/tags/${BUILD_REF}^{}" | cut -f1 || true)
  if [[ -n "$TARGET" ]]; then TAG_EXISTS=true; fi
fi
if [[ -z "$TARGET" ]]; then TARGET="$GITHUB_SHA"; fi
echo "构建自 ${BUILD_REF}（${TARGET}），标签已存在=${TAG_EXISTS}"

# 比较基准按渠道取：滚动标签（*-latest）永远不作基准
case "$CHANNEL" in
  release)
    PREV=$(gh release list --limit 100 --json tagName,isPrerelease --jq '[.[] | select(.isPrerelease == false) | .tagName][]' | grep -v "^${TAG}$" | head -n 1 || true)
    ;;
  beta)
    PREV=$(gh release list --limit 100 --json tagName --jq '.[].tagName' | grep -E -- '-beta\.' | grep -v "^${TAG}$" | head -n 1 || true)
    ;;
  *)
    PREV=$(gh release list --limit 100 --json tagName --jq '.[].tagName' | grep -v '^dev-latest$' | head -n 1 || true)
    ;;
esac
PREV="${PREV//[[:space:]]/}"
case "$PREV" in
  *-latest) PREV="" ;;
esac

# 正文：首行渠道行 + CHANGELOG 段落（有就取）+ 手动追加的 Full Changelog。
# 用 --notes-file 时 GitHub 不会自动补比较链接，所以这里拼好再发，且不再传 --notes-start-tag（两个都传会互相覆盖）。
NOTES_FILE="$RUNNER_TEMP/release-notes.md"
BODY_FILE="$RUNNER_TEMP/release-body.md"
: > "$BODY_FILE"
if [[ -s "$NOTES_FILE" ]]; then
  cat "$NOTES_FILE" >> "$BODY_FILE"
else
  printf '%s\n' "${NOTES:?NOTES 未设置}" >> "$BODY_FILE"
fi
if [[ -n "$PREV" ]]; then
  printf '\n**Full Changelog**: https://github.com/%s/compare/%s...%s\n' "$GITHUB_REPOSITORY" "$PREV" "$TAG" >> "$BODY_FILE"
fi
echo "发布 ${TAG}（渠道 ${CHANNEL}），比较基准 ${PREV:-无}"

if gh release view "$TAG" > /dev/null 2>&1; then
  echo "发布已存在，覆盖产物与说明"
  gh release upload "$TAG" out/* --clobber
  gh release edit "$TAG" --title "$TITLE" --prerelease="$PRERELEASE" --notes-file "$BODY_FILE"
else
  args=(--title "$TITLE" --prerelease="$PRERELEASE" --notes-file "$BODY_FILE")
  if [[ "$TAG_EXISTS" != "true" ]]; then args+=(--target "$TARGET"); fi
  gh release create "$TAG" out/* "${args[@]}"
fi

echo "发布完成：${TAG}"
