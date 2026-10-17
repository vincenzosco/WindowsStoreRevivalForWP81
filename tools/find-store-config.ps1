# Find the component that owns the Store's configuration endpoint.
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File tools/find-store-config.ps1
#   powershell ... -File tools/find-store-config.ps1 -Device H: -Out "$env:TEMP\find-store-config.txt"
#
# Why this exists: the `/v8/Configuration/Stores/...` requests the phone makes before
# it asks for a page are answered by this lab with a document whose element names are
# invented, because no capture of that endpoint exists (F-020, F-021) and because the
# one binary whose strings this project has read - `ZMarketplace.dll` - does not
# contain the request's own path either. Grepping its string table:
#
#   "mpcVersion"    0 hits
#   "OEMStores"     0 hits
#   "Stores/"       0 hits
#   "LKG*StoreConfigOverride"  5 hits  (@36932, @36984, @37024 - registry value names)
#
# So the URL is not a literal in that module: either another component builds it, or
# it comes from a default configuration stored elsewhere on the device. This script
# looks for both, by byte - which is the only way to ask a filesystem this question
# without trusting a tool that fails silently (the content search in F-020 did, and
# its "0 file" was recorded as evidence of nothing).
#
# What it does NOT do: write anything, mount anything, or run elevated. It reads the
# mounted volume and prints where each pattern was found.
#
# Windows PowerShell 5.1, the version that ships with Windows. Two traps it avoids:
# no ternary operator (a parse error in 5.1), and no `-ErrorAction SilentlyContinue`
# on the file reads - a read that fails is printed as a failure, never as a zero.

param(
  [string]$Device = '',
  [switch]$Deep,
  # Write the whole run to a file as well as the console. This is how the elevated pass
  # reports back: `Start-Process -Verb RunAs` cannot hand back a stream, so the child is
  # given a path and the unelevated side reads the file afterwards.
  [string]$Out = '',
  # Extra roots to search, recursively, for `*.dll`/`*.exe`. Composable on purpose:
  # `-OnlyScan -AlsoScan H:\Data\Programs` is the cheap pass (21 files, 8 MB), and the
  # same two switches against `Data\SharedData\Comms` are the elevated one.
  [string[]]$AlsoScan = @(),
  # Leave the default `\Windows` + `\Windows\System32` roots out. Used when the result
  # of those is already in hand and only a second root is being asked about.
  [switch]$OnlyScan,
  # Also answer the question a *string* cannot: does the client hold a stored store
  # configuration? The value names are in a dozen system modules (`LKGOEMStoreConfigOverride`,
  # `@36932` in ZMarketplace.dll), so the values are read from the mounted hive: load,
  # query `Microsoft\Zune` whole, unload. Elevated, and it rewrites the hive's bytes
  # even when nothing inside changes - which is why `ca/phone-backups/` keeps the
  # hives as found (F-010).
  [switch]$Hive
)

# The report is meant to be kept: redirect it where it survives the next selftest
# run (`tools/selftest.mjs` deletes `.selftest/` on every start - footgun 1).
#
#   powershell ... -File tools/find-store-config.ps1 | Tee-Object "$env:TEMP\find-store-config.txt"

$ErrorActionPreference = 'Stop'

if ($Out -ne '') {
  Start-Transcript -Path $Out -Force | Out-Null
}

# Phone-only structure, weighted, exactly as tools/phone-readout.ps1 scores it - the
# hive alone is printed and never decisive, because an elevated prompt can see
# \Windows\System32\config on this PC too (F-016).
# Three answers, not two: on a real phone `Data\SharedData` and the hive answer
# `Accesso negato` to a normal prompt (F-004), and with `$ErrorActionPreference = 'Stop'`
# a bare `Test-Path` on one of them throws and takes the whole discovery with it. A
# denied marker is printed and never scored - and never read as "not a phone".
function Test-PhonePath {
  param([string]$Path)
  try {
    if (Test-Path $Path) { return 'yes' }
    return 'no'
  } catch {
    return 'denied'
  }
}

function Find-PhoneVolume {
  $candidates = Get-PSDrive -PSProvider FileSystem |
    Where-Object { $_.Name -ne $env:SystemDrive.TrimEnd(':') } |
    ForEach-Object { "$($_.Name):" }
  $scored = @()
  foreach ($root in $candidates) {
    if (-not (Test-Path (Join-Path $root '\'))) { continue }
    $score = 0
    $markers = @()
    $edm = Test-PhonePath (Join-Path $root 'Data\SharedData\EdmCache')
    if ($edm -eq 'yes') { $score += 3; $markers += 'EdmCache' } elseif ($edm -eq 'denied') { $markers += 'EdmCache=denied(not scored)' }
    $public = Test-PhonePath (Join-Path $root 'Data\Users\Public')
    if ($public -eq 'yes') { $score += 2; $markers += 'Data\Users\Public' } elseif ($public -eq 'denied') { $markers += 'Public=denied(not scored)' }
    $shared = Test-PhonePath (Join-Path $root 'Data\SharedData')
    if ($shared -eq 'yes') { $score += 1; $markers += 'Data\SharedData' } elseif ($shared -eq 'denied') { $markers += 'SharedData=denied(not scored)' }
    $hive = Test-PhonePath (Join-Path $root 'Windows\System32\config\SOFTWARE')
    if ($hive -eq 'yes') { $markers += 'hive-seen(not scored)' } elseif ($hive -eq 'denied') { $markers += 'hive=denied' }
    $scored += [pscustomobject]@{ Root = $root; Score = $score; Markers = ($markers -join ', ') }
  }
  foreach ($row in ($scored | Sort-Object -Property Score -Descending)) {
    Write-Output ("volume {0} score {1} [{2}]" -f $row.Root, $row.Score, $row.Markers)
  }
  $best = $scored | Sort-Object -Property Score -Descending | Select-Object -First 1
  if (-not $best -or $best.Score -le 0) { return $null }
  return $best.Root
}

if ($Device -eq '') {
  $root = Find-PhoneVolume
  if (-not $root) {
    Write-Error 'No volume carries the phone markers (EdmCache / Data\Users\Public). Mount the phone in mass storage mode, or pass -Device with the letter.'
    exit 2
  }
  Write-Output "selected volume: $root (by markers, see the scores above)"
} else {
  $root = $Device
  if ($root -notmatch ':\\$') { $root = "$root\" }
  if (-not (Test-Path $root)) {
    Write-Error "no such volume: $root"
    exit 2
  }
  Write-Output "selected volume: $root (given with -Device)"
}

# The UTF-16LE byte image of an ASCII pattern, as a Latin-1 string: "m\0p\0c\0..."
# so that a plain IndexOf over the file's own Latin-1 decoding finds UTF-16 text.
function Get-Utf16Probe {
  param([string]$Text)
  $builder = New-Object System.Text.StringBuilder
  foreach ($character in $Text.ToCharArray()) {
    [void]$builder.Append($character)
    [void]$builder.Append([char]0)
  }
  return $builder.ToString()
}

$patterns = @(
  'mpcVersion',
  'OEMStores',
  'MOStores',
  'v8/Configuration',
  'LKGOEMStoreConfigOverride',
  'marketplaceedgeservice'
)

$probes = @{}
foreach ($pattern in $patterns) {
  $probes[$pattern] = [pscustomobject]@{
    Ascii = $pattern
    Utf16 = (Get-Utf16Probe -Text $pattern)
  }
}

$latin1 = [System.Text.Encoding]::GetEncoding(28591)

function Search-File {
  param([string]$Path, [string]$Label)
  $bytes = $null
  try {
    $bytes = [System.IO.File]::ReadAllBytes($Path)
  } catch {
    # Printed, never swallowed: an unreadable file is a fact about the volume, and
    # the difference between "denied" and "no hit" is the whole lesson of F-004.
    Write-Output ("  SKIP {0} [{1}] - {2}" -f $Path, $Label, $_.Exception.Message)
    return
  }
  if ($bytes.Length -eq 0) { return }
  $text = $latin1.GetString($bytes)
  foreach ($pattern in $patterns) {
    $probe = $probes[$pattern]
    $asciiAt = $text.IndexOf($probe.Ascii, [System.StringComparison]::Ordinal)
    if ($asciiAt -ge 0) {
      Write-Output ("  HIT  {0} [{1}] ascii  '{2}' at byte {3} (file {4} bytes)" -f $Path, $Label, $pattern, $asciiAt, $bytes.Length)
    }
    $utf16At = $text.IndexOf($probe.Utf16, [System.StringComparison]::Ordinal)
    if ($utf16At -ge 0) {
      Write-Output ("  HIT  {0} [{1}] utf16  '{2}' at byte {3} (file {4} bytes)" -f $Path, $Label, $pattern, $utf16At, $bytes.Length)
    }
  }
}

# The binaries that could plausibly build a marketplace URL: the system directory's
# own DLLs and EXEs. Not recursive by default - `\Windows` holds tens of thousands of
# files and the component is a system module - with -Deep to walk everything.
$targets = @()
$systemDirs = @()
if (-not $OnlyScan) {
  $systemDirs = @(
    (Join-Path $root 'Windows\System32'),
    (Join-Path $root 'Windows')
  )
}
foreach ($directory in $systemDirs) {
  # `Test-PhonePath`, not `Test-Path`: every one of these is a device path, and the
  # denied ones throw under `$ErrorActionPreference = 'Stop'` - a scan that dies on
  # the first denied directory reports nothing and looks like a volume with nothing
  # in it (the failure mode F-020 recorded for its content search).
  if ((Test-PhonePath $directory) -ne 'yes') { continue }
  # `-Include` only filters when the path carries a wildcard, which is why the
  # pattern is in the -Path and not only in -Include: without it this returns nothing
  # and the report reads as "no component found" (the failure mode F-020 recorded).
  $targets += Get-ChildItem -Path (Join-Path $directory '*') -File -Include *.dll, *.exe -ErrorAction SilentlyContinue
}
if ($Deep) {
  $extra = @(
    (Join-Path $root 'Data\Users\Public'),
    (Join-Path $root 'Data\SharedData\Comms\Unistore')
  )
  foreach ($directory in $extra) {
    if ((Test-PhonePath $directory) -ne 'yes') {
      Write-Output ("deep: skipped {0} (not readable without elevation)" -f $directory)
      continue
    }
    $targets += Get-ChildItem -Path $directory -File -Recurse -ErrorAction SilentlyContinue
  }
}

foreach ($directory in $AlsoScan) {
  if ((Test-PhonePath $directory) -ne 'yes') {
    Write-Output ("also-scan: {0} is not readable without elevation" -f $directory)
    continue
  }
  $found = Get-ChildItem -Path $directory -File -Recurse -Include *.dll, *.exe -ErrorAction SilentlyContinue
  Write-Output ("also-scan: {0} -> {1} dll/exe file(s)" -f $directory, $found.Count)
  $targets += $found
}

Write-Output ''
Write-Output ("scanning {0} file(s) for: {1}" -f $targets.Count, ($patterns -join ', '))
Write-Output ''

foreach ($file in $targets) {
  Search-File -Path $file.FullName -Label $file.DirectoryName
}

if ($Hive) {
  Write-Output ''
  Write-Output 'Mounted hive: Software\Microsoft\Zune'
  $hiveFile = Join-Path $root 'Windows\System32\config\SOFTWARE'
  if ((Test-PhonePath $hiveFile) -ne 'yes') {
    Write-Output ("  hive not readable: {0} (needs an elevated prompt)" -f $hiveFile)
  } else {
    $mount = 'HKLM\PhoneSoftwareFind'
    # The mount is always released, including on a failed query: a hive left loaded
    # is a lock on the phone's registry that outlives this script.
    try {
      $load = & reg.exe load $mount $hiveFile 2>&1
      if ($LASTEXITCODE -ne 0) {
        Write-Output ("  reg load failed (exit {0}): {1}" -f $LASTEXITCODE, ($load -join ' '))
      } else {
        $query = & reg.exe query "$mount\Microsoft\Zune" /s 2>&1
        if ($LASTEXITCODE -ne 0) {
          Write-Output ("  reg query failed (exit {0}): {1}" -f $LASTEXITCODE, ($query -join ' '))
        } else {
          Write-Output ("  {0} line(s) under Microsoft\Zune; the ones that matter:" -f $query.Count)
          $interesting = $query | Select-String -Pattern 'LKG|Store|Config|Marketplace' -SimpleMatch
          if ($interesting) {
            foreach ($line in $interesting) { Write-Output ("  | " + $line.Line) }
          } else {
            Write-Output '  | nothing matching LKG/Store/Config/Marketplace - no stored store configuration'
          }
          Write-Output ''
          Write-Output '  whole subtree, for the reader who wants it:'
          foreach ($line in $query) { Write-Output ("  : " + $line) }
        }
      }
    } finally {
      $unload = & reg.exe unload $mount 2>&1
      Write-Output ("  hive unmounted: exit {0}" -f $LASTEXITCODE)
    }
  }
}

Write-Output ''
Write-Output 'How to read the result:'
Write-Output '  * a HIT on mpcVersion or v8/Configuration names the component that builds the'
Write-Output '    request. Dump that file with tools\dump-strings.mjs and read the element names'
Write-Output '    around the offset, the way src/store/vocabulary.mjs was read.'
Write-Output '  * no HIT anywhere means the URL is assembled from a stored default: look at'
Write-Output '    Software\Microsoft\Zune in the mounted SOFTWARE hive, and at the Unistore'
Write-Output '    catalogue cache under Data\SharedData\Comms\Unistore.'
Write-Output '  * LKGOEMStoreConfigOverride present as a value (not as a string in a binary) is'
Write-Output '    the configuration the client last accepted - the ground truth this endpoint has'
Write-Output '    never had, if it exists.'
Write-Output ''
Write-Output ("finished {0}" -f (Get-Date -Format s))

if ($Out -ne '') {
  Stop-Transcript | Out-Null
}

