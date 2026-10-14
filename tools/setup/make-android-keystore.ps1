#requires -Version 5.1
param(
    [string]$OutDir = (Join-Path (Split-Path (Split-Path $PSScriptRoot)) 'keys'),
    [string]$Alias = 'dawn-tick'
)

$ErrorActionPreference = 'Continue'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$keytool = 'E:\work\dsh\jdk21\extracted\jdk-21.0.12+8\bin\keytool.exe'
if (-not (Test-Path $keytool)) { Write-Output "keytool 未找到: $keytool"; exit 1 }

New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
$keystore = Join-Path $OutDir 'dawn-tick-release.key'
$props = Join-Path $OutDir 'keystore.properties'

if (Test-Path $keystore) {
    Write-Output "密钥库已存在，未覆盖: $keystore"
} else {
    $bytes = New-Object byte[] 24
    [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
    $password = ([Convert]::ToBase64String($bytes) -replace '[^A-Za-z0-9]', '').Substring(0, 24)

    & $keytool -genkeypair -v `
        -keystore $keystore `
        -alias $Alias `
        -keyalg RSA -keysize 2048 -validity 10000 `
        -storetype PKCS12 `
        -storepass $password -keypass $password `
        -dname "CN=Dawn Tick, OU=Mobile, O=muyangplus, C=CN" 2>&1 | Select-Object -Last 3

    $content = @"
ANDROID_KEYSTORE_PATH=$keystore
ANDROID_KEYSTORE_PASSWORD=$password
ANDROID_KEY_ALIAS=$Alias
ANDROID_KEY_PASSWORD=$password
"@
    Set-Content -Path $props -Value $content -Encoding UTF8
    Write-Output "已生成密钥库: $keystore"
    Write-Output "密码文件: $props"
}

Write-Output ''
Write-Output 'GitHub Secrets 需要配置（名称与值见上面的密码文件）：'
Write-Output '  ANDROID_KEYSTORE_BASE64   = base64(dawn-tick-release.key)'
Write-Output '  ANDROID_KEYSTORE_PASSWORD = 同上文件'
Write-Output '  ANDROID_KEY_ALIAS         = 同上文件'
Write-Output '  ANDROID_KEY_PASSWORD      = 同上文件'
