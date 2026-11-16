# Publish only the reviewed web release; preserve unrelated working files.
$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $repoRoot
$expectedBase = '12c1989620c8c98de2ce319d4afb419153e15358'
$commitMessage = 'Preserve temporary equipment appearance and activity lifetime'
$files = [ordered]@{
    'docs/LEARNING_LOG.md' = 'A522EA8CE543605147B7FB5C33E106DC33D3D134791CE1B79768EF4AF260CA69'
    'frontend/src/modules/fourD/SitePathBindings.tsx' = '120422C1F75377C0A50A230AA6815F8C7226334B9F26F808707BBCFEAF96F607'
    'frontend/src/modules/fourD/SiteSceneLayer.tsx' = '590A86F4FB86339A6BD4609B56CDFAE21436589FA8B25E10A1DF1688C6C6256E'
    'frontend/src/modules/fourD/siteAnimationRender.ts' = 'FFC3987433A66C89E370E5CC5A0045E2BB95C6EF0AC274DB2EB041C1D875A5E1'
    'frontend/src/modules/fourD/useSiteAnimation.ts' = '715D8BF4AB328D7C84E070B7F23858697EC08E577159EC4F54DF448747DC8A9F'
    'frontend/tests/siteAnimation.test.mjs' = '6CE2A453C3DA8DF71752BE2ADDD7462315240E4DB4B48D7FAFD5570066048D51'
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
    $paths = @($files.Keys) + 'scripts/publish-temporary-equipment.ps1'
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
Write-Host 'Temporary equipment fix pushed to main; verify web deployment.'
