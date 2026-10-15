# Read the phone in mass storage mode, read-only. One command, three questions.
#
#   1. What did the client keep?      <phone>\Data\SharedData\EdmCache - the response cache,
#      keyed by the exact Store request, with the storePages entries copied out and opened:
#      size, SHA-256, first bytes, and every <a:updated> value in them.
#   2. Did it leave a reason behind?  <phone>\Data\Users\Public\Documents\Debug - the crash
#      drop, readable without elevation, plus Documents\LiveStore and the phone's own error
#      log. The app's private state is NOT here and cannot be read this way: see below.
#   3. What moved?                    everything under <phone>\Data modified after -Since,
#      with user hives, telemetry and ETW blobs filtered out.
#
# Run it from an elevated prompt:
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File tools\phone-readout.ps1
#   powershell ... -File tools\phone-readout.ps1 -Since '2026-10-15 18:33:00' -Keepers
#
# It writes only under -OutDir (default `.selftest` next to this script) on this PC, and never
# writes to the phone.
# NOTE: .selftest is wiped by every `npm run selftest` run, so anything worth keeping has to
# be copied out of it; this script is kept under tools/ for exactly that reason.
#
# Why elevation: `Data\SharedData\EdmCache` answered "Accesso negato" to a normal prompt on
# 2026-10-15 (it had been readable in an earlier session), `Windows\System32\config` is ACLed
# to SYSTEM and Administrators, and `Data\Users\DefApps` lists Administrators by inheritance.
# What elevation does NOT buy: `Data\Users\DefApps\APPDATA` is owned by
# S-1-5-21-2702878673-795188819-444038987-2781 and denies an elevated read too, so the Store
# client's own database and logs stay out of reach (docs/FINDINGS.md, F-004). Getting past that
# means taking ownership - a write to the device, and a decision, not a mechanic.
#
# The volume is discovered, never assumed: it was G: in the first session and H: on
# 2026-10-15, and the markers it probes are ones a normal user can read.

param(
  # PowerShell variable names are case-INsensitive, so this must not be called `$Out` while
  # `$out` below exists: they are the same variable, and the report path would overwrite the
  # output directory. That bug created a directory named `phone-readout.txt` on the first run.
  [string]$OutDir = (Join-Path $PSScriptRoot '..\.selftest'),
  [datetime]$Since = (Get-Date).AddHours(-8),
  [switch]$Keepers
)

$ErrorActionPreference = 'Continue'
$outFile = Join-Path $OutDir 'phone-readout.txt'
$cacheOut = Join-Path $OutDir 'phone-edmcache'
$debugOut = Join-Path $OutDir 'phone-debug'

foreach ($dir in @($OutDir, $cacheOut, $debugOut)) {
  if (-not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
}

function W([string]$s) { Add-Content -Path $outFile -Value $s -Encoding UTF8 }
function Line([string]$s) { W $s }

Set-Content -Path $outFile -Value '' -Encoding UTF8

$id = [Security.Principal.WindowsIdentity]::GetCurrent()
$isAdmin = (New-Object Security.Principal.WindowsPrincipal($id)).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
Line ("utente : " + $id.Name)
Line ("admin  : " + $isAdmin)
Line ("inizio : " + (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'))
Line ("soglia : file modificati dopo " + $Since.ToString('yyyy-MM-dd HH:mm:ss'))
Line ("uscita : " + (Resolve-Path -LiteralPath $OutDir).Path)

# ------------------------------------------------- quale volume e' il telefono
Line ''
Line '=== volumi, e quale e il telefono ==='
$phone = $null
$markers = @('\Data\Users\Public', '\Data\SharedData', '\Windows\System32\config\SOFTWARE')
foreach ($v in (Get-Volume | Where-Object { $_.DriveLetter })) {
  $letter = $v.DriveLetter
  $hit = ''
  foreach ($m in $markers) {
    # -ErrorAction SilentlyContinue: a marker inside a tree this prompt may not read answers
    # "Accesso negato", which is exactly the signal that matters, not an error to print.
    if (Test-Path -LiteralPath ("${letter}:" + $m) -ErrorAction SilentlyContinue) { $hit = $m; break }
  }
  # NOTE: no ternary here on purpose. `$a ? $b : $c` is PowerShell 7 and later; this file has to
  # run on the Windows PowerShell 5.1 that ships with Windows, where `?` is a parse error.
  $shown = if ($hit) { $hit } else { '(nessuno)' }
  Line ("  " + $letter + ": " + $v.FileSystem + "  " + [math]::Round($v.Size / 1GB, 2) + " GB  marker: " + $shown)
  if ($hit -and -not $phone) { $phone = "${letter}:" }
}
Line ("  volume scelto : " + $phone)
if (-not $phone) {
  Line 'NESSUN volume del telefono riconosciuto: il telefono non e in mass storage?'
  Line ("fine   : " + (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'))
  exit 1
}
$phoneRoot = $phone + "\"

# ------------------------------------- 1. the client's own copy of what it was served
Line ''
Line ("=== " + $phoneRoot + "Data\SharedData\EdmCache : tutto, con dimensione e data ===")
$entries = @()
try {
  $entries = @(Get-ChildItem -LiteralPath ($phoneRoot + 'Data\SharedData\EdmCache') -Recurse -Force -File -ErrorAction Stop |
    Sort-Object LastWriteTime)
  Line ("  " + $entries.Count + " file")
  foreach ($e in $entries) {
    Line ("  " + $e.LastWriteTime.ToString('yyyy-MM-dd HH:mm:ss') + "  " +
      $e.Length.ToString().PadLeft(9) + "  " + $e.FullName.Substring($phoneRoot.Length))
  }
} catch {
  Line ("  ERRORE: " + $_.Exception.Message)
}

Line ''
Line '=== le voci storePages: copiate fuori e aperte ==='
$store = @($entries | Where-Object { $_.Name -match 'storePages' } | Sort-Object LastWriteTime)
Line ("  " + $store.Count + " voci storePages")
foreach ($e in $store) {
  $safe = ($e.LastWriteTime.ToString('HHmmss') + '_' + $e.Length + '_' + ($e.Name -replace '[^A-Za-z0-9._=-]', '_'))
  if ($safe.Length -gt 120) { $safe = $safe.Substring(0, 120) }
  $dest = Join-Path $cacheOut $safe
  try {
    Copy-Item -LiteralPath $e.FullName -Destination $dest -Force -ErrorAction Stop
  } catch {
    Line ("  copia FALLITA " + $e.Name + " : " + $_.Exception.Message)
    continue
  }
  Line ("  " + $safe)
  Line ("    sha256     : " + (Get-FileHash -LiteralPath $dest -Algorithm SHA256).Hash)
  try {
    $bytes = [IO.File]::ReadAllBytes($dest)
    $hex = ($bytes[0..([Math]::Min(63, $bytes.Length - 1))] | ForEach-Object { $_.ToString('x2') }) -join ' '
    Line ("    primi byte : " + $hex)
    $ascii = -join ($bytes[0..([Math]::Min(255, $bytes.Length - 1))] |
      ForEach-Object { if ($_ -ge 32 -and $_ -lt 127) { [char]$_ } else { '.' } })
    Line ("    in chiaro  : " + $ascii)
    if ($bytes.Length -le 512) {
      Line ("    tutto      : " + (-join ($bytes | ForEach-Object { if ($_ -ge 32 -and $_ -lt 127) { [char]$_ } else { '.' } })))
    }
    $text = [Text.Encoding]::UTF8.GetString($bytes)
    foreach ($needle in @('<feed', 'StorePage', 'Panes', 'Applications', '<a:entry')) {
      $idx = $text.IndexOf($needle)
      if ($idx -ge 0) { Line ("    contiene   : '" + $needle + "' a offset " + $idx) }
    }
    # The page this lab builds stamps the request time into <a:updated>. It is the one field
    # that differs from a fresh render, so it is the field that identifies which build the
    # client kept - and the pane/item counts say which pageFormat it was served.
    $stamps = [regex]::Matches($text, '<a:updated>([^<]*)</a:updated>') | ForEach-Object { $_.Groups[1].Value }
    Line ("    a:updated  : " + $stamps.Count + " occorrenze, distinte: " + (($stamps | Sort-Object -Unique) -join ', '))
    $panes = ($text -split '</Panes>')[0]
    $items = ([regex]::Matches($text, '<editorialItem>')).Count
    $inPanes = ([regex]::Matches($panes, '<editorialItem>')).Count
    Line ("    struttura  : " + $items + " editorialItem, " + $inPanes + " dentro i panes")
  } catch {
    Line ("    analisi FALLITA : " + $_.Exception.Message)
  }
}

if ($Keepers) {
  Line ''
  Line '=== EDM Keepers ==='
  try {
    foreach ($k in @(Get-ChildItem -LiteralPath ($phoneRoot + 'Data\SharedData\EdmCache\Keepers') -Force -File -ErrorAction Stop | Sort-Object LastWriteTime)) {
      Line ("--- " + $k.Name + "  (" + $k.Length + " byte, " + $k.LastWriteTime.ToString('yyyy-MM-dd HH:mm:ss') + ")")
      Line ("    sha256 : " + (Get-FileHash -LiteralPath $k.FullName -Algorithm SHA256).Hash)
    }
  } catch {
    Line ("  ERRORE: " + $_.Exception.Message)
  }
}

# ------------------------------------------- 2. the reason, if the client left one
Line ''
Line '=== Documents\Debug: referti di crash, per intero ==='
$debugDir = $phoneRoot + 'Data\Users\Public\Documents\Debug'
if (Test-Path -LiteralPath $debugDir) {
  try {
    $reports = @(Get-ChildItem -LiteralPath $debugDir -Recurse -Force -ErrorAction Stop | Sort-Object LastWriteTime -Descending)
    Line ("  " + $reports.Count + " voci")
    foreach ($r in $reports) {
      Line ("--- " + $r.FullName.Substring($phoneRoot.Length) + "  (" + $r.Length + " byte, " + $r.LastWriteTime.ToString('yyyy-MM-dd HH:mm:ss') + ")")
      try {
        Copy-Item -LiteralPath $r.FullName -Destination (Join-Path $debugOut $r.Name) -Force -ErrorAction Stop
        Line ("    copiato in " + (Resolve-Path -LiteralPath $debugOut).Path + "\" + $r.Name)
      } catch {
        Line ("    copia FALLITA: " + $_.Exception.Message)
      }
      try {
        # These reports are written in UTF-16LE with a BOM; read them as such, or every letter
        # arrives separated by a NUL and the one file that explains a crash reads as noise.
        $read = @(Get-Content -LiteralPath $r.FullName -TotalCount 80 -ErrorAction Stop)
        if ($read.Count -gt 0 -and $read[0] -match "`0") {
          $read = @(Get-Content -LiteralPath $r.FullName -Encoding Unicode -TotalCount 80 -ErrorAction Stop)
        }
        $read | ForEach-Object { Line ("    " + $_) }
      } catch {
        Line ("    non testuale: " + $_.Exception.Message)
      }
    }
  } catch {
    Line ("  ERRORE: " + $_.Exception.Message)
  }
} else {
  Line ("  assente: " + $debugDir)
}

Line ''
Line '=== il log di errore del telefono, per intero ==='
$errorLog = $phoneRoot + 'Data\Users\Public\Documents\Non-Production Errors.txt'
if (Test-Path -LiteralPath $errorLog) {
  $f = Get-Item -LiteralPath $errorLog
  Line ("--- " + $errorLog.Substring($phoneRoot.Length) + "  (" + $f.Length + " byte, " + $f.LastWriteTime.ToString('yyyy-MM-dd HH:mm:ss') + ")")
  try {
    Get-Content -LiteralPath $errorLog -ErrorAction Stop | ForEach-Object { Line ("  " + $_) }
  } catch {
    Line ("  illeggibile: " + $_.Exception.Message)
  }
} else {
  Line ("  non presente: " + $errorLog)
}

Line ''
Line '=== Documents, e altre cartelle pubbliche ==='
foreach ($cand in @(
    'Data\Users\Public\Documents\LiveStore',
    'Data\Users\Public\Documents',
    'Data\Users\Public',
    'Data\SystemData\NonEtwLogs',
    'Data\SharedData\Comms\Unistore\data'
  )) {
  $p = $phoneRoot + $cand
  if (-not (Test-Path -LiteralPath $p -ErrorAction SilentlyContinue)) { Line ("--- " + $cand + "  assente"); continue }
  try {
    $items = @(Get-ChildItem -LiteralPath $p -Recurse -Force -ErrorAction Stop |
      Sort-Object LastWriteTime -Descending | Select-Object -First 25)
    Line ("--- " + $cand + "  (" + $items.Count + " voci)")
    foreach ($i in $items) {
      $kind = if ($i.PSIsContainer) { 'DIR ' } else { '    ' }
      Line ("    " + $kind + $i.LastWriteTime.ToString('yyyy-MM-dd HH:mm:ss') + "  " +
        $i.Length.ToString().PadLeft(9) + "  " + $i.FullName.Substring($p.Length + 1))
    }
  } catch {
    Line ("--- " + $cand + "  ERRORE: " + $_.Exception.Message)
  }
}

Line ''
Line '=== ACL: chi puo leggere cosa (la risposta dice anche cosa resta fuori portata) ==='
foreach ($p in @(
    ($phoneRoot + 'Data\Users\DefApps'),
    ($phoneRoot + 'Data\Users\DefApps\APPDATA'),
    ($phoneRoot + 'Data\Users\DefApps\APPDATA\Local\Packages'),
    ($phoneRoot + 'Data\SharedData')
  )) {
  Line ("--- " + $p)
  try {
    Line ("  proprietario : " + (Get-Acl -LiteralPath $p -ErrorAction Stop).Owner)
  } catch {
    Line ("  proprietario : non leggibile -> " + $_.Exception.Message)
  }
  (icacls $p 2>&1) | Select-Object -First 8 | ForEach-Object { Line ("  " + $_) }
}

# --------------------------------------------------- 3. everything touched lately
Line ''
Line ("=== sotto " + $phoneRoot + "Data, modificato dopo la soglia ( <= 4 MB ) ===")
$recent = @()
try {
  $recent = @(Get-ChildItem -LiteralPath ($phoneRoot + 'Data') -Recurse -Force -File -ErrorAction SilentlyContinue |
    Where-Object { $_.LastWriteTime -gt $Since -and $_.Length -le 4MB } |
    Sort-Object LastWriteTime -Descending)
} catch {
  Line ("  ERRORE: " + $_.Exception.Message)
}
Line ("  " + $recent.Count + " file toccati")
$signal = @($recent | Where-Object {
    $_.Name -notmatch 'ntuser' -and $_.FullName -notmatch '\\Telemetry\\' -and $_.Extension -ne '.etl' -and $_.Extension -ne '.dat'
  })
Line ("  " + $signal.Count + " senza hive, telemetria ed ETW:")
$signal | Select-Object -First 40 | ForEach-Object {
  Line ("  " + $_.LastWriteTime.ToString('yyyy-MM-dd HH:mm:ss') + "  " +
    $_.Length.ToString().PadLeft(9) + "  " + $_.FullName.Substring($phoneRoot.Length))
}

Line ''
Line '=== il contenuto dei file di testo fra quelli ==='
foreach ($f in @($signal | Where-Object { $_.Extension -match '^\.(txt|log|xml|ini|json)$' } | Select-Object -First 10)) {
  Line ''
  Line ("--- " + $f.FullName.Substring($phoneRoot.Length) + "  (" + $f.Length + " byte, " + $f.LastWriteTime.ToString('yyyy-MM-dd HH:mm:ss') + ")")
  try {
    Get-Content -LiteralPath $f.FullName -TotalCount 40 -ErrorAction Stop | ForEach-Object { Line ("  " + $_) }
  } catch {
    Line ("  illeggibile: " + $_.Exception.Message)
  }
}

Line ''
Line '=== ogni *.error.txt sotto Data\Users ==='
try {
  $errors = @(Get-ChildItem -LiteralPath ($phoneRoot + 'Data\Users') -Recurse -Force -File -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -match 'error.*\.txt$' } | Sort-Object LastWriteTime -Descending)
  Line ("  " + $errors.Count + " trovati")
  foreach ($e in $errors) {
    Line ("  " + $e.LastWriteTime.ToString('yyyy-MM-dd HH:mm:ss') + "  " + $e.Length.ToString().PadLeft(9) + "  " + $e.FullName.Substring($phoneRoot.Length))
  }
} catch {
  Line ("  ERRORE: " + $_.Exception.Message)
}

Line ''
Line ("fine   : " + (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'))
