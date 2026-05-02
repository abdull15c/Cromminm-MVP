# Dumps project source for LLM / review (no node_modules, no dist, no dist_electron)
$ErrorActionPreference = "Stop"
$Root = Split-Path $PSScriptRoot -Parent
if (-not (Test-Path (Join-Path $Root "package.json"))) {
  $Root = "c:\Users\abdulla\Desktop\crom"
}
$OutDir = Join-Path $Root "artifacts"
$OutFile = Join-Path $OutDir "code_dump.txt"
$ModuleFile = Join-Path $OutDir "modules_dump.txt"
$MaxJsonBytes = 2 * 1024 * 1024

New-Item -ItemType Directory -Path $OutDir -Force | Out-Null

$ts = Get-Date -Format "yyyy-MM-dd HH:mm:ss K"
$header = @"
================================================================================
CROM / CROMMINM - code dump for analysis
Generated: $ts
Root: $Root
Includes: desktop/src, desktop/electron, local-api/src, automation, shared, configs
Excludes: node_modules, dist, dist_electron, output, .git
================================================================================

"@

[System.IO.File]::WriteAllText($OutFile, $header, [System.Text.UTF8Encoding]::new($false))

function Add-Section {
  param([string]$Title)
  $sep = [Environment]::NewLine + ("=" * 78) + [Environment]::NewLine + "FILE: $Title" + [Environment]::NewLine + ("=" * 78) + [Environment]::NewLine
  Add-Content -LiteralPath $OutFile -Value $sep -Encoding utf8
}

function Add-FileContent {
  param([string]$RelativePath)
  $full = Join-Path $Root ($RelativePath -replace '/', '\')
  if (-not (Test-Path -LiteralPath $full -PathType Leaf)) { return }
  Add-Section $RelativePath
  $raw = Get-Content -LiteralPath $full -Raw -Encoding utf8
  Add-Content -LiteralPath $OutFile -Value $raw -Encoding utf8
}

foreach ($f in @("package.json", "README.md", ".env.example", ".gitignore")) {
  Add-FileContent $f
}

foreach ($f in @(
    "desktop/package.json",
    "desktop/tsconfig.json",
    "desktop/tsconfig.app.json",
    "desktop/tsconfig.node.json",
    "desktop/vite.config.ts",
    "desktop/index.html",
    "desktop/electron/main.cjs",
    "local-api/package.json",
    "local-api/tsconfig.json"
  )) {
  Add-FileContent $f
}

$globs = @(
  @{ Path = "desktop\src"; Ext = @("*.ts", "*.tsx", "*.css") },
  @{ Path = "local-api\src"; Ext = @("*.ts") },
  @{ Path = "automation"; Ext = @("*.mjs") }
)

foreach ($g in $globs) {
  $base = Join-Path $Root $g.Path
  if (-not (Test-Path -LiteralPath $base)) { continue }
  foreach ($pattern in $g.Ext) {
    Get-ChildItem -LiteralPath $base -Recurse -File -Filter $pattern -ErrorAction SilentlyContinue | ForEach-Object {
      $rel = $_.FullName.Substring($Root.Length).TrimStart('\')
      $rel = $rel -replace '\\', '/'
      Add-FileContent $rel
    }
  }
}

$sharedJson = Join-Path $Root "shared\fingerprints.json"
if (Test-Path -LiteralPath $sharedJson) {
  $len = (Get-Item -LiteralPath $sharedJson).Length
  if ($len -le $MaxJsonBytes) {
    Add-FileContent "shared/fingerprints.json"
  }
  else {
    Add-Section ("shared/fingerprints.json [TRUNCATED " + $len + " bytes]")
    $lines = Get-Content -LiteralPath $sharedJson -TotalCount 200 -Encoding utf8
    Add-Content -LiteralPath $OutFile -Value (($lines -join [Environment]::NewLine) + [Environment]::NewLine + "... truncated ...") -Encoding utf8
  }
}

$coreReadme = Join-Path $Root "CromminmCore\README.md"
if (Test-Path -LiteralPath $coreReadme) {
  Add-FileContent "CromminmCore/README.md"
}

$summaryHeader = @"
================================================================================
code_dump.txt summary
================================================================================
"@
Set-Content -LiteralPath $ModuleFile -Value $summaryHeader -Encoding utf8
Get-Item -LiteralPath $OutFile | Format-List FullName, Length, LastWriteTime | Out-String | Add-Content -LiteralPath $ModuleFile -Encoding utf8
Add-Content -LiteralPath $ModuleFile -Value "`n--- desktop/src tree ---`n" -Encoding utf8
cmd /c "tree /F /A `"$(Join-Path $Root 'desktop\src')`"" 2>$null | Out-String | Add-Content -LiteralPath $ModuleFile -Encoding utf8
Add-Content -LiteralPath $ModuleFile -Value "`n--- local-api/src tree ---`n" -Encoding utf8
cmd /c "tree /F /A `"$(Join-Path $Root 'local-api\src')`"" 2>$null | Out-String | Add-Content -LiteralPath $ModuleFile -Encoding utf8

$b = (Get-Item -LiteralPath $OutFile).Length
Write-Host ('Wrote: ' + $OutFile + ' (' + $b + ' bytes)')
Write-Host ('Wrote: ' + $ModuleFile)
