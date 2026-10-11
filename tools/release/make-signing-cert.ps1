# 生成 Windows 自签名代码签名证书（只在本机执行一次）
# 用法：powershell -File tools/release/make-signing-cert.ps1
# 产物：local-notes/signing/dawntick-codesign.pfx 与 .cer（都在 .gitignore 内）
#
# 自签名的真实效果：能证明"文件由本证书签发、未被篡改"，
# 但 Windows 默认不信任它 —— 目标机器需要先安装 .cer 到
# 「受信任的根证书颁发机构」与「受信任的发布者」，之后才不再提示"未知发布者"。
# 对公网陌生用户，自签名仍然会被 SmartScreen 拦。

param(
  [string]$Subject = 'CN=DawnTick, OU=DawnTick, O=DawnTick, C=CN'
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
Set-Location $root

$outDir = Join-Path $root 'local-notes/signing'
New-Item -ItemType Directory -Force -Path $outDir | Out-Null
$pfx = Join-Path $outDir 'dawntick-codesign.pfx'
$cer = Join-Path $outDir 'dawntick-codesign.cer'

if (Test-Path $pfx) {
  Write-Output "已存在证书：$pfx"
  Write-Output '如需更换，请自行备份后删除它。'
  exit 0
}

$secure = Read-Host '设置 pfx 口令（请妥善保存）' -AsSecureString
$plain = [System.Net.NetworkCredential]::new('', $secure).Password

$cert = New-SelfSignedCertificate `
  -Type CodeSigningCert `
  -Subject $Subject `
  -CertStoreLocation 'Cert:\CurrentUser\My' `
  -KeyUsage DigitalSignature `
  -KeyAlgorithm RSA -KeyLength 3072 `
  -NotAfter (Get-Date).AddYears(5) `
  -TextExtension @('2.5.29.37={text}1.3.6.1.5.5.7.3.3')

$pfxSecure = ConvertTo-SecureString -String $plain -Force -AsPlainText
Export-PfxCertificate -Cert $cert -FilePath $pfx -Password $pfxSecure | Out-Null
Export-Certificate -Cert $cert -FilePath $cer | Out-Null

Write-Output "已生成：$pfx"
Write-Output "已导出公钥证书：$cer"
Write-Output "指纹：$($cert.Thumbprint)"
Write-Output ''
Write-Output '目标机器安装（只需一次，需管理员）：'
Write-Output "  Import-Certificate -FilePath `"$cer`" -CertStoreLocation Cert:\LocalMachine\Root"
Write-Output "  Import-Certificate -FilePath `"$cer`" -CertStoreLocation Cert:\LocalMachine\TrustedPublisher"
Write-Output ''
Write-Output '签名命令见 tools/release/sign-windows.ps1'
