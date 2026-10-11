# 本地打包：默认 dev 渠道 + debug 构建（与发布流程区分）
# 用法：powershell -File tools/build-local.ps1 [-Channel dev|beta|release] [-Artefact zip|nsis]

param(
  [ValidateSet('dev', 'beta', 'release')]
  [string]$Channel = 'dev',
  [ValidateSet('zip', 'nsis')]
  [string]$Artefact = 'zip'
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

$version = (Get-Content (Join-Path $root 'package.json') -Raw | ConvertFrom-Json).version
if ([string]::IsNullOrWhiteSpace($version)) { throw '根 package.json 缺少 version' }

$env:DT_CHANNEL = $Channel
$env:DT_VERSION = $version
Write-Output "本地打包：渠道 $Channel，版本 $version"

# 本地默认 debug 构建：日志更详细，便于排查
$buildArgs = @('exec', 'tauri', 'build')
if ($Channel -ne 'release') { $buildArgs += '--debug' }

Push-Location (Join-Path $root 'apps/desktop')
try {
  & pnpm @buildArgs
  if ($LASTEXITCODE -ne 0) { throw "tauri build 失败：$LASTEXITCODE" }
} finally {
  Pop-Location
}

if ($Artefact -eq 'nsis') {
  Write-Output 'NSIS 安装包在 apps/desktop/src-tauri/target/(debug|release)/bundle/nsis'
  exit 0
}

$profile = if ($Channel -eq 'release') { 'release' } else { 'debug' }
$buildKind = if ($Channel -eq 'release') { 'release' } else { 'debug' }
$exe = Join-Path $root "apps/desktop/src-tauri/target/$profile/dawn-tick-desktop.exe"
$stage = Join-Path $root 'out-local/stage-portable'
Remove-Item $stage -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path $stage | Out-Null
Copy-Item $exe (Join-Path $stage 'DawnTick.exe') -Force

$readme = @(
  "晓刻 DawnTick 便携版（$Channel 渠道 / $buildKind 构建 / v$version）",
  '',
  '日志：%LOCALAPPDATA%\com.dawntick.app\startup.log（debug 构建含完整调试日志）',
  '导入：搜索学校 → 打开内嵌窗口 → 自行登录进课表页 → 点右下角「导入到晓刻」'
) -join "`r`n"
Set-Content (Join-Path $stage 'README-portable.txt') -Value $readme -Encoding UTF8

$zip = Join-Path $root "out-local/DawnTick-$version-$Channel-windows-x64-portable.zip"
Remove-Item $zip -Force -ErrorAction SilentlyContinue
Compress-Archive -Path (Join-Path $stage '*') -DestinationPath $zip -Force
Remove-Item $stage -Recurse -Force
Write-Output "已生成：$zip"
