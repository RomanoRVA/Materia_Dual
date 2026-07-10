param(
  [int]$BackendPort = 3000,
  [int]$FrontendPort = 5500,
  [switch]$OpenAsApp = $true
)

$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$backendPath = Join-Path $projectRoot 'backend'
$frontendPath = Join-Path $projectRoot 'frontend'
$runtimeDir = Join-Path $projectRoot '.runtime'
$browserProfileDir = Join-Path $runtimeDir 'browser-profile'

if (-not (Test-Path $runtimeDir)) {
  New-Item -ItemType Directory -Path $runtimeDir | Out-Null
}

$startupLogPath = Join-Path $runtimeDir 'last-start.log'
$startupErrorPath = Join-Path $runtimeDir 'last-start-error.log'

if (Test-Path $startupErrorPath) {
  Remove-Item $startupErrorPath -Force -ErrorAction SilentlyContinue
}

try {
  Start-Transcript -Path $startupLogPath -Append | Out-Null
} catch {
  # Continue even if transcript cannot start.
}

function Test-CommandExists {
  param([string]$CommandName)

  return [bool](Get-Command $CommandName -ErrorAction SilentlyContinue)
}

function Stop-ProcessTree {
  param([int]$ProcessId)

  if (-not $ProcessId) {
    return
  }

  try {
    $null = Get-Process -Id $ProcessId -ErrorAction Stop
  } catch {
    return
  }

  try {
    & taskkill /PID $ProcessId /T /F | Out-Null
  } catch {
    try {
      Stop-Process -Id $ProcessId -Force -ErrorAction Stop
    } catch {
      Write-Warning "No se pudo detener PID $ProcessId. $_"
    }
  }
}

function Wait-HttpOk {
  param(
    [string]$Url,
    [int]$TimeoutSeconds = 20
  )

  $start = Get-Date
  do {
    try {
      $res = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 2
      if ($res.StatusCode -ge 200 -and $res.StatusCode -lt 500) {
        return $true
      }
    } catch {
      # Waiting for service startup.
    }

    Start-Sleep -Milliseconds 500
  } while (((Get-Date) - $start).TotalSeconds -lt $TimeoutSeconds)

  return $false
}

function Get-AppBrowserPath {
  $candidates = @(
    "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe",
    "$env:ProgramFiles(x86)\Microsoft\Edge\Application\msedge.exe",
    "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
    "$env:ProgramFiles(x86)\Google\Chrome\Application\chrome.exe"
  )

  foreach ($candidate in $candidates) {
    if (Test-Path $candidate) {
      return $candidate
    }
  }

  return $null
}

function Invoke-BackendMaintenance {
  Write-Host "[POS] Preparando Prisma Client..." -ForegroundColor Cyan

  $generate = Start-Process -FilePath 'npm.cmd' -ArgumentList @('run', 'prisma:generate') -WorkingDirectory $backendPath -NoNewWindow -Wait -PassThru
  if ($generate.ExitCode -ne 0) {
    throw "No fue posible generar Prisma Client. Codigo de salida: $($generate.ExitCode)"
  }
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

if (-not (Test-CommandExists 'python')) {
  throw "Python no esta disponible en PATH. Instala Python para servir el frontend con http.server."
}

# Evita conflictos por procesos antiguos de una ejecucion anterior.
& powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $projectRoot 'stop.ps1') -BackendPort $BackendPort -FrontendPort $FrontendPort | Out-Null

$backendProc = $null
$frontendProc = $null
$appProc = $null

try {
  Invoke-BackendMaintenance

  $backendShellCommand = "`$env:PORT=$BackendPort; Set-Location '$backendPath'; node src/server.js"
  $backendProc = Start-Process powershell -ArgumentList @('-NoProfile', '-WindowStyle', 'Hidden', '-Command', $backendShellCommand) -PassThru

  $frontendShellCommand = "Set-Location '$frontendPath'; python -m http.server $FrontendPort"
  $frontendProc = Start-Process powershell -ArgumentList @('-NoProfile', '-WindowStyle', 'Hidden', '-Command', $frontendShellCommand) -PassThru

  $backendReady = Wait-HttpOk -Url "http://localhost:$BackendPort/health" -TimeoutSeconds 45
  if (-not $backendReady) {
    throw "Backend no respondio en http://localhost:$BackendPort/health"
  }

  $frontendVersion = Get-Date -Format 'yyyyMMddHHmmss'
  $frontendReadyUrl = "http://localhost:$FrontendPort/login.html"
  $frontendUrl = "${frontendReadyUrl}?v=$frontendVersion"
  $frontendReady = Wait-HttpOk -Url $frontendReadyUrl -TimeoutSeconds 20
  if (-not $frontendReady) {
    throw "Frontend no respondio en $frontendUrl"
  }

  $appBrowserPath = Get-AppBrowserPath
  if ($OpenAsApp -and $appBrowserPath) {
    if (-not (Test-Path $browserProfileDir)) {
      New-Item -ItemType Directory -Path $browserProfileDir | Out-Null
    }

    $browserArgs = @(
      "--new-window",
      "--user-data-dir=$browserProfileDir",
      "--app=$frontendUrl"
    )

    $appProc = Start-Process -FilePath $appBrowserPath -ArgumentList $browserArgs -PassThru
  } else {
    $appProc = Start-Process -FilePath 'cmd.exe' -ArgumentList @('/c', 'start', '', $frontendUrl) -PassThru
  }

  Write-Host "[OK] Backend activo en http://localhost:$BackendPort" -ForegroundColor Green
  Write-Host "[OK] Frontend activo en $frontendUrl" -ForegroundColor Green
  Write-Host "[OK] Al cerrar la ventana de la app se detendran backend y frontend." -ForegroundColor Green

  Wait-Process -Id $appProc.Id
} catch {
  $errorMessage = "[ERROR] $($_.Exception.Message)"
  Write-Error $errorMessage

  try {
    $errorContent = @(
      (Get-Date -Format 's'),
      $errorMessage,
      ($_ | Out-String)
    ) -join "`r`n"
    Set-Content -Path $startupErrorPath -Value $errorContent -Encoding UTF8
  } catch {
    # Ignore logging failure.
  }
} finally {
  Stop-ProcessTree -ProcessId $backendProc.Id
  Stop-ProcessTree -ProcessId $frontendProc.Id
  try {
    Stop-Transcript | Out-Null
  } catch {
    # Ignore transcript shutdown failures.
  }
  Write-Host "[DONE] Servicios POS detenidos." -ForegroundColor Cyan
}
