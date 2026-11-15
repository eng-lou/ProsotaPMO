# Publish only the reviewed web release; preserve unrelated working files.
$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $repoRoot
$expectedBase = '91e9396be3ab211fc3d53872cf0125bb8c35e069'
$commitMessage = 'Keep large linked models batched and improve web loading'
$files = [ordered]@{
    '.github/workflows/ci.yml' = '93FC725462BF0F19EBB5A9FD71548263F9DCADEF2FDD934537016491BC5D887B'
    'docs/LEARNING_LOG.md' = '9ACCC2C6ACDD5C02E8330C98BA43CE56F21D6A57F636514CC277E834D26C22AC'
    'docs/RELEASE_0.2.50.md' = '942CEF632B3A9699426B45B2074A817F412BDC6AF656609D41F761AD27F04190'
    'frontend/package.json' = '0C8DFBFB4DE7CAC41C79D5E2301DE423DBD7CCE95E203D2B96693DA91E116F29'
    'frontend/src/lib/releases.ts' = '6C8F1D16FAC10364D66B7870DB008B1F14ABDB046D12102AE92D0C2049066BC8'
    'frontend/src/modules/fourD/FourD.tsx' = '919784B30CB3429F27E4980D7FFE83B8F4A29CA3BDFBC0C25B5374EDFEF36063'
    'frontend/src/modules/fourD/PropertiesPanel.tsx' = 'E8AF8A6B89C64C7F18795BDE745C4A752DBAAFB1D55E86A00F3EFB3CF5AA7F03'
    'frontend/src/modules/fourD/SiteAssetModel.tsx' = 'B399220D1199370712412A953CA5F4899A3ABD70F26E34E4C8CA84A0BCEB6B26'
    'frontend/src/modules/fourD/SiteSceneLayer.tsx' = 'EDBE5590D69011FB7B0F47FD30B7AB54C9ED340067D6A528C52892AB5EFA186B'
    'frontend/src/modules/fourD/Viewport3D.tsx' = '88941DE45AA7F9B6DD1D98C8FFB3C2C756C4B78C05BC8B3AFC7B143399842B0A'
    'frontend/src/modules/fourD/arraySourceSnapshot.ts' = '3669D0D01A27A913893216582C5BD70E19163D77BAE13FF8CA8A07F9A6756154'
    'frontend/src/modules/fourD/batchAnimationGate.ts' = '3C32EB4DDBD2F7BE1B13792382B9464FEFE47BE12CEF2F5FA68ECBB90B905630'
    'frontend/src/modules/fourD/batchAnimationShader.ts' = '69F507BB035F2D1E74ED22F67C7E7CDC688404A6FD4528ECAFEACF9D48BA0633'
    'frontend/src/modules/fourD/contextGeometry.ts' = 'C774DA1B495879C3AC59A6527BF863941999FE98ACEFCA67ED7010C5D7F01759'
    'frontend/src/modules/fourD/contextGeometry.worker.ts' = 'E2363AE3B4AE5C64EEDBC73E7108F8200D69F97F0F3D693A2DC128B65807A49C'
    'frontend/src/modules/fourD/elementBatching.ts' = 'DAE64138E4335F99D1BC57CBA3FE5B028DD9038C76659C28F07B1A47AD3CF0D2'
    'frontend/src/modules/fourD/ifcGeometry.worker.ts' = '988C886F2B43FE5AB950C1A01858046881A33D0F9B5328061B062D3A091F748F'
    'frontend/src/modules/fourD/ifcGeometryCache.ts' = '60EA4664B5E772AADA8FBC926B2835330DC15C63CB03876AEB05F561888611C8'
    'frontend/src/modules/fourD/ifcGeometryData.ts' = 'A4EC624FF2828C4D248D05F26422BD7A08796D4F762F4A674A92977B5812FC6F'
    'frontend/src/modules/fourD/ifcGeometryLoader.ts' = 'D6511F5B2F2CC48709C5DB256FC7B0B328C3BCB440D16862C5ABA0EA8B0B276F'
    'frontend/src/modules/fourD/ifcGeometryStream.ts' = '37D5058961F798488697E2540B39340700FE186F8BBCF4A9170ABE4CECC121FF'
    'frontend/src/modules/fourD/ifcModel.ts' = 'C1E0BE941AAC1B696FA94A3DF5497B442440CC761909AC1DCEA75BEE7C0A1771'
    'frontend/src/modules/fourD/realisticMaterials.ts' = 'FC59AF75BAF8EA284F1FE9841A21311388D169B29BECE523532659FC7E342456'
    'frontend/src/modules/fourD/useContextDetail.ts' = '775DAA82092452AB28B850D1EFEFF7C555791990D5BCED75CA85A869ED463C89'
    'frontend/tests/bimIdleWork.test.mjs' = '9628E17F8A0870713689219B00F5C2CF598B321E15C52485525F42DE047DE78F'
    'frontend/tests/browser/batchAnimation.fixture.ts' = '2904F3E9BE644B591666F1285C7E366788863E3DC5FE6DAF2C91D01116DC4A6B'
    'frontend/tests/browser/context-asset-benchmark.mjs' = 'A5A89403BD32E56239B75E9D0A7085D5EFA71AEC3F4FB6B3F85A07D8B0D039F9'
    'frontend/tests/browser/import.fixture.ts' = 'C486D10F79B41D0465512F604E299E0078C10DB8A64EDA300ED8D137326C4307'
    'frontend/tests/browser/index.html' = 'D5B693071897421915D0F38A19DABB8CE5999EA6A3F7F2A3FB690165D31ED301'
    'frontend/tests/browser/run-web-fixture.mjs' = '916F9153B861B3028DBCEFB69016DBB6C57DCD8D238B0F17E7DDB528CAB6FACD'
    'frontend/tests/ifcGeometryStream.test.mjs' = 'AE48CAF630653623D268E4E5D1C2C8091F06508EF7790A0E2CDDFA7722E3F860'
    'frontend/tests/largeLinkedModels.test.mjs' = '8CA625018AB89D6E0F61211E91C628EA6678B9856EA1327D6F1C2753920B5DAD'
    'frontend/tests/pausedBatchAnimation.test.mjs' = '8D4BBCCBD638AED79356AF033BD59F05D6AD1C1A86506E0441A3F46F967EC173'
    'frontend/tests/releaseChannels.test.mjs' = '9535061AF1FDA1815D40865D90F54D71BD10939576D47547526E042ED4293B4E'
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
    $paths = @($files.Keys) + 'scripts/publish-web-0.2.50.ps1'
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
Write-Host 'Web 0.2.50 source pushed to main. Verify the web deployment before judging live Tower performance.'
