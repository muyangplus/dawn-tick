param(
    [string]$CargoRegistry = 'sparse+https://mirrors.ustc.edu.cn/crates.io-index/',
    [string]$RustupDistServer = 'https://mirrors.tuna.tsinghua.edu.cn/rustup',
    [string]$NpmRegistry = 'https://registry.npmmirror.com'
)

$ErrorActionPreference = 'Continue'

Write-Output '--- rustup ---'
[Environment]::SetEnvironmentVariable('RUSTUP_DIST_SERVER', $RustupDistServer, 'User')
[Environment]::SetEnvironmentVariable('RUSTUP_UPDATE_ROOT', "$RustupDistServer/rustup", 'User')
Write-Output "RUSTUP_DIST_SERVER=$([Environment]::GetEnvironmentVariable('RUSTUP_DIST_SERVER', 'User'))"

Write-Output '--- cargo ---'
$cargoDir = Join-Path $env:USERPROFILE '.cargo'
New-Item -ItemType Directory -Force -Path $cargoDir | Out-Null
$cargoConfig = Join-Path $cargoDir 'config.toml'
@"
[source.crates-io]
replace-with = 'mirror'

[source.mirror]
registry = '$CargoRegistry'

[net]
git-fetch-with-cli = true
"@ | Set-Content -Path $cargoConfig -Encoding UTF8
Write-Output "written: $cargoConfig"

Write-Output '--- npm / pnpm ---'
npm config set registry $NpmRegistry 2>&1 | Out-Null
Write-Output "registry=$(npm config get registry)"

Write-Output '--- NO_PROXY ---'
# Windows 注册表里的系统代理即使已关闭，cargo 仍会读取；限定镜像域名绕过。
$noProxyHosts = @(
    'mirrors.ustc.edu.cn',
    'mirrors.tuna.tsinghua.edu.cn',
    'registry.npmmirror.com',
    'dl.google.com',
    'static.rust-lang.org',
    'static.crates.io',
    'index.crates.io',
    'crates.io'
) -join ','
[Environment]::SetEnvironmentVariable('NO_PROXY', $noProxyHosts, 'User')
[Environment]::SetEnvironmentVariable('no_proxy', $noProxyHosts, 'User')
Write-Output "NO_PROXY=$([Environment]::GetEnvironmentVariable('NO_PROXY', 'User'))"

Write-Output '--- pnpm store ---'
$store = pnpm store path 2>&1
Write-Output "store=$store"
