# 打 Android 签名包（dev 渠道为 debug 变体，但同样用正式密钥签名，保证能覆盖安装）
# 用法：powershell -File tools/release/build-android-release.ps1 [-Channel dev|beta|release]
# 密钥来自 keystore.properties（优先）或现有环境变量；两者都没有则明确报错。

param(
  [ValidateSet('dev', 'beta', 'release')]
  [string]$Channel = ''
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
Set-Location $root

$props = Join-Path $root 'apps/mobile/android/keystore.properties'
if (Test-Path $props) {
  foreach ($line in Get-Content $props -Encoding UTF8) {
    if ($line -match '^\s*#' -or $line -notmatch '=') { continue }
    $name, $value = $line.Split('=', 2)
    switch ($name.Trim()) {
      'storeFile' { $env:ANDROID_KEYSTORE_PATH = $value.Trim() }
      'storePassword' { $env:ANDROID_KEYSTORE_PASSWORD = $value.Trim() }
      'keyAlias' { $env:ANDROID_KEY_ALIAS = $value.Trim() }
      'keyPassword' { $env:ANDROID_KEY_PASSWORD = $value.Trim() }
    }
  }
}

if ([string]::IsNullOrWhiteSpace($env:ANDROID_KEYSTORE_PATH)) {
  throw '没有签名材料：请先运行 tools/release/make-android-keystore.ps1，或设置 ANDROID_KEYSTORE_* 环境变量，或写 apps/mobile/android/keystore.properties'
}
if (-not (Test-Path $env:ANDROID_KEYSTORE_PATH)) {
  throw "密钥库不存在：$($env:ANDROID_KEYSTORE_PATH)"
}

$baseVersion = (Get-Content (Join-Path $root 'package.json') -Raw | ConvertFrom-Json).version
if (-not [string]::IsNullOrWhiteSpace($Channel)) { $env:DT_CHANNEL = $Channel }
$env:DT_CHANNEL = if ([string]::IsNullOrWhiteSpace($env:DT_CHANNEL)) { 'dev' } else { $env:DT_CHANNEL }
$stampInfo = (node (Join-Path $root 'tools/release/build-stamp.mjs') --channel $env:DT_CHANNEL $baseVersion) | ConvertFrom-Json
$version = $stampInfo.version
$env:DT_VERSION = $version
$env:DT_VERSION_CODE = [string]$stampInfo.versionCode
Write-Output "Android 包：渠道 $($env:DT_CHANNEL)，版本 $version（构建时间戳 $($stampInfo.stamp)，versionCode $($env:DT_VERSION_CODE)）"

$buildDebug = $env:DT_CHANNEL -ne 'release'
$task = if ($buildDebug) { 'assembleDebug' } else { 'assembleRelease' }

Push-Location (Join-Path $root 'apps/mobile')
try {
  & pnpm exec cap sync android
  if ($LASTEXITCODE -ne 0) { throw "cap sync 失败：$LASTEXITCODE" }
} finally {
  Pop-Location
}

Push-Location (Join-Path $root 'apps/mobile/android')
try {
  & '.\gradlew.bat' $task --no-daemon
  if ($LASTEXITCODE -ne 0) { throw "gradle $task 失败：$LASTEXITCODE" }
} finally {
  Pop-Location
}

$apkDir = if ($buildDebug) { 'apps/mobile/android/app/build/outputs/apk/debug' } else { 'apps/mobile/android/app/build/outputs/apk/release' }
$source = Get-ChildItem $apkDir -Filter '*.apk' | Select-Object -First 1
if ($null -eq $source) { throw "没有找到 APK：$apkDir" }

# 产物名与发布一致：DawnTick-<version>-<channel>-android.apk（dev 的 version 带构建时间戳）
$outDir = Join-Path $root 'out-local'
New-Item -ItemType Directory -Force -Path $outDir | Out-Null
$target = Join-Path $outDir "DawnTick-$version-$($env:DT_CHANNEL)-android.apk"
Copy-Item $source.FullName $target -Force
Get-Item $target | Select-Object Name, @{n = 'MB'; e = { [math]::Round($_.Length / 1MB, 2) } }, FullName

$apksigner = Join-Path $env:ANDROID_HOME 'build-tools/35.0.0/apksigner.bat'
if (Test-Path $apksigner) {
  & $apksigner verify --print-certs $target 2>&1 | Select-String -Pattern 'certificate DN' | Select-Object -First 1
} else {
  Write-Output '校验签名：apksigner verify --print-certs <apk>'
}
