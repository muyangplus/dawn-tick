$ErrorActionPreference = 'Continue'
$root = 'E:\work\dsh\android-sdk'
$zip = Join-Path $root 'cmdline-tools.zip'
$url = 'https://dl.google.com/android/repository/commandlinetools-win-13114758_latest.zip'

New-Item -ItemType Directory -Force -Path $root | Out-Null

Write-Output '[1/4] download cmdline-tools'
if (-not (Test-Path $zip)) {
    Invoke-WebRequest -Uri $url -OutFile $zip -UseBasicParsing
}
Write-Output ("zip bytes = " + (Get-Item $zip).Length)

Write-Output '[2/4] extract'
$tmp = Join-Path $root 'cmdline-tools-tmp'
if (Test-Path $tmp) { Remove-Item -Recurse -Force $tmp }
Expand-Archive -Path $zip -DestinationPath $tmp -Force
$latest = Join-Path $root 'cmdline-tools\latest'
if (Test-Path $latest) { Remove-Item -Recurse -Force $latest }
New-Item -ItemType Directory -Force -Path $latest | Out-Null
Move-Item (Join-Path $tmp 'cmdline-tools\*') $latest -Force
Remove-Item -Recurse -Force $tmp

$env:JAVA_HOME = 'D:\Program Files\Microsoft\jdk-17.0.13.11-hotspot'
$sdkmanager = Join-Path $latest 'bin\sdkmanager.bat'
Write-Output ("sdkmanager = " + (Test-Path $sdkmanager))

Write-Output '[3/4] accept licenses'
$y = ('y' + [Environment]::NewLine) * 40
$y | & $sdkmanager --sdk_root=$root --licenses 2>&1 | Select-Object -Last 5

Write-Output '[4/4] install packages'
& $sdkmanager --sdk_root=$root 'platform-tools' 'platforms;android-35' 'build-tools;35.0.0' 2>&1 | Select-Object -Last 15

Write-Output 'DONE'
Write-Output ("platform-tools: " + (Test-Path (Join-Path $root 'platform-tools\adb.exe')))
Write-Output ("platforms: " + ((Get-ChildItem (Join-Path $root 'platforms') -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Name) -join ','))
Write-Output ("build-tools: " + ((Get-ChildItem (Join-Path $root 'build-tools') -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Name) -join ','))
