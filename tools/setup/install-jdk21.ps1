$ErrorActionPreference = 'Continue'
$root = 'E:\work\dsh\jdk21'
$zip = Join-Path $root 'jdk21.zip'
$url = 'https://aka.ms/download-jdk/microsoft-jdk-21.0.12-windows-x64.zip'

New-Item -ItemType Directory -Force -Path $root | Out-Null

Write-Output '[1/3] 下载 JDK 21'
if (-not (Test-Path $zip)) {
    curl.exe -L --retry 5 --retry-delay 2 --retry-all-errors -s -o $zip $url
}
if (Test-Path $zip) { Write-Output ("bytes = " + (Get-Item $zip).Length) }

Write-Output '[2/3] 解压'
$extract = Join-Path $root 'extracted'
if (Test-Path $extract) { Remove-Item -Recurse -Force $extract }
Expand-Archive -Path $zip -DestinationPath $extract -Force

Write-Output '[3/3] 定位 java'
$java = Get-ChildItem $extract -Recurse -Filter 'java.exe' -ErrorAction SilentlyContinue |
    Where-Object { $_.FullName -like '*\bin\java.exe' } |
    Select-Object -First 1
if ($null -eq $java) { Write-Output 'JAVA_NOT_FOUND'; exit 1 }
Write-Output ("JAVA_HOME=" + (Split-Path (Split-Path $java.FullName)))
& $java.FullName -version 2>&1
Write-Output 'DONE'
