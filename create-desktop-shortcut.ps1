# Creates a "HyperMapping" shortcut on your Desktop that runs start-hypermapping.bat.
# Run it once:  powershell -ExecutionPolicy Bypass -File create-desktop-shortcut.ps1
$ErrorActionPreference = 'Stop'
$bat = Join-Path $PSScriptRoot 'start-hypermapping.bat'
if (-not (Test-Path -LiteralPath $bat)) { throw "start-hypermapping.bat was not found next to this script." }

$desktop = [Environment]::GetFolderPath('Desktop')
$link = Join-Path $desktop 'HyperMapping.lnk'

$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($link)
$shortcut.TargetPath = $bat
$shortcut.WorkingDirectory = $PSScriptRoot
$shortcut.WindowStyle = 1
$shortcut.Description = 'Start HyperMapping (builds if needed, serves, opens the app and the simulator)'
$shortcut.IconLocation = "$env:SystemRoot\System32\imageres.dll,109"
$shortcut.Save()

Write-Host "Created $link"
