# 把本机签名材料写入 GitHub 仓库 secret（需要 gh 已登录，且有 repo 的 secrets 写权限）
# 用法：powershell -ExecutionPolicy Bypass -File tools/release/set-github-secrets.ps1 [-Repo muyangplus/dawn-tick]
# 材料来自 keys/keystore.properties（已 gitignore）；脚本只输出 secret 名与字节数，不回显任何口令。

param(
  [string]$Repo = 'muyangplus/dawn-tick'
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
Set-Location $root

$auth = & gh auth status 2>&1 | Out-String
if ($LASTEXITCODE -ne 0) {
  throw "gh 未登录：请先运行 gh auth login（或设置 GH_TOKEN），再执行本脚本`n$auth"
}

$propsPath = Join-Path $root 'keys/keystore.properties'
if (-not (Test-Path $propsPath)) { throw "找不到签名属性文件：$propsPath" }

$values = @{}
foreach ($line in Get-Content $propsPath -Encoding UTF8) {
  if ($line -match '^\s*#' -or $line -notmatch '=') { continue }
  $name, $value = $line.Split('=', 2)
  $values[$name.Trim()] = $value.Trim()
}

$keystorePath = $values['ANDROID_KEYSTORE_PATH']
if ([string]::IsNullOrWhiteSpace($keystorePath)) { $keystorePath = $values['storeFile'] }
if ([string]::IsNullOrWhiteSpace($keystorePath)) { throw '属性文件里没有 ANDROID_KEYSTORE_PATH / storeFile' }
if (-not (Test-Path $keystorePath)) { throw "密钥库不存在：$keystorePath" }

$storePassword = $values['ANDROID_KEYSTORE_PASSWORD']
if ([string]::IsNullOrWhiteSpace($storePassword)) { $storePassword = $values['storePassword'] }
$keyAlias = $values['ANDROID_KEY_ALIAS']
if ([string]::IsNullOrWhiteSpace($keyAlias)) { $keyAlias = $values['keyAlias'] }
$keyPassword = $values['ANDROID_KEY_PASSWORD']
if ([string]::IsNullOrWhiteSpace($keyPassword)) { $keyPassword = $values['keyPassword'] }
if ([string]::IsNullOrWhiteSpace($storePassword) -or [string]::IsNullOrWhiteSpace($keyAlias)) {
  throw '属性文件缺少口令或别名'
}

# base64 走临时文件，避免把密钥放到命令行参数里
$tempFile = Join-Path ([System.IO.Path]::GetTempPath()) ("dawntick-keystore-{0}.b64" -f [guid]::NewGuid().ToString('N'))
try {
  $base64 = [Convert]::ToBase64String([System.IO.File]::ReadAllBytes($keystorePath))
  [System.IO.File]::WriteAllText($tempFile, $base64, [System.Text.UTF8Encoding]::new($false))

  # gh 2.102 的 secret set 没有 --body-file：不传 --body 时它从标准输入读值，
  # 用 Start-Process 把临时文件直接接到 stdin，既不进命令行也不多加换行
  $proc = Start-Process -FilePath 'gh' `
    -ArgumentList @('secret', 'set', 'ANDROID_KEYSTORE_BASE64', '-R', $Repo) `
    -NoNewWindow -Wait -PassThru -RedirectStandardInput $tempFile
  if ($proc.ExitCode -ne 0) { throw "写入 ANDROID_KEYSTORE_BASE64 失败：$($proc.ExitCode)" }
  Write-Output ("ANDROID_KEYSTORE_BASE64 已写入（{0} 字节 base64）" -f $base64.Length)

  & gh secret set ANDROID_KEYSTORE_PASSWORD -R $Repo --body $storePassword
  if ($LASTEXITCODE -ne 0) { throw "写入 ANDROID_KEYSTORE_PASSWORD 失败：$LASTEXITCODE" }
  & gh secret set ANDROID_KEY_ALIAS -R $Repo --body $keyAlias
  if ($LASTEXITCODE -ne 0) { throw "写入 ANDROID_KEY_ALIAS 失败：$LASTEXITCODE" }
  & gh secret set ANDROID_KEY_PASSWORD -R $Repo --body $keyPassword
  if ($LASTEXITCODE -ne 0) { throw "写入 ANDROID_KEY_PASSWORD 失败：$LASTEXITCODE" }
  Write-Output "ANDROID_KEYSTORE_PASSWORD / ANDROID_KEY_ALIAS（$keyAlias）/ ANDROID_KEY_PASSWORD 已写入"
} finally {
  Remove-Item $tempFile -Force -ErrorAction SilentlyContinue
}

Write-Output "仓库 $Repo 现有 secret："
& gh secret list -R $Repo
