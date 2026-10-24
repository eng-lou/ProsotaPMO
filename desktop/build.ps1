param(
    [string]$PostgresRoot = "C:\Program Files\PostgreSQL\16",
    [switch]$SkipInstaller,
    [switch]$SignedRelease
)
$ErrorActionPreference = "Stop"
$desktopRoot = $PSScriptRoot
$repoRoot = Split-Path -Parent $desktopRoot
$pythonExe = Join-Path $repoRoot "backend\.venv\Scripts\python.exe"
if (!(Test-Path -LiteralPath $pythonExe)) { throw "Install backend requirements in backend/.venv first." }
if (!(Test-Path -LiteralPath (Join-Path $PostgresRoot "bin\pg_ctl.exe"))) { throw "PostgreSQL 16 binaries required at PostgresRoot." }
Push-Location $desktopRoot
try {
    & npm.cmd --prefix "$repoRoot\prosotaPowerBI" run package
    if ($LASTEXITCODE) { throw "Power BI visual build failed." }
    & $pythonExe prepare_powerbi.py
    if ($LASTEXITCODE) { throw "Power BI template preparation failed." }
    & npm.cmd run build:ui
    if ($LASTEXITCODE) { throw "Desktop UI build failed." }
    Copy-Item -LiteralPath "ui\desktop-settings.html", "ui\desktop-settings.js" -Destination "dist"
    & $pythonExe -m PyInstaller --noconfirm --onedir --name prosota-backend `
        --distpath runtime --workpath build --specpath build `
        --paths "$repoRoot\backend" --paths "$desktopRoot\backend" `
        --add-data "$repoRoot\backend\alembic;migrations" `
        --collect-submodules alembic `
        --collect-submodules app --collect-all ifcopenshell --collect-all pye57 `
        --hidden-import psycopg_binary --collect-all psycopg `
        backend/runner.py
    if ($LASTEXITCODE) { throw "Backend packaging failed." }
    New-Item -ItemType Directory -Force -Path "runtime\backend", "runtime\postgres" | Out-Null
    Copy-Item -Path "runtime\prosota-backend\*" -Destination "runtime\backend" -Recurse -Force
    foreach ($part in @("bin", "lib", "share")) {
        Copy-Item -LiteralPath (Join-Path $PostgresRoot $part) -Destination "runtime\postgres" -Recurse -Force
    }
    # PostgreSQL must also start on machines without a development toolchain.
    foreach ($dll in @("MSVCP140.dll", "VCRUNTIME140.dll", "VCRUNTIME140_1.dll")) {
        Copy-Item -LiteralPath (Join-Path "runtime\backend\_internal" $dll) -Destination "runtime\postgres\bin" -Force
    }
    Copy-Item -LiteralPath (Join-Path $PostgresRoot "server_license.txt"), (Join-Path $PostgresRoot "commandlinetools_3rd_party_licenses.txt") -Destination "runtime\postgres"
    if (!$SkipInstaller) {
        if ($SignedRelease) {
            # electron-builder reads CSC_LINK/CSC_KEY_PASSWORD from the release
            # environment. Fail closed rather than distributing an unsigned release.
            & npm.cmd exec electron-builder -- --win nsis --x64 -c.win.signAndEditExecutable=true -c.forceCodeSigning=true
        } else {
            & npm.cmd run package
        }
        if ($LASTEXITCODE) { throw "Installer packaging failed." }
        $desktopVersion = (Get-Content -Raw package.json | ConvertFrom-Json).version
        $installerPath = Join-Path $desktopRoot "release\Prosota-Desktop-Preview-$desktopVersion-Setup.exe"
        $signature = Get-AuthenticodeSignature -LiteralPath $installerPath
        if ($SignedRelease -and $signature.Status -ne 'Valid') { throw "Release installer signature validation failed." }
        @{
            version = $desktopVersion
            file = Split-Path -Leaf $installerPath
            sha256 = (Get-FileHash -LiteralPath $installerPath -Algorithm SHA256).Hash
            signature = [string]$signature.Status
        } | ConvertTo-Json | Set-Content -Encoding utf8 "release\release-manifest.json"
    }
} finally { Pop-Location }
