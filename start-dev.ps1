# 瑾瑜（jinyu）一键启动脚本
# 用法：在项目目录运行  .\start-dev.ps1
# 流程：检查依赖 -> 检查 9000 端口占用（可选清理旧进程）-> 启动 dev server
# 登录账号见 .env.local（默认 jinyu / change-me）

$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

# 1. 依赖检查：node_modules 不存在则安装
if (-not (Test-Path "node_modules")) {
    Write-Host "首次运行，正在安装依赖（pnpm install）…" -ForegroundColor Cyan
    pnpm install
    if ($LASTEXITCODE -ne 0) {
        Write-Host "依赖安装失败，请检查 pnpm / 网络。" -ForegroundColor Red
        exit 1
    }
}

# 2. 环境配置提示：缺 .env.local 时 LLM 走 Fake 回退
if (-not (Test-Path ".env.local")) {
    Write-Host "提示：未找到 .env.local，LLM 将回退 Fake。首次配置请复制 .env.example 并填入 LLM_API_KEY。" -ForegroundColor Yellow
}

# 3. 端口检查：9000 被占用时提示清理（旧 dev server 不会加载新配置/新代码）
$port = 9000
$listeners = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
if ($listeners) {
    $pids = $listeners | Select-Object -ExpandProperty OwningProcess -Unique
    Write-Host "端口 $port 已被占用（PID: $($pids -join ', ')）。旧进程不会加载最新配置/代码，建议结束。" -ForegroundColor Yellow
    $ans = Read-Host "结束这些进程后启动？(y/N)"
    if ($ans -match "^[yY]") {
        foreach ($p in $pids) { Stop-Process -Id $p -Force }
        Start-Sleep -Milliseconds 500
        Write-Host "已结束旧进程。" -ForegroundColor Green
    } else {
        Write-Host "保留现有进程，继续启动（可能端口冲突）。" -ForegroundColor Cyan
    }
}

# 4. 启动 dev server
Write-Host "启动中：http://localhost:$port （Ctrl+C 停止）" -ForegroundColor Green
pnpm dev
