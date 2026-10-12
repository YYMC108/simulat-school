# 推送前自检 —— 一条命令确认「代码没问题 + 能连上 GitHub + 没有忘记推的东西」
#
#   pnpm preflight
#   pnpm preflight -- -SkipTests     跳过 typecheck 和单测（只想查网络时用）
#
# 加这条脚本的实际原因：这台机器到 github.com 的连接是间歇性的。
# 以前推一次代码可能失败好几次才发现是网络问题。先跑一次自检，
# 就能立刻区分「网络不通」和「代码有问题」。

param([switch]$SkipTests)

$ErrorActionPreference = 'Continue'
Set-Location (Join-Path $PSScriptRoot '..')

$script:allOk = $true

function Section($title) {
  Write-Host ""
  Write-Host "=== $title ===" -ForegroundColor Cyan
}
function Pass($msg) { Write-Host "  [ OK ]  $msg" -ForegroundColor Green }
function Fail($msg) { Write-Host "  [FAIL]  $msg" -ForegroundColor Red; $script:allOk = $false }
function Warn($msg) { Write-Host "  [WARN]  $msg" -ForegroundColor Yellow }
function Info($msg) { Write-Host "  [ -- ]  $msg" -ForegroundColor DarkGray }

Write-Host ""
Write-Host "推送前自检" -ForegroundColor White

# ---------------------------------------------------------------- 工具链
Section "工具链"
foreach ($tool in @(@('node', '-v'), @('pnpm', '-v'), @('git', '--version'))) {
  $name = $tool[0]
  $exe = Get-Command $name -ErrorAction SilentlyContinue
  if ($exe) {
    $ver = (& $name $tool[1] 2>&1 | Select-Object -First 1)
    Pass "$name $ver"
  } else {
    Fail "$name 未安装或不在 PATH 里"
  }
}

# ---------------------------------------------------------------- 代码健康
Section "代码健康"
if ($SkipTests) {
  Info "已按参数跳过（-SkipTests）"
} else {
  $tc = pnpm typecheck 2>&1 | Out-String
  if ($tc -match 'error TS') {
    Fail "typecheck 有类型错误："
    ($tc -split "`n" | Where-Object { $_ -match 'error TS' }) | ForEach-Object { Write-Host "          $_" -ForegroundColor Red }
  } else {
    Pass "typecheck 通过（零类型错误）"
  }

  $tt = pnpm test 2>&1 | Out-String
  if ($tt -match 'Tests\s+(\d+) passed') {
    $n = $Matches[1]
    if ($tt -match '(\d+) failed') { Fail "单元测试有失败（$n 通过 / $($Matches[1]) 失败）" }
    else { Pass "单元测试全部通过（$n 个）" }
  } else {
    Warn "无法从输出判断测试结果，请手动跑 pnpm test"
  }
}

# ---------------------------------------------------------------- 架构边界
# 把「文档里的规则」变成「机器执行的检查」。规则写在 docs/技术文档.md §1.1，
# 但如果没人执行就会慢慢失效 —— 所以这里自动验证。
Section "架构边界"

# 规则 1：engine 层必须是纯 TypeScript（ADR-001）
# 注意：只匹配「模块说明符」和「DOM 属性访问」，不要去搜普通单词。
# 第一版直接搜 'node:|document|window|react'，结果把 state.ts 注释里的
# 一句「等以后接 React 时」误判成违规 —— 匹配到注释是这类检查的经典假阳性。
$impure = @()
$impure += Select-String -Path "src/engine/*.ts" -Pattern "(from\s*['""]|import\s+['""])(node:|react)" -ErrorAction SilentlyContinue
$impure += Select-String -Path "src/engine/*.ts" -Pattern '\b(document|window)\s*\.' -ErrorAction SilentlyContinue
if ($impure.Count -gt 0) {
  Fail "engine 层出现了 DOM / 框架 / Node IO 依赖（违反 ADR-001）："
  $impure | ForEach-Object { Write-Host "          $($_.Filename):$($_.LineNumber)  $($_.Line.Trim())" -ForegroundColor Red }
  Info "引擎必须能脱离浏览器和 Node IO 独立运行，否则单测要跑 jsdom、也无法在 Node 里做平衡模拟"
} else {
  Pass "engine 层是纯 TypeScript（无 DOM / 框架 / Node IO 依赖）"
}

# 规则 2：依赖方向单向 —— engine 不得反向引用 data / cli / web
$reverse = Select-String -Path "src/engine/*.ts" -Pattern "from\s*['""]\.\./(data|cli|web)" -ErrorAction SilentlyContinue
if ($reverse) {
  Fail "engine 层反向引用了 data / cli / web（依赖必须单向 engine <- data <- cli/web）："
  $reverse | ForEach-Object { Write-Host "          $($_.Filename):$($_.LineNumber)  $($_.Line.Trim())" -ForegroundColor Red }
} else {
  Pass "依赖方向正确（engine 不认识 data / cli / web）"
}

# 规则 3：BOM 合规 —— .ps1 必须有，其余文本文件必须没有（见技术文档 §8.1）
$bomBad = @()
Get-ChildItem -Recurse -File -ErrorAction SilentlyContinue |
  Where-Object { $_.FullName -notmatch 'node_modules|\\\.git\\' -and $_.Extension -in @('.ts','.json','.md','.yaml','.yml','.npmrc') } |
  ForEach-Object {
    $b = [System.IO.File]::ReadAllBytes($_.FullName)
    if ($b.Length -ge 3 -and $b[0] -eq 0xEF -and $b[1] -eq 0xBB -and $b[2] -eq 0xBF) { $bomBad += $_.Name }
  }
if ($bomBad.Count -gt 0) {
  Fail "以下文件不该有 BOM（会让 JSON.parse / pnpm 直接报错）：$($bomBad -join ', ')"
} else {
  Pass "BOM 合规（文本配置/代码文件均无 BOM）"
}

# ---------------------------------------------------------------- GitHub 连接
Section "GitHub 连接"
$remoteUrl = (git remote get-url origin 2>&1 | Select-Object -First 1)
if (-not $remoteUrl -or $remoteUrl -match 'fatal') {
  Fail "没有配置名为 origin 的远程仓库"
} else {
  Info "origin = $remoteUrl"

  if ($remoteUrl -match '^git@') {
    Pass "使用 SSH 协议（本机推荐，实测 5/5 成功；HTTPS 在同机器上 0/5）"
  } elseif ($remoteUrl -match '^https://') {
    Warn "正在用 HTTPS。这台机器到 github.com:443 是间歇性阻断的，建议切换："
    Write-Host "          git remote set-url origin git@github.com:YYMC108/simulat-school.git" -ForegroundColor Yellow
  }

  # 注意：ssh -T 认证成功时退出码是 1，所以只能用输出文字判断，不能看 exit code
  $sw = Measure-Command { $sshOut = ssh -T -o BatchMode=yes -o ConnectTimeout=20 git@github.com 2>&1 | Out-String }
  $secs = [math]::Round($sw.TotalSeconds, 1)

  if ($sshOut -match 'Hi ([^!]+)!') {
    Pass "SSH 认证成功，身份 $($Matches[1])（耗时 ${secs}s）"
  } elseif ($sshOut -match 'Permission denied \(publickey\)') {
    Fail "SSH 握手成功但密钥未被承认（耗时 ${secs}s）"
    Info "把下面这个公钥加到 https://github.com/settings/ssh/new ："
    $pubFile = "$env:USERPROFILE\.ssh\id_ed25519_github.pub"
    if (Test-Path $pubFile) { Write-Host "          $([System.IO.File]::ReadAllText($pubFile).Trim())" -ForegroundColor Yellow }
  } else {
    Fail "SSH 连不上 GitHub（耗时 ${secs}s）"
    Info "多半是网络问题。先确认代理/网络，再重试。输出：$($sshOut.Trim())"
  }
}

# ---------------------------------------------------------------- 工作区状态
Section "工作区状态"
$dirty = git status --porcelain 2>&1
if ($dirty) {
  $count = ($dirty | Measure-Object).Count
  Warn "有 $count 个文件未提交："
  $dirty | Select-Object -First 10 | ForEach-Object { Write-Host "          $_" -ForegroundColor Yellow }
  if ($count -gt 10) { Write-Host "          ...还有 $($count - 10) 个" -ForegroundColor Yellow }
  Info "提交：git add -A ; git commit -m `"说明`""
} else {
  Pass "工作区干净，没有未提交的改动"
}

$upstream = git rev-parse --abbrev-ref '@{u}' 2>&1
if ($upstream -match 'fatal|no upstream') {
  Warn "当前分支没有上游分支，首次推送需要：git push -u origin main"
} else {
  $ahead = git rev-list --count '@{u}..HEAD' 2>&1
  if ($ahead -match '^\d+$' -and [int]$ahead -gt 0) {
    Warn "有 $ahead 个提交还没推送到 $upstream"
    Info "推送：git push"
  } else {
    Pass "本地与 $upstream 同步（没有未推送的提交）"
  }
}

# ---------------------------------------------------------------- 总结
Write-Host ""
if ($script:allOk) {
  Write-Host "结论：全部通过，可以推送。" -ForegroundColor Green
} else {
  Write-Host "结论：有项目未通过，先按上面的提示修好再推。" -ForegroundColor Red
}
Write-Host ""
exit $(if ($script:allOk) { 0 } else { 1 })
