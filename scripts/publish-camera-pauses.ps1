# Publish only the reviewed web release; preserve unrelated working files.
$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $repoRoot
$expectedBase = '5d93c9ca0bbee1eeeb806bafb0dd73772b16517f'
$commitMessage = 'Add camera presentation pauses and temporary detail visibility'
$files = [ordered]@{
    'backend/app/schemas/camera_motion.py' = '9FA97BD339DF0AF4140FF3483AAD0FD38366145984EC16FE89093EE04F4CF01E'
    'backend/tests/test_camera_pauses.py' = '59F489A40A2E42F920A15A26836327E882C85C4D17E127FE3A13A8D7901D8038'
    'docs/PRESENTATION_PAUSES.md' = '434B88B75BB91B2FD6BBEF0C00E20F5BBF293EDA5054E33B19EBF8E191C54301'
    'frontend/src/modules/fourD/AnnotationMarker.tsx' = '3717D44188C4D656E531AD00966119837969E0A2D43A361CF3AE6BBE075E959B'
    'frontend/src/modules/fourD/CameraPresetsPanel.tsx' = '6FFD89C64766F9761244174B6A7F08FA55A2EBFEDC7025BAAD52766380398E34'
    'frontend/src/modules/fourD/PathGizmo.tsx' = '709D1B62FF925F9622359E483C59490EAD1920174B540A92A26BD02794C90B20'
    'frontend/src/modules/fourD/SiteSceneLayer.tsx' = 'C577017102CBEE92A15B473B51D7AD212C3CBD8D852587E3A32E0D0A821C5625'
    'frontend/src/modules/fourD/Viewport3D.tsx' = 'FA0C15EFFB4B21707802162006E9BB196B05AA4AC9938A1B9BB5A9BEAF11B0D6'
    'frontend/src/modules/fourD/cameraMotion.ts' = '581B47EF2E19968F9E4BDAB84E8113B4EC6746C961EFFC549A56D57D58A47D1A'
    'frontend/src/modules/fourD/useCameraMotion.ts' = '7F4BDB5663B97A25D0328CB3B39F18778D1127D89D11A2A27D528F1DE1E1323A'
    'frontend/tests/cameraMotion.test.mjs' = 'AF1497E02AE09968C4785BF0C60AFA62544813EAC52109B086E538327D692E62'
    'frontend/tests/browser/index.html' = 'BAC2880A12C74A3A186B5EA713EED45C0D79053464FA05E11A37D0511D2E9293'
    'frontend/tests/browser/pauses.fixture.tsx' = 'B69F0CDFCF79FFBADE024BE67B32A8B9DB214B47033B536DD5944484FF59BCF5'
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
    $paths = @($files.Keys) + 'scripts/publish-camera-pauses.ps1'
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
Write-Host 'Camera pause fixes pushed to main; verify web deployment.'
