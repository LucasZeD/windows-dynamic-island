# Builds the peripherals helper (bridge.py + the HaloBattery submodule) into
# sidecars/peripherals/dist/halo-bridge/, which the island bundles as a resource.
#
#   pwsh -NoProfile -File sidecars/peripherals/build.ps1
#
# One-folder build like Halo Battery's own release (a one-file exe unpacks Python
# into %TEMP% on every start). Console subsystem: the island reads its stdout and
# starts it with CREATE_NO_WINDOW, so no window shows.
$ErrorActionPreference = 'Stop'
$here = $PSScriptRoot
$halo = Join-Path $here 'HaloBattery'
if (-not (Test-Path (Join-Path $halo 'halo_battery.pyw'))) {
    throw "HaloBattery submodule missing: run 'git submodule update --init'"
}

# Python 3.12 is what Halo Battery builds with; 3.13 works too.
$venv = Join-Path $here '.venv'
$python = Join-Path $venv 'Scripts/python.exe'
if (-not (Test-Path $python)) {
    $py = (Get-Command py -ErrorAction Stop).Source
    & $py -3.12 -m venv $venv 2>$null
    if (-not $?) { & $py -3.13 -m venv $venv }
    & $python -m pip install --quiet --upgrade pip
}
# Halo Battery's pinned, hash-checked build requirements (PyInstaller included).
& $python -m pip install --quiet --require-hashes -r (Join-Path $halo 'requirements-build.txt')
if (-not $?) { throw 'pip install failed' }

# halo_battery.pyw is loaded by path from source; PyInstaller only follows
# imports, so the build gets it as a regular module named halo_app.
$stage = Join-Path $here 'build/stage'
New-Item -ItemType Directory -Force $stage | Out-Null
Copy-Item (Join-Path $halo 'halo_battery.pyw') (Join-Path $stage 'halo_app.py') -Force

$licenses = Join-Path $halo 'docs/licenses'
$credits = Join-Path $halo 'docs/credits.md'
& $python -m PyInstaller --noconfirm --clean --onedir --console --noupx `
    --name halo-bridge `
    --distpath (Join-Path $here 'dist') `
    --workpath (Join-Path $here 'build/work') `
    --specpath (Join-Path $here 'build') `
    --paths $stage --paths $halo `
    --hidden-import halo_app `
    --hidden-import hid --hidden-import pystray._win32 `
    --hidden-import serial --hidden-import serial.tools.list_ports `
    --hidden-import usb.backend.libusb1 --collect-data libusb_package `
    --collect-submodules providers --collect-submodules halo `
    --collect-data halo `
    --add-data "${licenses}:licenses" --add-data "${credits}:licenses" `
    --add-data "$(Join-Path $halo 'LICENSE'):licenses/HaloBattery" `
    (Join-Path $here 'bridge.py')
if (-not $?) { throw 'PyInstaller failed' }
Write-Host "Built: $(Join-Path $here 'dist/halo-bridge/halo-bridge.exe')"
