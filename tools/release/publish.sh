#!/usr/bin/env bash
# 发布或更新 Release：由 .github/workflows/publish.yml 的「发布或更新」步骤调用。
# 需要的环境变量：GH_TOKEN、GITHUB_REPOSITORY、GITHUB_SHA、RUNNER_TEMP，
# 以及 plan 任务给出的 CHANNEL / VERSION / TAG / ROLLING / PRERELEASE / TITLE / BUILD_REF / BUILD_SHA。
set -euo pipefail

REMOTE="https://github.com/${GITHUB_REPOSITORY}.git"

# 目标固定为 plan 解析出的构建提交，不再按分支名临时取（分支可能已前进）。
# 打 v* 标签触发时标签已存在：此时不传 --target（附注标签对象不是有效目标）
TARGET="${BUILD_SHA:?BUILD_SHA 未设置}"
TAG_EXISTS=false
if [[ -n "$(git ls-remote "$REMOTE" "refs/tags/${TAG}" | cut -f1 || true)" ]]; then TAG_EXISTS=true; fi
echo "构建自 ${BUILD_REF}（${TARGET}），标签已存在=${TAG_EXISTS}"

# 比较基准按渠道取：滚动标签（*-latest）永远不作基准
case "$CHANNEL" in
  release)
    PREV=$(gh release list --limit 100 --json tagName,isPrerelease --jq '[.[] | select(.isPrerelease == false) | .tagName][]' | grep -v "^${TAG}$" | head -n 1 || true)
    ;;
  beta)
    # 测试版可能是纯版本号（标签说明带 [prerelease]）：按 isPrerelease 取，不按标签名猜
    PREV=$(gh release list --limit 100 --json tagName,isPrerelease --jq '[.[] | select(.isPrerelease == true) | .tagName][]' | grep -v '^dev-latest$' | grep -v "^${TAG}$" | head -n 1 || true)
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

if [[ "$ROLLING" == "true" ]] && gh release view "$TAG" > /dev/null 2>&1; then
  # 滚动渠道原地更新：先传新产物（覆盖同名），再删掉旧名字的产物，最后移动标签。
  # 不先删整个发布，任何一步失败时客户端仍能拿到上一版完整的包
  echo "滚动发布已存在，原地替换产物"
  gh release upload "$TAG" out/* --clobber
  fresh=$(cd out && ls -1)
  gh release view "$TAG" --json assets --jq '.assets[].name' | while IFS= read -r name; do
    if ! grep -Fxq -- "$name" <<< "$fresh"; then
      echo "删除旧产物 $name"
      gh release delete-asset "$TAG" "$name" --yes
    fi
  done
  gh api -X PATCH "repos/${GITHUB_REPOSITORY}/git/refs/tags/${TAG}" -f sha="$TARGET" -F force=true > /dev/null
  gh release edit "$TAG" --title "$TITLE" --prerelease="$PRERELEASE" --notes-file "$BODY_FILE"
elif gh release view "$TAG" > /dev/null 2>&1; then
  echo "发布已存在，覆盖产物与说明"
  gh release upload "$TAG" out/* --clobber
  gh release edit "$TAG" --title "$TITLE" --prerelease="$PRERELEASE" --notes-file "$BODY_FILE"
else
  if [[ "$ROLLING" == "true" && "$TAG_EXISTS" == "true" ]]; then
    # 滚动标签残留但发布不在：先把标签挪到本次提交，再在它上面建发布
    gh api -X PATCH "repos/${GITHUB_REPOSITORY}/git/refs/tags/${TAG}" -f sha="$TARGET" -F force=true > /dev/null
  fi
  args=(--title "$TITLE" --prerelease="$PRERELEASE" --notes-file "$BODY_FILE")
  if [[ "$TAG_EXISTS" != "true" ]]; then args+=(--target "$TARGET"); fi
  gh release create "$TAG" out/* "${args[@]}"
fi

echo "发布完成：${TAG}"
