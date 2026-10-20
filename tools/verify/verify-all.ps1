#requires -Version 5.1
$ErrorActionPreference = 'Continue'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$env:PYTHONIOENCODING = 'utf-8'

$repo = $env:DSH_REPO_ROOT
if ([string]::IsNullOrEmpty($repo)) { $repo = 'E:\work\dsh\dawn-tick' }
Set-Location $repo

$script:pass = 0
$script:fail = 0
$script:skip = 0

function Section([string]$name) {
    Write-Host ''
    Write-Host "== $name ==" -ForegroundColor Cyan
}

function Report([string]$status, [string]$name, [string]$detail) {
    switch ($status) {
        'PASS' { $script:pass++; Write-Host ("[PASS] {0}  {1}" -f $name, $detail) -ForegroundColor Green }
        'FAIL' { $script:fail++; Write-Host ("[FAIL] {0}  {1}" -f $name, $detail) -ForegroundColor Red }
        default { $script:skip++; Write-Host ("[SKIP] {0}  {1}" -f $name, $detail) -ForegroundColor Yellow }
    }
}

function Run-Check([string]$name, [scriptblock]$body) {
    try {
        $detail = & $body
        if ([string]::IsNullOrEmpty($detail)) { $detail = 'ok' }
        Report 'PASS' $name $detail
    } catch {
        Report 'FAIL' $name $_.Exception.Message
    }
}

Section '1. core 单元测试'
Run-Check 'core 测试与校验' {
    $out = pnpm -C packages/core test 2>&1 | Out-String
    if ($LASTEXITCODE -ne 0) { throw "exit=$LASTEXITCODE" }
    $tests = ([regex]::Match($out, 'tests (\d+)')).Groups[1].Value
    $pass = ([regex]::Match($out, 'pass (\d+)')).Groups[1].Value
    $failCount = ([regex]::Match($out, 'fail (\d+)')).Groups[1].Value
    if ([int]$failCount -ne 0) { throw "fail=$failCount" }
    "tests=$tests pass=$pass fail=$failCount"
}

Section '2. web 单元测试'
Run-Check 'web 测试' {
    $out = pnpm -C apps/web test 2>&1 | Out-String
    if ($LASTEXITCODE -ne 0) { throw "exit=$LASTEXITCODE" }
    $tests = ([regex]::Match($out, 'tests (\d+)')).Groups[1].Value
    $pass = ([regex]::Match($out, 'pass (\d+)')).Groups[1].Value
    $failCount = ([regex]::Match($out, 'fail (\d+)')).Groups[1].Value
    if ([int]$failCount -ne 0) { throw "fail=$failCount" }
    "tests=$tests pass=$pass fail=$failCount"
}

Section '3. 类型检查'
Run-Check 'workspace typecheck' {
    pnpm typecheck 2>&1 | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "exit=$LASTEXITCODE" }
    'no errors'
}

Section '4. 数据模型跨引擎校验'
Run-Check 'schema-check (Python)' {
    $out = python tools/schema-check/validate_schema.py 2>&1 | Out-String
    if ($LASTEXITCODE -ne 0) { throw "exit=$LASTEXITCODE`n$out" }
    ($out.Trim() -split "`n" | Select-Object -Last 1)
}
Run-Check '工作流语法与触发' {
    $out = python tools/verify/check-workflows.py 2>&1 | Out-String
    if ($LASTEXITCODE -ne 0) { throw "exit=$LASTEXITCODE`n$out" }
    ($out.Trim() -split "`n" | Select-Object -Last 1)
}
Run-Check '小组件快照契约（TS↔Kotlin）' {
    $out = node tools/verify/check-widget-contract.mjs 2>&1 | Out-String
    if ($LASTEXITCODE -ne 0) { throw "exit=$LASTEXITCODE`n$out" }
    ($out.Trim() -split "`n" | Select-Object -Last 1)
}
Run-Check '第三方许可证清单一致' {
    $out = node tools/legal/collect-licenses.mjs --check 2>&1 | Out-String
    if ($LASTEXITCODE -ne 0) { throw "exit=$LASTEXITCODE`n$out" }
    ($out.Trim() -split "`n" | Select-Object -Last 1)
}
Run-Check '变更日志结构' {
    $out = node tools/release/changelog.mjs --check 2>&1 | Out-String
    if ($LASTEXITCODE -ne 0) { throw "exit=$LASTEXITCODE`n$out" }
    ($out.Trim() -split "`n" | Select-Object -Last 1)
}

Section '5. 设计令牌与无障碍'
Run-Check '对比度与触控尺寸' {
    $out = node tools/design/check-a11y.mjs 2>&1 | Out-String
    if ($LASTEXITCODE -ne 0) { throw "exit=$LASTEXITCODE`n$out" }
    (($out.Trim() -split "`n") | Select-Object -First 1)
}
Run-Check '令牌与样式一致' {
    $out = node --test tools/design/check-a11y.test.mjs 2>&1 | Out-String
    if ($LASTEXITCODE -ne 0) { throw "exit=$LASTEXITCODE" }
    $pass = ([regex]::Match($out, 'pass (\d+)')).Groups[1].Value
    "pass=$pass"
}

Section '6. Web 构建产物'
Run-Check 'web 构建与双入口' {
    pnpm -C apps/web build 2>&1 | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "exit=$LASTEXITCODE" }
    $dist = Join-Path $repo 'apps/web/dist'
    foreach ($file in 'index.html', 'mini.html') {
        if (-not (Test-Path (Join-Path $dist $file))) { throw "$file 缺失" }
    }
    $main = Get-ChildItem (Join-Path $dist 'assets') -Filter '*.js' | Sort-Object Length -Descending | Select-Object -First 1
    "index.html + mini.html，最大分包 $([math]::Round($main.Length / 1KB, 1)) KB"
}
Run-Check '界面冒烟（jsdom 渲染与切页）' {
    $out = node tools/verify/smoke-ui.mjs 2>&1 | Out-String
    if ($LASTEXITCODE -ne 0) { throw "exit=$LASTEXITCODE`n$out" }
    (($out.Trim() -split "`n") | Select-Object -Last 1)
}

Section '7. Windows 产物'
$exe = Join-Path $repo 'apps/desktop/src-tauri/target/release/dawn-tick-desktop.exe'
if (Test-Path $exe) {
    Report 'PASS' 'Windows exe' "$([math]::Round((Get-Item $exe).Length / 1MB, 2)) MB"
} else {
    Report 'SKIP' 'Windows exe' '未构建，运行 pnpm -C apps/desktop exec tauri build --no-bundle'
}
$installers = Get-ChildItem (Join-Path $repo 'apps/desktop/src-tauri/target/release/bundle/nsis') -Filter '*setup.exe' -ErrorAction SilentlyContinue
if ($installers) {
    $installer = $installers | Select-Object -First 1
    Report 'PASS' 'Windows 安装包' "$($installer.Name) $([math]::Round($installer.Length / 1MB, 2)) MB"
} else {
    Report 'SKIP' 'Windows 安装包' '未构建，需设置 TAURI_BUNDLER_TOOLS_GITHUB_MIRROR 后运行 tauri build'
}

Section '8. Android 产物'
$apk = Join-Path $repo 'apps/mobile/android/app/build/outputs/apk/debug/app-debug.apk'
if (-not (Test-Path $apk)) {
    Report 'SKIP' 'Android APK' '未构建，运行 gradlew assembleDebug'
} else {
    Report 'PASS' 'Android APK' "$([math]::Round((Get-Item $apk).Length / 1MB, 2)) MB"
    Run-Check 'APK 小组件类' {
        Add-Type -AssemblyName System.IO.Compression.FileSystem
        $zip = [System.IO.Compression.ZipFile]::OpenRead($apk)
        $wanted = @(
            'com/dawntick/app/widget/NextLessonWidget',
            'com/dawntick/app/widget/TodayWidget',
            'com/dawntick/app/widget/WeekOverviewWidget',
            'com/dawntick/app/widget/ExamCountdownWidget',
            'com/dawntick/app/widget/WidgetRefreshReceiver',
            'com/dawntick/app/widget/WidgetRefresher',
            'com/dawntick/app/widget/WidgetRefreshPlugin',
            'com/dawntick/app/widget/WidgetPinPlugin',
            'com/dawntick/app/widget/WidgetPinResultReceiver',
            'com/dawntick/app/widget/WidgetStore',
            'com/dawntick/app/widget/WidgetRenderer'
        )
        $found = New-Object System.Collections.Generic.HashSet[string]
        foreach ($entry in ($zip.Entries | Where-Object { $_.FullName -like '*.dex' })) {
            $stream = $entry.Open()
            $memory = New-Object System.IO.MemoryStream
            $stream.CopyTo($memory)
            $text = [System.Text.Encoding]::ASCII.GetString($memory.ToArray())
            foreach ($name in $wanted) { if ($text.Contains($name)) { [void]$found.Add($name) } }
            $memory.Dispose()
            $stream.Dispose()
        }
        $zip.Dispose()
        if ($found.Count -ne $wanted.Count) {
            throw "缺少小组件类: $((($wanted | Where-Object { -not $found.Contains($_) }) -join ', '))"
        }
        "$($found.Count) 个类全部在 dex 中"
    }
    Run-Check 'APK 小组件声明与权限' {
        $aapt2 = 'E:\work\dsh\android-sdk\build-tools\35.0.0\aapt2.exe'
        if (-not (Test-Path $aapt2)) { throw "aapt2 未找到: $aapt2" }
        $dump = & $aapt2 dump xmltree --file AndroidManifest.xml $apk 2>&1 | Out-String
        $required = @(
            'com.dawntick.app.widget.NextLessonWidget',
            'com.dawntick.app.widget.TodayWidget',
            'com.dawntick.app.widget.WeekOverviewWidget',
            'com.dawntick.app.widget.ExamCountdownWidget',
            'com.dawntick.app.widget.WidgetRefreshReceiver',
            'com.dawntick.app.widget.WidgetPinResultReceiver',
            'android.appwidget.action.APPWIDGET_UPDATE',
            'android.intent.action.USER_PRESENT',
            'android.permission.POST_NOTIFICATIONS',
            'android.permission.USE_EXACT_ALARM'
        )
        foreach ($item in $required) {
            if (-not $dump.Contains($item)) { throw "清单缺少 $item" }
        }
        'receiver 与权限声明齐全'
    }
    Run-Check 'APK 前端资源' {
        Add-Type -AssemblyName System.IO.Compression.FileSystem
        $zip = [System.IO.Compression.ZipFile]::OpenRead($apk)
        $names = $zip.Entries | ForEach-Object { $_.FullName }
        $zip.Dispose()
        foreach ($item in 'assets/public/index.html', 'assets/public/mini.html') {
            if ($names -notcontains $item) { throw "APK 内缺少 $item" }
        }
        'index.html 与 mini.html 已入包'
    }
}

Section '9. Rust 壳'
$cargo = Join-Path $env:USERPROFILE '.cargo\bin\cargo.exe'
if (-not (Test-Path $cargo)) {
    Report 'SKIP' 'cargo check' 'cargo 未找到'
} else {
    Run-Check 'cargo check --all-targets' {
        $env:PATH = "$(Join-Path $env:USERPROFILE '.cargo\bin');$env:PATH"
        Push-Location (Join-Path $repo 'apps/desktop/src-tauri')
        $out = & $cargo check --all-targets 2>&1 | Out-String
        $code = $LASTEXITCODE
        Pop-Location
        if ($code -ne 0) { throw "exit=$code" }
        'compiles'
    }
    Run-Check 'cargo test（DDL 校验）' {
        $env:PATH = "$(Join-Path $env:USERPROFILE '.cargo\bin');$env:PATH"
        Push-Location (Join-Path $repo 'apps/desktop/src-tauri')
        $out = & $cargo test 2>&1 | Out-String
        $code = $LASTEXITCODE
        Pop-Location
        if ($code -ne 0) { throw "exit=$code" }
        $matched = [regex]::Matches($out, 'test result: ok\. (\d+) passed')
        $total = 0
        foreach ($match in $matched) { $total += [int]$match.Groups[1].Value }
        "passed=$total"
    }
}

Write-Host ''
Write-Host ("===== 汇总: PASS {0} / FAIL {1} / SKIP {2} =====" -f $script:pass, $script:fail, $script:skip) -ForegroundColor Cyan
if ($script:fail -gt 0) { exit 1 }
exit 0
