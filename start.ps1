param(
  [int]$BackendPort = 3000,
  [int]$FrontendPort = 5500
)

$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$backendPath = Join-Path $projectRoot 'backend'
$frontendPath = Join-Path $projectRoot 'frontend'

function Test-CommandExists {
  param([string]$CommandName)

  return [bool](Get-Command $CommandName -ErrorAction SilentlyContinue)
}

Write-Host "[POS] Iniciando servicios de Los Pachecos..." -ForegroundColor Cyan

if (-not (Test-Path $backendPath)) {
  throw "No se encontro la carpeta backend en: $backendPath"
}

if (-not (Test-Path $frontendPath)) {
  throw "No se encontro la carpeta frontend en: $frontendPath"
}

if (-not (Test-CommandExists 'node')) {
  throw "Node.js no esta disponible en PATH. Instala Node.js LTS e intenta de nuevo."
}

if (-not (Test-CommandExists 'npm.cmd')) {
  throw "npm.cmd no esta disponible en PATH. Reinstala Node.js LTS e intenta de nuevo."
}

$backendCommand = "Set-Location '$backendPath'; npm.cmd install; `$env:PORT=$BackendPort; npm.cmd run dev"
Start-Process powershell -ArgumentList @('-NoExit', '-Command', $backendCommand) | Out-Null

$frontendUrl = "http://localhost:$FrontendPort"

if (Test-CommandExists 'python') {
  $frontendCommand = "Set-Location '$frontendPath'; python -m http.server $FrontendPort"
  Start-Process powershell -ArgumentList @('-NoExit', '-Command', $frontendCommand) | Out-Null
  Start-Sleep -Seconds 1
  Start-Process $frontendUrl | Out-Null
  Write-Host "[OK] Backend iniciando en puerto $BackendPort" -ForegroundColor Green
  Write-Host "[OK] Frontend servido en $frontendUrl" -ForegroundColor Green
} else {
  $indexPath = Join-Path $frontendPath 'index.html'
  Start-Process $indexPath | Out-Null
  Write-Warning "Python no esta disponible. Se abrio index.html directamente en el navegador."
  Write-Host "[OK] Backend iniciando en puerto $BackendPort" -ForegroundColor Green
}

Write-Host "[INFO] Si ya habia procesos activos en esos puertos, cierra las ventanas previas para evitar conflictos." -ForegroundColor Yellow
