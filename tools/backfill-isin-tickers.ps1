<#
.SYNOPSIS
    Calls WealthLens Hub's ISIN-as-ticker backfill endpoint and prints a summary.

.DESCRIPTION
    POSTs to /api/cron/backfill-isin-tickers with the x-cron-secret header,
    then prints how many holdings were checked/resolved/unresolved, plus a
    per-holding table. Safe to re-run any time — the endpoint only touches
    holdings whose ticker still looks like an ISIN.

.PARAMETER BaseUrl
    Defaults to your production URL. Pass -BaseUrl "http://localhost:3000"
    to hit a local dev server instead.

.PARAMETER CronSecret
    Your CRON_SECRET value. If omitted, the script tries to read it from a
    .env file in the same folder as this script (looks for a CRON_SECRET=
    line). Pass it explicitly if that lookup doesn't apply to you.

.EXAMPLE
    .\backfill-isin-tickers.ps1
    Reads CRON_SECRET from .env next to this script, hits production.

.EXAMPLE
    .\backfill-isin-tickers.ps1 -BaseUrl "http://localhost:3000" -CronSecret "abc123"
#>

param(
    [string]$BaseUrl = "https://wealthlens.pro",
    [string]$CronSecret
)

# Fall back to reading CRON_SECRET out of a local .env file if not passed explicitly.
if (-not $CronSecret) {
    $envPath = Join-Path $PSScriptRoot ".env"
    if (Test-Path $envPath) {
        $line = Get-Content $envPath | Where-Object { $_ -match '^\s*CRON_SECRET\s*=' } | Select-Object -First 1
        if ($line) {
            $CronSecret = ($line -split '=', 2)[1].Trim().Trim('"').Trim("'")
        }
    }
}

if (-not $CronSecret) {
    Write-Error "No CRON_SECRET provided and none found in a .env file next to this script. Pass -CronSecret <value> explicitly, or copy this script into your repo root where .env lives."
    exit 1
}

$uri = "$BaseUrl/api/cron/backfill-isin-tickers"
Write-Host "POST $uri" -ForegroundColor Cyan

try {
    $response = Invoke-RestMethod -Method Post -Uri $uri -Headers @{ "x-cron-secret" = $CronSecret }
} catch {
    Write-Error "Request failed: $($_.Exception.Message)"
    if ($_.ErrorDetails.Message) { Write-Host $_.ErrorDetails.Message }
    exit 1
}

Write-Host ""
Write-Host "Checked:    $($response.checked)"
Write-Host "Candidates: $($response.candidates)"
Write-Host "Resolved:   $($response.resolved)" -ForegroundColor Green
$unresolvedColor = if ($response.unresolved -gt 0) { "Yellow" } else { "Green" }
Write-Host "Unresolved: $($response.unresolved)" -ForegroundColor $unresolvedColor

if ($response.results -and $response.results.Count -gt 0) {
    Write-Host ""
    Write-Host "Details:"
    $response.results | Format-Table id, name, isin, symbol, resolved, error -AutoSize
}
