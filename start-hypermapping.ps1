# Starts HyperMapping in "light" mode: builds only if the code changed since the last build,
# serves the finished app, and opens the app and the simulator in your browser.
#
#   start-hypermapping.ps1               normal start (build if needed, serve, open both pages)
#   start-hypermapping.ps1 -Dev          use the heavier dev server instead (live reload)
#   start-hypermapping.ps1 -NoBrowser    do not open the browser
#   start-hypermapping.ps1 -SelfTest     start, check both pages answer, stop, exit 0 (ok) or 1 (problem)
#
# Close this window (or press Ctrl+C) to stop the server.
param(
  [int]$Port = 4173,
  [switch]$Dev,
  [switch]$NoBrowser,
  [switch]$SelfTest
)

$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
if ($Dev -and $Port -eq 4173) { $Port = 5173 }
if ($SelfTest) { $NoBrowser = $true }

function Write-Step($text) { Write-Host "==> $text" -ForegroundColor Cyan }
function Fail($text) { Write-Host "ERROR: $text" -ForegroundColor Red; exit 1 }

function Test-Port([int]$p) {
  $client = New-Object System.Net.Sockets.TcpClient
  try {
    $async = $client.BeginConnect('127.0.0.1', $p, $null, $null)
    if (-not $async.AsyncWaitHandle.WaitOne(300)) { return $false }
    $client.EndConnect($async)
    return $true
  } catch { return $false } finally { $client.Close() }
}

# True when the finished app in dist\ is missing or older than the code that builds it.
function Test-BuildStale {
  foreach ($f in @('dist\index.html', 'dist\simulator.html')) {
    if (-not (Test-Path -LiteralPath (Join-Path $PSScriptRoot $f))) { return $true }
  }
  $distTime = (Get-Item -LiteralPath (Join-Path $PSScriptRoot 'dist\index.html')).LastWriteTimeUtc
  $inputs = @('src', 'public', 'index.html', 'simulator.html', 'package.json', 'package-lock.json',
              'vite.config.ts', 'tailwind.config.js', 'postcss.config.js', 'tsconfig.json')
  foreach ($name in $inputs) {
    $path = Join-Path $PSScriptRoot $name
    if (-not (Test-Path -LiteralPath $path)) { continue }
    $newer = Get-ChildItem -LiteralPath $path -Recurse -File -Force -ErrorAction SilentlyContinue |
      Where-Object { $_.Name -notlike '*.test.ts' -and $_.LastWriteTimeUtc -gt $distTime } |
      Select-Object -First 1
    if ($newer) { return $true }
  }
  return $false
}

function Get-LanAddress {
  try {
    $addr = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction Stop |
      Where-Object { $_.IPAddress -notmatch '^(127|169\.254)\.' -and $_.PrefixOrigin -ne 'WellKnown' } |
      Select-Object -First 1 -ExpandProperty IPAddress
    return $addr
  } catch { return $null }
}

# The dev/preview servers use a self-signed certificate: accept it for our own local checks only.
function Test-Url([string]$url) {
  try {
    [System.Net.ServicePointManager]::ServerCertificateValidationCallback = { $true }
    [System.Net.ServicePointManager]::SecurityProtocol = [System.Net.SecurityProtocolType]::Tls12
    $req = [System.Net.WebRequest]::Create($url)
    $req.Timeout = 8000
    $res = $req.GetResponse()
    $ok = ([int]$res.StatusCode -eq 200)
    $res.Close()
    return $ok
  } catch { return $false }
}

if (-not (Get-Command node -ErrorAction SilentlyContinue)) { Fail 'Node.js was not found. Install Node.js, then run this again.' }
if (-not (Get-Command npm -ErrorAction SilentlyContinue)) { Fail 'npm was not found. Install Node.js, then run this again.' }

$appUrl = "https://localhost:$Port/"
$simUrl = "https://localhost:$Port/simulator.html"

if (Test-Port $Port) {
  Write-Host "Something is already serving on port $Port - assuming it is HyperMapping." -ForegroundColor Yellow
  if (-not $NoBrowser) { Start-Process $appUrl; Start-Process $simUrl }
  Write-Host "Opened $appUrl and $simUrl. Nothing new was started."
  exit 0
}

if (-not (Test-Path -LiteralPath (Join-Path $PSScriptRoot 'node_modules'))) {
  Write-Step 'First run: installing dependencies (this takes a minute)'
  & npm install
  if ($LASTEXITCODE -ne 0) { Fail 'npm install failed.' }
}

if (-not $Dev) {
  if (Test-BuildStale) {
    Write-Step 'The code changed since the last build: building (about 10-30 seconds)'
    & npm run build
    if ($LASTEXITCODE -ne 0) { Fail 'The build failed. The messages above say why.' }
  } else {
    Write-Step 'The last build is up to date: skipping the build'
  }
  $serverArgs = "/c npm run preview -- --port $Port --strictPort"
} else {
  Write-Step 'Starting the dev server (heavier, reloads as the code changes)'
  $serverArgs = "/c npm run dev -- --port $Port --strictPort"
}

Write-Step "Starting the server on port $Port"
$server = Start-Process -FilePath 'cmd.exe' -ArgumentList $serverArgs -NoNewWindow -PassThru

try {
  $deadline = (Get-Date).AddSeconds(60)
  while (-not (Test-Port $Port)) {
    if ($server.HasExited) { Fail 'The server stopped right after starting. The messages above say why.' }
    if ((Get-Date) -gt $deadline) { Fail "The server did not come up within 60 seconds." }
    Start-Sleep -Milliseconds 300
  }

  $lan = Get-LanAddress
  Write-Host ''
  Write-Host 'HyperMapping is running:' -ForegroundColor Green
  Write-Host "  App        $appUrl"
  Write-Host "  Simulator  $simUrl"
  if ($lan) { Write-Host "  On your phone (same Wi-Fi): https://${lan}:$Port/" }
  Write-Host '  Your browser will warn about the certificate: that is expected for a local address. Accept it once.'
  Write-Host '  Close this window to stop.'
  Write-Host ''

  if ($SelfTest) {
    $okApp = Test-Url $appUrl
    $okSim = Test-Url $simUrl
    Write-Host ("Self-test: app page " + $(if ($okApp) { 'OK' } else { 'FAILED' }) + ', simulator page ' + $(if ($okSim) { 'OK' } else { 'FAILED' }))
    if ($okApp -and $okSim) { $script:exitCode = 0 } else { $script:exitCode = 1 }
  } else {
    if (-not $NoBrowser) { Start-Process $appUrl; Start-Process $simUrl }
    Wait-Process -Id $server.Id
  }
} finally {
  if ($server -and -not $server.HasExited) {
    & taskkill /PID $server.Id /T /F | Out-Null
  }
}
if ($SelfTest) { exit $script:exitCode }
