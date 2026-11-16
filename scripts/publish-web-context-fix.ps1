# Publish only the reviewed web release; preserve unrelated working files.
$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $repoRoot
$expectedBase = 'db713b518f0fe3707ecee0085b65a80bbf62c3c5'
$commitMessage = 'Recover WebGL startup failures without losing the workspace'
$files = [ordered]@{
    'docs/LEARNING_LOG.md' = '27D016456E9B00712681313DA67A8C7448A38DF9581B64881FFAFB1273144CEE'
    'frontend/package.json' = '4F30419791C546EC18EC9522790DD7AAC88F3C696F89929420AF039D5073FA84'
    'frontend/src/modules/fourD/AssetImportReview.tsx' = '2EA6F42A70529CF0CA7C3F7192FF65F951843E7350E72B17D563B72A10537205'
    'frontend/src/modules/fourD/ClashViewport.tsx' = '35BBFE767AAEF3AAED19161D5685FCD24296B25C5F59B102FFE225C16120F397'
    'frontend/src/modules/fourD/ComparisonViewportPane.tsx' = '0416AB6F9C417A9A2F317AC51299D7A8F31BC90679A7B1474DFE70192AC446CE'
    'frontend/src/modules/fourD/ShapeOperationsPanel.tsx' = '10A47E56440864777D8C9883172EA9742671E52340FE673A46A68FFF93A893D1'
    'frontend/src/modules/fourD/SiteAssetLibrary.tsx' = 'A291E8E96CC720DD3C6C89FFB0C6E6EDA22655B0B203C66544B026F6B5591965'
    'frontend/src/modules/fourD/Viewport3D.tsx' = 'D1FA471E9DF3A1BDADE6693F35F18C47A58DDD6F024BC2BD37263380CB32CD4B'
    'frontend/tests/browser/index.html' = 'AF00A82B4FDC721B34B8038B07EC049B2E5B9677F377F45E9AC68539055C65C3'
    'frontend/src/modules/fourD/SafeCanvas.tsx' = 'C418A2FD6437B1B3C2B90283535F26E4CC561B4DC1254AA35A2BB2C171AA67C2'
    'frontend/tests/browser/context.fixture.tsx' = '0B9D9090EE244CDF221BDA688B484073579C54E7CA14CFF314F09028A8D3B408'
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
    $paths = @($files.Keys) + 'scripts/publish-web-context-fix.ps1'
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
Write-Host 'WebGL recovery source pushed to main. Verify the web deployment before retrying the live workspace.'
