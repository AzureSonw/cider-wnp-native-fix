[CmdletBinding()]
param(
  [ValidateSet('Install', 'Check', 'Restore')]
  [string]$Action = 'Check',
  [string]$CiderPath
)

$ErrorActionPreference = 'Stop'
$Version = (Get-Content -LiteralPath (Join-Path $PSScriptRoot '..\VERSION') -Raw).Trim()
$Root = Split-Path -Parent $PSScriptRoot
$PayloadPublisher = Join-Path $Root 'src\native-metadata-publisher.js'
$PayloadPreload = Join-Path $Root 'src\native-metadata-preload.js'
$BeginMarker = '// BEGIN CIDER-WNP-NATIVE-FIX v1'
$EndMarker = '// END CIDER-WNP-NATIVE-FIX v1'

function Write-Status([string]$Message) {
  Write-Host ("[cider-wnp] " + $Message)
}

function Get-Hash([string]$Path) {
  $sha256 = [System.Security.Cryptography.SHA256]::Create()
  try {
    $bytes = [System.IO.File]::ReadAllBytes($Path)
    return ([BitConverter]::ToString($sha256.ComputeHash($bytes)) -replace '-', '').ToUpperInvariant()
  } finally {
    $sha256.Dispose()
  }
}

function Write-Utf8NoBom([string]$Path, [string]$Text) {
  $utf8 = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($Path, $Text, $utf8)
}

function Resolve-InstallRoot {
  $candidates = @()
  if ($CiderPath) { $candidates += $CiderPath }
  else {
    $candidates += (Join-Path $env:LOCALAPPDATA 'Programs\Cider')
    if ($env:ProgramFiles) { $candidates += (Join-Path $env:ProgramFiles 'Cider') }
    if (${env:ProgramFiles(x86)}) { $candidates += (Join-Path ${env:ProgramFiles(x86)} 'Cider') }
  }
  foreach ($candidate in ($candidates | Select-Object -Unique)) {
    if (-not $candidate) { continue }
    try { $root = (Resolve-Path -LiteralPath $candidate -ErrorAction Stop).Path } catch { continue }
    $preload = Join-Path $root 'Resources\scripts\preload.js'
    if (Test-Path -LiteralPath $preload -PathType Leaf) { return $root }
  }
  throw 'Cider installation not found. Pass -CiderPath <Cider install directory>.'
}

function Get-Paths([string]$InstallRoot) {
  $scripts = Join-Path $InstallRoot 'Resources\scripts'
  $preload = Join-Path $scripts 'preload.js'
  [pscustomobject]@{
    Root = $InstallRoot
    Preload = $preload
    Backup = Join-Path $scripts 'preload.js.cider-wnp-native-fix.backup'
    Manifest = Join-Path $scripts '.cider-wnp-native-fix.json'
  }
}

function Get-RunningCider([string]$InstallRoot) {
  $expected = [System.IO.Path]::GetFullPath((Join-Path $InstallRoot 'Cider.exe'))
  foreach ($process in @(Get-Process -Name Cider -ErrorAction SilentlyContinue)) {
    try {
      if ($process.Path -and [StringComparer]::OrdinalIgnoreCase.Equals(
          [System.IO.Path]::GetFullPath($process.Path), $expected)) { return $process }
    } catch { }
  }
  return $null
}

function Read-Payload {
  if (-not (Test-Path -LiteralPath $PayloadPublisher -PathType Leaf)) { throw 'Publisher source is missing.' }
  if (-not (Test-Path -LiteralPath $PayloadPreload -PathType Leaf)) { throw 'Preload source is missing.' }
  $publisher = (Get-Content -LiteralPath $PayloadPublisher -Raw).Trim()
  $preload = (Get-Content -LiteralPath $PayloadPreload -Raw).Trim()
  return ($BeginMarker + "`r`n" + $publisher + "`r`n`r`n" + $preload + "`r`n" + $EndMarker)
}

function Read-Manifest([string]$Path) {
  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { return $null }
  return Get-Content -LiteralPath $Path -Raw | ConvertFrom-Json
}

function Install-Fix($paths) {
  $current = Get-Content -LiteralPath $paths.Preload -Raw
  if ($current.Contains($BeginMarker)) {
    Write-Status 'This file already contains the managed repair block; no changes made.'
    return
  }
  if ($current.Contains('__ciderNativeMetadataRepair') -or
      $current.Contains('__createCiderNativeMetadataPublisher')) {
    Write-Status 'An older/manual Cider metadata repair is already present; no duplicate block was added.'
    return
  }
  if (Get-RunningCider $paths.Root) {
    throw 'Cider is running. Close Cider completely, then run install.cmd again.'
  }

  $manifest = Read-Manifest $paths.Manifest
  if ($manifest -and (Test-Path -LiteralPath $paths.Backup -PathType Leaf)) {
    $backupHash = Get-Hash $paths.Backup
    if ($backupHash -ne $manifest.originalSha256) {
      throw 'The existing backup does not match its manifest; refusing to overwrite it.'
    }
  } elseif (Test-Path -LiteralPath $paths.Backup -PathType Leaf) {
    throw 'An unmanaged backup file already exists; inspect it before installing.'
  } else {
    Copy-Item -LiteralPath $paths.Preload -Destination $paths.Backup -Force
  }

  $originalHash = Get-Hash $paths.Preload
  $payload = Read-Payload
  $updated = $current.TrimEnd("`r", "`n") + "`r`n`r`n" + $payload + "`r`n"
  Write-Utf8NoBom $paths.Preload $updated
  $installedHash = Get-Hash $paths.Preload
  $record = [ordered]@{
    format = 1
    version = $Version
    installedAtUtc = [DateTime]::UtcNow.ToString('o')
    preload = $paths.Preload
    backup = $paths.Backup
    originalSha256 = $originalHash
    installedSha256 = $installedHash
  }
  Write-Utf8NoBom $paths.Manifest (($record | ConvertTo-Json -Depth 3) + "`r`n")
  Write-Status ("Installed v{0}. Restart Cider to load the repair." -f $Version)
}

function Check-Fix($paths) {
  $current = Get-Content -LiteralPath $paths.Preload -Raw
  $manifest = Read-Manifest $paths.Manifest
  if ($manifest) {
    $hash = Get-Hash $paths.Preload
    if ($hash -eq $manifest.installedSha256 -and $current.Contains($BeginMarker)) {
      Write-Status ("Managed repair v{0} is installed." -f $manifest.version)
      return
    }
    throw 'A managed repair manifest exists, but preload.js was changed after installation.'
  }
  if ($current.Contains($BeginMarker) -or $current.Contains('__ciderNativeMetadataRepair')) {
    Write-Status 'A repair block is present, but it is not managed by this installer.'
    return
  }
  Write-Status 'No Cider metadata repair block is installed.'
  exit 1
}

function Restore-Fix($paths) {
  $manifest = Read-Manifest $paths.Manifest
  if (-not $manifest) { throw 'No managed backup manifest was found; nothing was restored.' }
  if (-not (Test-Path -LiteralPath $paths.Backup -PathType Leaf)) { throw 'The managed backup file is missing.' }
  if (Get-RunningCider $paths.Root) { throw 'Cider is running. Close Cider completely, then run restore.cmd again.' }
  $currentHash = Get-Hash $paths.Preload
  if ($currentHash -ne $manifest.installedSha256) {
    throw 'preload.js has changed since installation; refusing to overwrite it. Restore the backup manually after inspection.'
  }
  if ((Get-Hash $paths.Backup) -ne $manifest.originalSha256) { throw 'The managed backup failed its SHA-256 check.' }
  Copy-Item -LiteralPath $paths.Backup -Destination $paths.Preload -Force
  Remove-Item -LiteralPath $paths.Manifest -Force
  Write-Status 'Restored the original preload.js. Restart Cider to finish.'
}

try {
  if (-not (Test-Path -LiteralPath $PayloadPublisher -PathType Leaf)) { throw 'Run this script from the extracted project directory.' }
  $root = Resolve-InstallRoot
  $paths = Get-Paths $root
  switch ($Action) {
    'Install' { Install-Fix $paths }
    'Check' { Check-Fix $paths }
    'Restore' { Restore-Fix $paths }
  }
  exit 0
} catch {
  Write-Error $_.Exception.Message
  exit 2
}

