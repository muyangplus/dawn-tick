# 注册/删除「GitHub 发布后立即同步 Gitee」的 Windows 计划任务。
#
# 为什么需要：Gitee 的仓库镜像是拉取式的（分钟到小时延迟），而 GitHub Actions
# 的机器访问 Gitee 会超时，云端没法直推。在维护机上每 N 分钟跑一次同步脚本，
# 效果就接近「发 GitHub 自动同步 Gitee」。
#
# 用法（在仓库根目录、PowerShell 下）：
#   powershell -ExecutionPolicy Bypass -File tools/release/install-gitee-sync-task.ps1
#   powershell -ExecutionPolicy Bypass -File tools/release/install-gitee-sync-task.ps1 -IntervalMinutes 2
#   powershell -ExecutionPolicy Bypass -File tools/release/install-gitee-sync-task.ps1 -Remove
#
# token 从 tools/release/.gitee-token 读取（已 gitignore），也可先用环境变量 GITEE_TOKEN。

param(
  [int]$IntervalMinutes = 5,
  [string]$TaskName = 'DawnTick Gitee Sync',
  [switch]$Remove
)

$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$script = Join-Path $repoRoot 'tools\release\sync-gitee-assets.mjs'
$tokenFile = Join-Path $repoRoot 'tools\release\.gitee-token'

if ($Remove) {
  schtasks /Delete /TN $TaskName /F 2>$null | Out-Null
  Write-Host "已删除计划任务：$TaskName"
  exit 0
}

if (-not (Test-Path $script)) { throw "找不到同步脚本：$script" }
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw '未找到 node，请先安装 Node.js' }
if (-not (Test-Path $tokenFile) -and -not $env:GITEE_TOKEN) {
  throw "缺少 Gitee 令牌：请把令牌写入 $tokenFile（或先设置环境变量 GITEE_TOKEN）"
}

$action = "cmd /c cd /d `"$repoRoot`" && node `"$script`""
schtasks /Create /SC MINUTE /MO $IntervalMinutes /TN $TaskName /TR $action /F | Out-Null
Write-Host "已注册计划任务：$TaskName（每 $IntervalMinutes 分钟同步一次）"
Write-Host "同步内容：GitHub assets 仓库的 dev/beta/release 分支 → Gitee"
Write-Host "手动立即同步：node tools/release/sync-gitee-assets.mjs"
