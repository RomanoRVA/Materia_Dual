param(
  [int]$BackendPort = 3000,
  [int]$FrontendPort = 5500
)

$ErrorActionPreference = 'Stop'

function Stop-ProcessByPort {
  param(
    [int]$Port,
    [string]$Name
  )

  $connections = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
  if (-not $connections) {
    Write-Host "[INFO] No hay proceso escuchando en el puerto $Port ($Name)." -ForegroundColor DarkYellow
    return
  }

  $pids = $connections | Select-Object -ExpandProperty OwningProcess -Unique
  foreach ($pid in $pids) {
    if ($pid -eq $PID) {
      continue
    }

    try {
      $proc = Get-Process -Id $pid -ErrorAction Stop
      Stop-Process -Id $pid -Force -ErrorAction Stop
      Write-Host "[OK] $Name detenido en puerto $Port (PID $pid, proceso $($proc.ProcessName))." -ForegroundColor Green
    } catch {
      Write-Warning "No se pudo detener PID $pid en puerto $Port. $_"
    }
  }
}

function Stop-ProcessByCommandLinePattern {
  param(
    [string]$Pattern,
    [string]$Name
  )

  try {
    $processes = Get-CimInstance Win32_Process |
      Where-Object { $_.CommandLine -and $_.CommandLine -match $Pattern }

    if (-not $processes) {
      return
    }

    foreach ($proc in $processes) {
      if ($proc.ProcessId -eq $PID) {
        continue
      }

      try {
        Stop-Process -Id $proc.ProcessId -Force -ErrorAction Stop
        Write-Host "[OK] $Name detenido por patron de comando (PID $($proc.ProcessId))." -ForegroundColor Green
      } catch {
        Write-Warning "No se pudo detener PID $($proc.ProcessId) para $Name. $_"
      }
    }
  } catch {
    Write-Warning "No fue posible inspeccionar lineas de comando para $Name. $_"
  }
}

Write-Host "[POS] Deteniendo servicios de Los Pachecos..." -ForegroundColor Cyan

Stop-ProcessByPort -Port $BackendPort -Name 'Backend'
Stop-ProcessByPort -Port $FrontendPort -Name 'Frontend'

# Fallback para procesos que pudieron cambiar de puerto o no abrir socket al momento de inspeccion.
Stop-ProcessByCommandLinePattern -Pattern 'node\s+src/server\.js' -Name 'Backend'
Stop-ProcessByCommandLinePattern -Pattern 'python(\.exe)?\s+-m\s+http\.server' -Name 'Frontend'

Write-Host "[DONE] Proceso de apagado completado." -ForegroundColor Cyan
