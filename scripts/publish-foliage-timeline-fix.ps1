# Publish only the reviewed web release; preserve unrelated working files.
$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $repoRoot
$expectedBase = 'b7e5643190933c3471b48061d2815cef40281c93'
$commitMessage = 'Fix leaf background cutouts and initial linked visibility'
$files = [ordered]@{
    'docs/LEARNING_LOG.md' = '7673BFF5B0ABDDA319E796ECAD861A1EAAB8B9C286C5BA460ABBA036C7445D38'
    'frontend/package.json' = 'B1BB95AFBABEAF0C507849EC21A129884EC70D1E074C35AA3914FB5EE08C0B37'
    'frontend/src/modules/fourD/RealisticMaterialsPanel.tsx' = '052F3213B5DE617C0156EE84997A4E836CBDBF1E552201E136A2381DBAD6CE8B'
    'frontend/src/modules/fourD/SiteAssetModel.tsx' = '244303864F9717CC1CD99FFF690E4E68E64FE5DF382F1CBC4DF140A4CFA83B46'
    'frontend/src/modules/fourD/Viewport3D.tsx' = '9A2B4CE088DA847743B734505B3C7F3441FADFC555780788DBFC2805C9BEC3EA'
    'frontend/src/modules/fourD/arraySourceSnapshot.ts' = 'AF4BF559914DD0BD3C3DE38C1740F7B14C1D933FC46EFB3E2FF28D05764865C6'
    'frontend/src/modules/fourD/cutoutRendering.ts' = '60F4C7A30DF1A9902414360195A020160DC825C129BF829FB0DB7B2A87A6AE74'
    'frontend/src/modules/fourD/siteAssetMaterials.ts' = '591A46BD602293EE4D8509C086BDD97BACA6566A7E85319F73166D4396B7FB2C'
    'frontend/tests/arraySourceSnapshot.test.mjs' = 'A363C66E65F824F772D30836A746158C29B3211E112373A3ED1CE76B0D438FDF'
    'frontend/tests/browser/index.html' = '8C477BE734E118F9DE21E9438D38878EABC9698B787E28A6B0A98793D64CBAB6'
    'frontend/tests/browser/foliage.fixture.ts' = '8D21A379A68FBDF9290693467EE2F6865127ED931DB667E455501D86746BDEFC'
    'frontend/tests/foliageCutout.test.mjs' = '8EEC11944CA38C550EFA9EE93A1D0669EB5F1612BCB76599DCFFA3E4AFEACC62'
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
    $paths = @($files.Keys) + 'scripts/publish-foliage-timeline-fix.ps1'
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
Write-Host 'Foliage and timeline fixes pushed to main; verify deployment before testing the live project.'
