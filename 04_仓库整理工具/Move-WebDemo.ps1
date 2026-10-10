param(
    [Parameter(Mandatory=$false)][string]$RepoPath = (Get-Location).Path,
    [switch]$Apply
)
$ErrorActionPreference = "Stop"
$repo = (Resolve-Path $RepoPath).Path
$source = Join-Path $repo "trainee-deity"
$target = Join-Path $repo "01_WebDemo"

Write-Host "Repo: $repo"
Write-Host "Mode: $(if ($Apply) {'APPLY'} else {'PREVIEW ONLY'})"
if (-not (Test-Path (Join-Path $repo ".git"))) {
    Write-Warning "当前路径没有发现 .git；请确认这是仓库根目录。"
}
if (-not (Test-Path $source)) {
    Write-Error "未找到 trainee-deity 目录。脚本不会猜测其他目录。"
}
if (Test-Path $target) {
    Write-Error "目标 01_WebDemo 已存在；为避免覆盖，已停止。"
}
Write-Host "将整体移动："
Write-Host "  $source"
Write-Host "  -> $target"
Write-Host "目录内部文件不会修改。请检查 GitHub Pages / CI 是否依赖旧路径。"
if (-not $Apply) {
    Write-Host "这是预览模式。确认备份、测试和部署路径后，添加 -Apply 执行。"
    exit 0
}
$dirty = git -C $repo status --porcelain
if ($LASTEXITCODE -ne 0) { throw "git status 执行失败" }
if ($dirty) {
    Write-Error "工作区有未提交改动。请先提交或备份，再运行 -Apply。"
}
git -C $repo mv "trainee-deity" "01_WebDemo"
if ($LASTEXITCODE -ne 0) { throw "git mv 失败" }
Write-Host "移动完成。请检查并更新根 README、CI、部署配置，然后运行 Demo 测试。"
