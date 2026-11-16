# Publish only the reviewed web release; preserve unrelated working files.
$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $repoRoot
$expectedBase = '23f819777e90802defbe7a9b765561451083c092'
$commitMessage = 'Add activities inside selection and drag between WBS groups'
$files = [ordered]@{
    'backend/app/api/activities.py' = '20F3C0E49EF6B6AB8732C64A8F65A6BC2C895ECFFC8359820A977B443C5C8EEA'
    'backend/app/schemas/activity.py' = 'AC6614B77844C47B3BC7505EF491B52F11E552D5135A8F71489E429DD1B37D30'
    'backend/app/services/activity.py' = 'F3271FBAEB6C457B700277914E36F1BB9BCDD2767D02BF99A3C65344F574B71B'
    'backend/tests/test_activities.py' = '002637455E6752C6F8029D5A5726CA5E155DAA5559D48392149E30F68ADF8B68'
    'docs/LEARNING_LOG.md' = 'D745BF2577DD8AC37C0221DB39506517109C4B6201BE1CECE05E71D963705C82'
    'frontend/src/modules/scheduling/Scheduling.tsx' = '95B33D189BFCB68450836FF49B4E2D70539E47706F8A962AF7C123FE55225E28'
}
foreach ($entry in $files.GetEnumerator()) {
    $actual = (Get-FileHash -LiteralPath (Join-Path $repoRoot $entry.Key) -Algorithm SHA256).Hash
    if ($actual -ne $entry.Value) { throw "File changed since validation: $($entry.Key). Stop and review before publishing." }
}
$current = (& git rev-parse HEAD).Trim()
if ($LASTEXITCODE -ne 0) { throw 'Cannot read the release branch.' }
$alreadyStaged = @(& git diff --cached --name-only)
if ($LASTEXITCODE -ne 0) { throw 'Cannot inspect the index.' }
if ($alreadyStaged.Count -gt 0) { throw 'There are already staged files. Review them before running this publisher.' }
if ($current -eq $expectedBase) {
    $paths = @($files.Keys) + 'scripts/publish-wbs-workflow.ps1'
    & git add -- $paths
    if ($LASTEXITCODE -ne 0) { throw 'Staging failed. Nothing was pushed.' }
    & git commit -m $commitMessage
    if ($LASTEXITCODE -ne 0) { throw 'Commit failed. Review the staged release before continuing.' }
} else {
    $subject = (& git log -1 --format=%s).Trim()
    if ($LASTEXITCODE -ne 0 -or $subject -ne $commitMessage) { throw 'This branch has changed. Review it before publishing.' }
    & git diff --quiet HEAD -- @($files.Keys)
    if ($LASTEXITCODE -ne 0) { throw 'The working release differs from its commit. Stop and review.' }
}
& git fetch origin
if ($LASTEXITCODE -ne 0) { throw 'Fetch failed. The local commit is retained; rerun when connected.' }
& git merge-base --is-ancestor origin/main HEAD
if ($LASTEXITCODE -ne 0) { throw 'Remote main has newer changes. The release is committed locally; integrate those changes before pushing. No force push was attempted.' }
& git push origin HEAD:main
if ($LASTEXITCODE -ne 0) { throw 'Push failed. The local commit is retained; no remote history was overwritten.' }
Write-Host 'WBS workflow changes pushed to main; verify both backend and frontend deployments.'
