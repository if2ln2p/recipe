# recipes/ 안의 .md 파일 목록을 recipes/index.json 매니페스트로 생성한다.
# 사용법 (Windows PowerShell): powershell -ExecutionPolicy Bypass -File .\gen-manifest.ps1
$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$recipesDir = Join-Path $scriptDir "recipes"
$outFile = Join-Path $recipesDir "index.json"

if (-not (Test-Path $recipesDir)) {
    Write-Error "recipes 디렉터리를 찾을 수 없습니다: $recipesDir"
    exit 1
}

$files = @(Get-ChildItem -Path $recipesDir -Filter "*.md" -File | Sort-Object Name | ForEach-Object { $_.Name })

$lines = New-Object System.Collections.Generic.List[string]
$lines.Add("[")
for ($i = 0; $i -lt $files.Count; $i++) {
    $escaped = $files[$i] -replace '\\', '\\\\' -replace '"', '\"'
    $suffix = if ($i -lt $files.Count - 1) { "," } else { "" }
    $lines.Add("  `"$escaped`"$suffix")
}
$lines.Add("]")
$content = ($lines -join "`n") + "`n"

$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($outFile, $content, $utf8NoBom)

Write-Host "매니페스트 생성 완료: $outFile ($($files.Count)개 파일)"
