$ErrorActionPreference = 'Continue'
$env:RUSTUP_DIST_SERVER = 'https://mirrors.tuna.tsinghua.edu.cn/rustup'
$env:RUSTUP_UPDATE_ROOT = 'https://mirrors.tuna.tsinghua.edu.cn/rustup/rustup'
$dir = 'E:\work\dsh\rustup'
$exe = Join-Path $dir 'rustup-init.exe'

New-Item -ItemType Directory -Force -Path $dir | Out-Null
New-Item -ItemType Directory -Force -Path 'E:\work\dsh\cargo-home' | Out-Null

Write-Output '[1/2] download rustup-init'
Invoke-WebRequest -Uri 'https://static.rust-lang.org/rustup/dist/x86_64-pc-windows-msvc/rustup-init.exe' -OutFile $exe -UseBasicParsing
Write-Output ("bytes = " + (Get-Item $exe).Length)

Write-Output '[2/2] install stable msvc toolchain'
& $exe -y --default-toolchain stable-x86_64-pc-windows-msvc --profile minimal 2>&1 | Select-Object -Last 20

Write-Output 'DONE'
$cargo = Join-Path $env:USERPROFILE '.cargo\bin\cargo.exe'
Write-Output ("cargo exists: " + (Test-Path $cargo))
if (Test-Path $cargo) { & $cargo --version 2>&1 }
$rustc = Join-Path $env:USERPROFILE '.cargo\bin\rustc.exe'
if (Test-Path $rustc) { & $rustc --version 2>&1 }
