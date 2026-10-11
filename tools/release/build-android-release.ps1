# 打 Android 发布签名包
# 用法：powershell -File tools/release/build-android-release.ps1
# 密钥来自 keystore.properties（优先）或现有环境变量；两者都没有则明确报错。

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
  throw '没有签名材料：请先运行 tools/release/make-android-keystore.ps1，或设置 ANDROID_KEYSTORE_* 环境变量'
}
if (-not (Test-Path $env:ANDROID_KEYSTORE_PATH)) {
  throw "密钥库不存在：$($env:ANDROID_KEYSTORE_PATH)"
}

$version = (Get-Content (Join-Path $root 'package.json') -Raw | ConvertFrom-Json).version
$env:DT_CHANNEL = if ([string]::IsNullOrWhiteSpace($env:DT_CHANNEL)) { 'release' } else { $env:DT_CHANNEL }
$env:DT_VERSION = $version
Write-Output "Android 发布包：渠道 $($env:DT_CHANNEL)，版本 $version（release 渠道为 release 构建）"

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
Get-ChildItem $apkDir -Filter '*.apk' | Select-Object Name, @{n = 'MB'; e = { [math]::Round($_.Length / 1MB, 2) } }, FullName
Write-Output '校验签名：apksigner verify --print-certs <apk>'
