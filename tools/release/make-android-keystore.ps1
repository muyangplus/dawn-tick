# 生成 Android 发布签名密钥（只在本机执行一次）
# 用法：powershell -File tools/release/make-android-keystore.ps1
# 产物：local-notes/signing/dawntick-release.jks 与 keystore.properties（都在 .gitignore 内）

param(
  [string]$Alias = 'dawntick',
  [int]$ValidityDays = 10000
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
Set-Location $root

$outDir = Join-Path $root 'local-notes/signing'
New-Item -ItemType Directory -Force -Path $outDir | Out-Null
$keystore = Join-Path $outDir 'dawntick-release.jks'
$props = Join-Path $root 'apps/mobile/android/keystore.properties'

if (Test-Path $keystore) {
  Write-Output "已存在密钥：$keystore"
  Write-Output '若要重新生成，请先自行备份并删除它；直接覆盖会让已安装的旧包无法升级。'
  exit 0
}

$keytool = Join-Path $env:JAVA_HOME 'bin/keytool.exe'
if (-not (Test-Path $keytool)) {
  $found = Get-Command keytool -ErrorAction SilentlyContinue
  if ($null -eq $found) { throw '找不到 keytool，请设置 JAVA_HOME 指向 JDK 21' }
  $keytool = $found.Source
}

$storePass = Read-Host '设置密钥库口令（至少 6 位，请自行妥善保存）' -AsSecureString
$keyPass = Read-Host '设置密钥口令（可直接回车复用上面口令）' -AsSecureString
$plainStore = [System.Net.NetworkCredential]::new('', $storePass).Password
$plainKey = [System.Net.NetworkCredential]::new('', $keyPass).Password
if ([string]::IsNullOrWhiteSpace($plainKey)) { $plainKey = $plainStore }

& $keytool -genkeypair -v `
  -keystore $keystore `
  -alias $Alias `
  -keyalg RSA -keysize 2048 -validity $ValidityDays `
  -storepass $plainStore -keypass $plainKey `
  -dname 'CN=DawnTick, OU=DawnTick, O=DawnTick, L=Suzhou, ST=Jiangsu, C=CN'
if ($LASTEXITCODE -ne 0) { throw "keytool 失败：$LASTEXITCODE" }

$lines = @(
  "# 本文件不入库（见 .gitignore），由 tools/release/make-android-keystore.ps1 生成",
  "storeFile=$($keystore -replace '\\','/')",
  "storePassword=$plainStore",
  "keyAlias=$Alias",
  "keyPassword=$plainKey"
)
Set-Content -Path $props -Value $lines -Encoding UTF8

Write-Output "已生成密钥：$keystore"
Write-Output "已写入：$props"
Write-Output '请备份这两份材料；丢失后将无法为已安装的应用发布升级包。'
