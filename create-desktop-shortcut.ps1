param(
  [string]$ShortcutName = 'POS Los Pachecos.lnk'
)

$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$launcherPath = Join-Path $projectRoot 'launch-pos.bat'

if (-not (Test-Path $launcherPath)) {
  throw "No se encontro el lanzador en: $launcherPath"
}

$desktopPath = [Environment]::GetFolderPath('Desktop')
$shortcutPath = Join-Path $desktopPath $ShortcutName

$wshShell = New-Object -ComObject WScript.Shell
$shortcut = $wshShell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = $launcherPath
$shortcut.WorkingDirectory = $projectRoot
$shortcut.WindowStyle = 7
$shortcut.Description = 'Inicia POS Los Pachecos con un click'
$shortcut.IconLocation = "$env:SystemRoot\System32\SHELL32.dll,41"
$shortcut.Save()

Write-Host "[OK] Acceso directo creado en: $shortcutPath" -ForegroundColor Green
