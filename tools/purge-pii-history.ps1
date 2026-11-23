<#
.SYNOPSIS
  Удаление PII из истории Git (без выполнения по умолчанию).

.DESCRIPTION
  Tier 1  — полностью удаляет из ВСЕЙ истории сырые PII-отчёты (reports/phase-01-9 raw intermediates).
  Tier 2  — дополнительно маскирует ФИО/телефоны/почты внутри артефактов каталога
            (reports/phase-01-*, analysis_package/*) во всех коммитах через --replace-text.

  Скрипт НЕ делает push. Он печатает готовые команды для force-push и требует явного -Execute.

  ВАЖНО: перезапись истории ломает все существующие клоны и параллельные сессии.
  Перед запуском: остановить других агентов/разработчиков, сделать бэкап (скрипт делает bundle).

.EXAMPLE
  pwsh tools/purge-pii-history.ps1                      # dry-run: показать план
  pwsh tools/purge-pii-history.ps1 -Tier1And2           # dry-run с Tier 2
  pwsh tools/purge-pii-history.ps1 -Execute             # выполнить Tier 1
  pwsh tools/purge-pii-history.ps1 -Tier1And2 -Execute  # выполнить Tier 1 + 2
#>
param(
  [switch]$Tier1And2,
  [switch]$Execute,
  [string]$RulesFile = "C:\Temp\pii-replacements.txt",
  [string]$BackupDir = "C:\Temp"
)

$ErrorActionPreference = "Stop"
$repo = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
Set-Location $repo

# --- raw PII reports that must disappear from history entirely -----------------
$tier1Paths = @(
  "reports/phase-01-9/darkstore_7745_gap_findings.json",
  "reports/phase-01-9/_gap_summary.txt",
  "reports/phase-01-9/_chart_candidates.txt"
)
$tier1Globs = @(
  "reports/phase-01-9/_*.txt",
  "reports/phase-01-9/*_findings.json"
)

Write-Host "=== PII history purge ===" -ForegroundColor Cyan
Write-Host "repo:        $repo"
Write-Host "tier1 paths: $($tier1Paths.Count) exact + $($tier1Globs.Count) glob(s)"
Write-Host "tier2:       $(if ($Tier1And2) { 'enabled (mask names inside catalogue artifacts)' } else { 'disabled' })"
Write-Host "rules file:  $RulesFile"
Write-Host ""

# --- preflight ----------------------------------------------------------------
if (-not (Get-Command git-filter-repo -ErrorAction SilentlyContinue)) {
  throw "git-filter-repo not found. Install: python -m pip install git-filter-repo"
}
$dirty = (git status --porcelain)
if ($dirty) {
  Write-Host "[WARN] working tree is not clean:" -ForegroundColor Yellow
  $dirty | ForEach-Object { Write-Host "   $_" }
  Write-Host "[WARN] filter-repo requires a clean tree; commit/stash first (the script will stop on -Execute)." -ForegroundColor Yellow
  Write-Host ""
}
if ($Tier1And2 -and -not (Test-Path $RulesFile)) {
  throw "rules file not found: $RulesFile (generate it with the tracker: bun C:\Temp\build-replacements.ts)"
}

# --- what will be purged ------------------------------------------------------
Write-Host "commits that contain the tier1 paths:"
foreach ($p in $tier1Paths) {
  $c = git log --oneline --all -- $p
  if ($c) { $c | ForEach-Object { Write-Host "   $_" } } else { Write-Host "   (none) $p" }
}
Write-Host ""
Write-Host "remote state: $(git rev-parse --abbrev-ref '@{upstream}' 2>$null) = $(git rev-parse '@{upstream}' 2>$null)"
Write-Host ""

# --- commands -----------------------------------------------------------------
$filterRepoArgs = @("--force", "--invert-paths")
foreach ($p in $tier1Paths) { $filterRepoArgs += @("--path", $p) }
foreach ($g in $tier1Globs) { $filterRepoArgs += @("--path-glob", $g) }

$cmd1 = "git filter-repo $($filterRepoArgs -join ' ')"
$cmd2 = "git filter-repo --force --replace-text `"$RulesFile`""

Write-Host "planned commands:" -ForegroundColor Green
Write-Host "  1) $cmd1"
if ($Tier1And2) { Write-Host "  2) $cmd2" }
Write-Host ""

if (-not $Execute) {
  Write-Host "DRY-RUN: nothing was rewritten. Add -Execute to run." -ForegroundColor Yellow
  Write-Host "After a rewrite you still need (and only after freezing all other writers):"
  Write-Host "  git push --force-with-lease origin main"
  Write-Host "  git reflog expire --expire=now --all; git gc --prune=now --aggressive"
  exit 0
}

if ($dirty) { throw "refusing -Execute while the working tree is dirty (commit or stash first)" }

# --- backup -------------------------------------------------------------------
New-Item -ItemType Directory -Force -Path $BackupDir | Out-Null
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$bundle = Join-Path $BackupDir "dds-backup-$stamp.bundle"
Write-Host "backup: git bundle create $bundle --all"
git bundle create $bundle --all | Out-Null
Write-Host "backup written: $bundle" -ForegroundColor Green

# --- rewrite ------------------------------------------------------------------
& git filter-repo @filterRepoArgs
if ($LASTEXITCODE -ne 0) { throw "filter-repo (tier1) failed with exit $LASTEXITCODE" }

if ($Tier1And2) {
  & git filter-repo --force --replace-text $RulesFile
  if ($LASTEXITCODE -ne 0) { throw "filter-repo (tier2) failed with exit $LASTEXITCODE" }
}

# --- verification -------------------------------------------------------------
Write-Host ""
Write-Host "verification:" -ForegroundColor Cyan
$still = $false
foreach ($p in $tier1Paths) {
  $hit = git log --oneline --all -- $p
  if ($hit) { $still = $true; Write-Host "   [FAIL] $p still in history" -ForegroundColor Red }
  else { Write-Host "   [ok] $p removed from all commits" }
}
if (Test-Path $RulesFile) {
  $sample = (Get-Content $RulesFile | Where-Object { $_ -and -not $_.StartsWith('#') } | Select-Object -First 200 |
    ForEach-Object { ($_ -split '==>')[0] } | Where-Object { $_ -match '\p{IsCyrillic}' } | Select-Object -First 20)
  $found = 0
  foreach ($name in $sample) {
    $r = git grep -I -l -F -- $name HEAD 2>$null
    if ($r) { $found++ }
  }
  Write-Host "   sampled $($sample.Count) names, still present in HEAD: $found"
}
Write-Host ""
Write-Host "next steps (manual, after freezing all writers):" -ForegroundColor Yellow
Write-Host "  git remote add origin git@github.com:goshva/dds.git   # filter-repo drops remotes"
Write-Host "  git push --force-with-lease origin main"
Write-Host "  git reflog expire --expire=now --all; git gc --prune=now --aggressive"
Write-Host "  NOTE: GitHub keeps unreachable objects for a while; for a guaranteed purge ask GitHub Support"
Write-Host "        or re-create the repository. Every existing clone must be re-cloned."
if ($still) { exit 1 }
