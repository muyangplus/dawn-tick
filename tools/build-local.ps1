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

$baseVersion = (Get-Content (Join-Path $root 'package.json') -Raw | ConvertFrom-Json).version
if ([string]::IsNullOrWhiteSpace($baseVersion)) { throw '根 package.json 缺少 version' }

# dev 构建带构建时间戳：产物名与关于页能区分是哪一次构建
$stampInfo = (node tools/release/build-stamp.mjs --channel $Channel $baseVersion) | ConvertFrom-Json
$version = $stampInfo.version

$env:DT_CHANNEL = $Channel
$env:DT_VERSION = $version
$env:DT_VERSION_CODE = [string]$stampInfo.versionCode
Write-Output "本地打包：渠道 $Channel，版本 $version（构建时间戳 $($stampInfo.stamp)）"

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

# 必须确认前端资源已嵌入：直接 cargo build 的产物会去加载 devUrl（localhost:5173），
# 运行后表现为「localhost 拒绝连接」。这里用前端哈希资源名做嵌入校验。
$assetDir = Join-Path $root 'apps/web/dist/assets'
$marker = Get-ChildItem $assetDir -Filter '*.js' -ErrorAction SilentlyContinue | Select-Object -First 1
if ($null -eq $marker) { throw "找不到前端产物：$assetDir，请先构建 web" }
$exeText = [System.Text.Encoding]::ASCII.GetString([System.IO.File]::ReadAllBytes($exe))
if (-not $exeText.Contains($marker.Name)) {
  throw "产物未嵌入前端资源（缺少 $($marker.Name)）：请用本脚本构建，不要直接使用 cargo build 的产物"
}
Write-Output "已确认前端资源嵌入：$($marker.Name)"

$stage = Join-Path $root 'out-local/stage-portable'
Remove-Item $stage -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path $stage | Out-Null
Copy-Item $exe (Join-Path $stage 'DawnTick.exe') -Force

$readme = @(
  "晓刻 DawnTick 便携版（$Channel 渠道 / $buildKind 构建 / v$version）",
  '',
  '数据与日志都在本目录（dawn-tick.db、window.json、dawn-tick.log），整个文件夹拷走即带走全部数据',
  '数据库默认单文件（journal_mode=DELETE）；设置页「数据」可改存储位置与「启用 WAL 日志模式」',
  '导入：搜索学校 → 打开内嵌窗口 → 自行登录进课表页 → 点右下角「导入到晓刻」'
) -join "`r`n"
Set-Content (Join-Path $stage 'README-portable.txt') -Value $readme -Encoding UTF8

$zip = Join-Path $root "out-local/DawnTick-$version-$Channel-windows-x64-portable.zip"
Remove-Item $zip -Force -ErrorAction SilentlyContinue
Compress-Archive -Path (Join-Path $stage '*') -DestinationPath $zip -Force
Remove-Item $stage -Recurse -Force
Write-Output "已生成：$zip"
