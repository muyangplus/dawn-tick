# 用自签名证书给 Windows 产物签名（exe 与 NSIS 安装包）
# 用法：powershell -File tools/release/sign-windows.ps1 [-Path <文件或目录>] [-PfxPassword <口令>]
# 默认给 out-local 下的 DawnTick.exe 与 apps/desktop/src-tauri/target 下的安装包签名。

param(
  [string[]]$Path = @('out-local/DawnTick.exe'),
  [string]$Pfx = '',
  [string]$PfxPassword = '',
  [string]$Timestamp = 'http://timestamp.digicert.com'
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
Set-Location $root

if ([string]::IsNullOrWhiteSpace($Pfx)) {
  $Pfx = Join-Path $root 'local-notes/signing/dawntick-codesign.pfx'
}
if (-not (Test-Path $Pfx)) {
  throw "找不到证书：$Pfx（先运行 tools/release/make-signing-cert.ps1）"
}
if ([string]::IsNullOrWhiteSpace($PfxPassword)) {
  $secure = Read-Host '输入 pfx 口令' -AsSecureString
  $PfxPassword = [System.Net.NetworkCredential]::new('', $secure).Password
}

$securePassword = ConvertTo-SecureString -String $PfxPassword -Force -AsPlainText
# Windows PowerShell 5.1 的 Get-PfxCertificate 不支持 -Password，
# 改为把 pfx 导入当前用户个人证书库再取用（幂等，重复执行不会重复导入）。
$imported = Import-PfxCertificate -FilePath $Pfx -CertStoreLocation 'Cert:\CurrentUser\My' -Password $securePassword
$cert = Get-Item "Cert:\CurrentUser\My\$($imported.Thumbprint)"
Write-Output "使用证书：$($cert.Subject)（指纹 $($cert.Thumbprint)）"

$targets = @()
foreach ($item in $Path) {
  if (Test-Path $item -PathType Container) {
    $targets += Get-ChildItem $item -Recurse -File -Include '*.exe', '*.msi' | Select-Object -ExpandProperty FullName
  } elseif (Test-Path $item) {
    $targets += (Resolve-Path $item).Path
  } else {
    Write-Output "跳过（不存在）：$item"
  }
}

if ($targets.Count -eq 0) { throw '没有可签名的文件' }

foreach ($target in $targets) {
  $result = $null
  try {
    $result = Set-AuthenticodeSignature -FilePath $target -Certificate $cert -TimestampServer $Timestamp -ErrorAction Stop
  } catch {
    Write-Output "  时间戳服务不可用，改为不带时间戳签名：$($_.Exception.Message)"
    $result = Set-AuthenticodeSignature -FilePath $target -Certificate $cert
  }
  $status = $result.Status
  Write-Output "$([IO.Path]::GetFileName($target))：$status"
  if ($status -ne 'Valid') {
    Write-Output "  说明：自签名证书未被本机信任时状态为 $status，属预期；安装 .cer 到受信任根后即为 Valid"
  }
}

Write-Output ''
Write-Output '查看结果：Get-AuthenticodeSignature out-local\DawnTick.exe | Format-List Status,SignerCertificate'
