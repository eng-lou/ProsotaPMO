# Publish only the reviewed web release; preserve unrelated working files.
$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $repoRoot
$expectedBase = 'b5007f2589cf604ad8e6c240ac4ebc3c6bd08e19'
$commitMessage = 'Fit equipment paths and visibility to assigned activities'
$files = [ordered]@{
    'backend/app/schemas/site_scene.py' = '2A58C0C42DAA4FE9C9211D5C7701B6B50A8BA35AA3593B199225E129F6F500A0'
    'docs/LEARNING_LOG.md' = '02E721DD9F54DF859F602DCFC865E9B847664513217210B7B12295ADA257FC97'
    'frontend/src/modules/fourD/FourD.tsx' = '17CBA3DF5D20815FD3E4D9F2B25C9D7A3B6DF81BB4839948F40298C2569CD76B'
    'frontend/src/modules/fourD/SitePathBindings.tsx' = 'FB2EBF3C903E88F5E7E85124DACE2051252BD3ADA8C2A3805E38ABF4F132C75B'
    'frontend/src/modules/fourD/SiteSceneLayer.tsx' = 'C1597FB8C702A723BC9D9A97048A83A7FBC3D6DE6754580490B89A16F4F0B398'
    'frontend/src/modules/fourD/sitePathMotion.ts' = 'D30C1273081E27FBBC398E598CEA3C77A392A5C956B506320FA51802CEFFEB4A'
    'frontend/src/modules/fourD/siteScene.ts' = '77166B05B6DE5249E9AA803646EE2D6FE8FD8F67A9B22A07457EC76615C22C18'
    'frontend/tests/sitePathMotion.test.mjs' = '2B3CE5A306E2B65F8B85DEF2B0A427758500657ABF481AC7FCF6B0AEC72192CC'
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
    $paths = @($files.Keys) + 'scripts/publish-activity-path-timing.ps1'
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
Write-Host 'Activity path timing pushed to main; verify backend and frontend deployments.'
