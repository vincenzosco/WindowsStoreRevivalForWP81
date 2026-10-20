# Remove the page-cache entries that cannot be a home page, and nothing else.
#
# WHY. Read out of the handset on 2026-10-20 (captures/phone-2026-10-20-mass-storage):
# under the page's own cache key the client holds, beside today's real 310 091-byte
# StorePage, five 205-210 byte documents, the 872-byte truncated control of E-008, and
# three 14-byte bodies that decode to `{"probe":true}`. None of those can draw a store;
# a client that picks one of them spins, and a client that believes it already has a
# page does not ask again - which is the state the device was in when the home stopped
# loading (no request reached the lab between 16:03 and 16:36).
#
# WHAT IT DELETES. Only, under <phone>\Data\SharedData\EdmCache\Short:
#   * files shorter than 1024 bytes whose name contains `7f3c9a52` (the page cookie the
#     page is cached under) or `og_storePages` (the page URL).
# It keeps the real page, the images, the lists, the app details, and everything else.
# It prints every path it removes, and it writes nothing to the phone besides those
# unlinks. Run elevated (the folder ACL refuses a normal prompt - F-057).
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File tools\phone-clear-page-cache.ps1
#   powershell ... -File tools\phone-clear-page-cache.ps1 -WhatIf     # list, delete nothing

param(
  [string]$PhoneRoot = '',
  [int]$MaxBytes = 1024,
  # Elevated windows do not inherit this console, and Start-Process refuses
  # -RedirectStandardOutput together with -Verb RunAs, so the record of what was
  # removed is written here - the same rule phone-readout.ps1 follows.
  [string]$Log = '',
  [switch]$WhatIf
)

$ErrorActionPreference = 'Stop'

function Say([string]$s) {
  Write-Host $s
  if ($Log) { Add-Content -LiteralPath $Log -Value $s -Encoding UTF8 }
}
if ($Log) { Set-Content -LiteralPath $Log -Value '' -Encoding UTF8 }

if (-not $PhoneRoot) {
  $candidates = Get-Volume | Where-Object { $_.DriveLetter -and $_.DriveLetter -ne 'C' } |
    ForEach-Object { $_.DriveLetter + ':' }
  foreach ($c in $candidates) {
    if ((Test-Path -LiteralPath ($c + '\Data\SharedData\EdmCache')) -and
        (Test-Path -LiteralPath ($c + '\Data\Users\Public'))) {
      $PhoneRoot = $c + '\'
      break
    }
  }
}
if (-not $PhoneRoot) { throw 'No phone volume found (mass storage not attached?)' }
Say ("phone : " + $PhoneRoot)

$short = Join-Path $PhoneRoot 'Data\SharedData\EdmCache\Short'
$targets = @(Get-ChildItem -LiteralPath $short -Recurse -Force -File -ErrorAction Stop |
  Where-Object {
    $_.Length -lt $MaxBytes -and
    ($_.Name -like '*7f3c9a52*' -or $_.Name -like '*og_storePages*')
  } | Sort-Object LastWriteTime)

Say ("size  < " + $MaxBytes + " byte, matching the page key: " + $targets.Count + " file(s)")
foreach ($t in $targets) {
  Say ("  " + $t.LastWriteTime.ToString('yyyy-MM-dd HH:mm:ss') + "  " +
    $t.Length.ToString().PadLeft(7) + "  " + $t.Name)
  if (-not $WhatIf) {
    try {
      Remove-Item -LiteralPath $t.FullName -Force -ErrorAction Stop
      Say '        removed'
    } catch {
      Say ("        FAILED: " + $_.Exception.Message)
    }
  }
}
if ($WhatIf) { Say '(WhatIf: nothing was deleted)' }

$left = @(Get-ChildItem -LiteralPath $short -Recurse -Force -File -ErrorAction SilentlyContinue |
  Where-Object { $_.Name -like '*7f3c9a52*' -or $_.Name -like '*og_storePages*' })
Say ('page-keyed entries left: ' + $left.Count)
foreach ($l in $left) { Say ('  ' + $l.LastWriteTime.ToString('yyyy-MM-dd HH:mm:ss') + '  ' + $l.Length.ToString().PadLeft(7)) }
