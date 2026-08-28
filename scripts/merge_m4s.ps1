# 合并 B站下载的 m4s（视频+音频）为 MP4
# 用法：把「文件夹」或「其中一个 m4s 文件」拖到 merge.bat 上
param([string]$Target = $PWD.Path)

$ErrorActionPreference = 'Stop'
$Host.UI.RawUI.WindowTitle = 'B站 m4s 合并工具'

# ---------- 1. 定位 ffmpeg（PATH 可能是旧的，多路兜底） ----------
function Find-Ffmpeg {
    # 先刷新 PATH（注册表最新值），再找命令
    $env:Path = [Environment]::GetEnvironmentVariable('Path', 'User') + ';' + [Environment]::GetEnvironmentVariable('Path', 'Machine')
    $cmd = Get-Command ffmpeg -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }

    # 兜底：逐个检查已知安装位置
    $candidates = @(
        "$env:LOCALAPPDATA\Microsoft\WinGet\Links\ffmpeg.exe",
        "$env:LOCALAPPDATA\Microsoft\WinGet\Packages\Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe\ffmpeg-9.0-full_build\bin\ffmpeg.exe",
        "C:\ffmpeg\bin\ffmpeg.exe",
        "C:\Program Files\ffmpeg\bin\ffmpeg.exe"
    )
    foreach ($c in $candidates) {
        if (Test-Path $c) { return $c }
    }
    # 最后：在 WinGet Packages 下递归搜（较慢但万无一失）
    $found = Get-ChildItem "$env:LOCALAPPDATA\Microsoft\WinGet\Packages" -Recurse -Filter "ffmpeg.exe" -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($found) { return $found.FullName }
    return $null
}

$ffmpeg = Find-Ffmpeg
if (-not $ffmpeg) {
    Write-Host "❌ 找不到 ffmpeg，请告诉 Claude 重新安装 ffmpeg" -ForegroundColor Red
    Read-Host "按回车退出"
    exit 1
}
Write-Host "✅ 使用 ffmpeg: $ffmpeg" -ForegroundColor DarkGray

# ---------- 2. 确定目标文件夹 ----------
if (Test-Path $Target -PathType Container) {
    $Folder = $Target
} elseif (Test-Path $Target -PathType Leaf) {
    $Folder = Split-Path $Target -Parent
} else {
    $Folder = $PWD.Path
}
Write-Host "📂 目标文件夹: $Folder"

# ---------- 3. 找 m4s 文件（找不到就查一层子目录） ----------
$files = @(Get-ChildItem -Path $Folder -Filter *.m4s -File -ErrorAction SilentlyContinue)
if ($files.Count -lt 2) {
    $sub = Get-ChildItem -Path $Folder -Directory -ErrorAction SilentlyContinue |
        Where-Object { @(Get-ChildItem $_.FullName -Filter *.m4s -File -ErrorAction SilentlyContinue).Count -ge 2 } |
        Select-Object -First 1
    if ($sub) {
        Write-Host "ℹ️ 在子文件夹找到 m4s: $($sub.Name)"
        $Folder = $sub.FullName
        $files = @(Get-ChildItem -Path $Folder -Filter *.m4s -File)
    }
}
if ($files.Count -lt 2) {
    Write-Host "❌ 没有找到两个 m4s 文件（需要视频+音频在同一文件夹）" -ForegroundColor Red
    Write-Host "   当前文件夹: $Folder"
    Write-Host "   提示：B站客户端下载的视频在「下载目录\up主名\视频名\」下面，"
    Write-Host "        文件夹里应有 video.m4s 和 audio.m4s 两个文件"
    Read-Host "按回车退出"
    exit 1
}

# 优先按文件名识别，识别不了按体积判断（大的是视频）
$video = $files | Where-Object { $_.BaseName -match 'video|视频' } | Select-Object -First 1
$audio = $files | Where-Object { $_.BaseName -match 'audio|音频' } | Select-Object -First 1
if (-not $video -or -not $audio) {
    $sorted = $files | Sort-Object Length -Descending
    if (-not $video) { $video = $sorted[0] }
    if (-not $audio) { $audio = $sorted[1] }
}

Write-Host "📹 视频: $($video.Name) ($([math]::Round($video.Length/1MB,1)) MB)"
Write-Host "🔊 音频: $($audio.Name) ($([math]::Round($audio.Length/1MB,1)) MB)"

# ---------- 4. 合并 ----------
$out = Join-Path $Folder "合并输出.mp4"
if (Test-Path $out) { Remove-Item $out -Force }
Write-Host "🔄 合并中（无损复制，几秒钟）..."
& $ffmpeg -y -i $video.FullName -i $audio.FullName -c copy $out 2>&1 | ForEach-Object { "$_" }
if ($LASTEXITCODE -eq 0 -and (Test-Path $out)) {
    $size = [math]::Round((Get-Item $out).Length / 1MB, 1)
    Write-Host ""
    Write-Host "✅ 合并成功！" -ForegroundColor Green
    Write-Host "   输出文件: $out ($size MB)" -ForegroundColor Green
} else {
    Write-Host ""
    Write-Host "❌ 合并失败，请把上面窗口里的错误信息截图发给 Claude" -ForegroundColor Red
}
Read-Host "按回车关闭窗口"
