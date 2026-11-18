# Disposable CI only. Starts the installed Blackcrab the way a person does, by
# running its launcher, and watches from outside: no native command, test-only
# launcher feature or agent prompt is used. The launcher sets up and starts the
# background service and opens the workspace by itself.
#
# -Seed <setup.exe> installs the published 0.4.4, opens it once so that it sets
# up and starts its background service, and records that service's identity in
# -SeedRecord. A later run with -Report and the same -SeedRecord then opens the
# candidate over that installation and checks the service was upgraded with
# its identity and data kept.
param([string]$Report, [string]$Seed, [string]$SeedRecord)
$ErrorActionPreference = 'Stop'
if ($env:GITHUB_ACTIONS -ne 'true' -or $env:RUNNER_OS -ne 'Windows') { throw 'Disposable GitHub Windows runner required' }
$released = [ordered]@{ version = '0.4.4'; sha256 = '9afeb41f161e5281b1f1b0cda2667e93c99496dcfbe63fd90b0d0d5b1b9f91bb'; manifest = '54e12d14ab2455530dbce83c3028940595eed637181514264059087610097648' }
$appData = Join-Path $env:APPDATA 'com.bonjenn.blackcrab'
# Test launches must not send product events to the real analytics endpoint.
$env:BLACKCRAB_ANALYTICS = 'off'
if ($Seed) {
  if (-not $SeedRecord) { throw '-SeedRecord is required with -Seed' }
  if ((Get-FileHash -LiteralPath $Seed -Algorithm SHA256).Hash.ToLower() -ne $released.sha256) { throw 'The released installer to upgrade from is not the published one' }
  if (Test-Path -LiteralPath $appData) { throw 'Refusing existing Blackcrab application data' }
  $output = Join-Path (Split-Path -Parent $SeedRecord) 'seed-acceptance'
  $directory = Join-Path $env:RUNNER_TEMP 'blackcrab-released'
  if (Test-Path -LiteralPath $directory) { throw 'Refusing an existing released installation directory' }
  # /D must be last and unquoted. Silent, for this user only, as a person's installation is.
  $setup = Start-Process -FilePath $Seed -ArgumentList '/S', "/D=$directory" -Wait -PassThru
  if ($setup.ExitCode -ne 0) { throw "The released installer exited $($setup.ExitCode)" }
  $launcher = Join-Path $directory 'blackcrab.exe'
  if (-not (Test-Path -LiteralPath $launcher)) { throw 'The released installer did not install its launcher' }
  $rounds = @('released')
} else {
  if (-not $Report) { throw '-Report is required' }
  $plan = Get-Content -LiteralPath $Report -Raw | ConvertFrom-Json
  if ($plan.passed -ne $true -or $plan.target -ne 'win32-x64' -or $plan.published -ne $false) { throw 'Verified local Windows installer candidate required' }
  $launcher = $plan.launcher
  if ((Get-FileHash -LiteralPath $launcher -Algorithm SHA256).Hash.ToLower() -ne $plan.installedRootSha256) { throw 'Installed launcher changed after verification' }
  if ($SeedRecord) { if (-not (Test-Path -LiteralPath $SeedRecord)) { throw 'The released installation to upgrade was not recorded' } }
  elseif (Test-Path -LiteralPath $appData) { throw 'Refusing existing Blackcrab application data' }
  $output = Join-Path (Split-Path -Parent $Report) 'ui-acceptance'
  $rounds = @('first-launch', 'reopen')
}
New-Item -ItemType Directory -Path $output | Out-Null
$result = [ordered]@{ passed = $false; agentPromptsSent = 0; published = $false; sessions = @() }

Add-Type -AssemblyName System.Windows.Forms, System.Drawing
function Save-Screen([string]$name) {
  try {
    $bounds = [System.Windows.Forms.SystemInformation]::VirtualScreen
    $image = New-Object System.Drawing.Bitmap $bounds.Width, $bounds.Height
    $graphics = [System.Drawing.Graphics]::FromImage($image)
    $graphics.CopyFromScreen($bounds.Left, $bounds.Top, 0, 0, $image.Size)
    $image.Save((Join-Path $output $name))
  } catch { }
}
# The launcher and the workspace are both named Blackcrab. They are told apart
# by where their program is: the installed launcher, or the payload cache.
function Get-Blackcrab {
  Get-Process -Name 'blackcrab' -ErrorAction SilentlyContinue | ForEach-Object {
    $path = $null; try { $path = $_.Path } catch { }
    [pscustomobject]@{ Process = $_; Path = $path }
  }
}
function Get-Workspace { Get-Blackcrab | Where-Object { $_.Path -and $_.Path.StartsWith($appData, [StringComparison]::OrdinalIgnoreCase) -and $_.Process.MainWindowHandle -ne 0 } | Select-Object -First 1 }
function Get-Launcher { Get-Blackcrab | Where-Object { $_.Path -and $_.Path -ieq $launcher } }
function Get-ServiceTask {
  $rows = & schtasks.exe /Query /FO CSV /NH 2>$null | ConvertFrom-Csv -Header Name, Next, Status
  $rows | Where-Object { $_.Name -like '*Blackcrab Service *' }
}
# How many times the service has answered the interface's own authenticated
# request for its workspace state. The window's title alone is not enough: an
# error screen has the same title, and only a loaded, signed-in interface
# makes this request.
function Get-InterfaceAnswers {
  $trace = Join-Path $appData 'managed-host\v1\host\userdata\logs\server.trace.ndjson'
  if (-not (Test-Path -LiteralPath $trace)) { return 0 }
  @(Get-Content -LiteralPath $trace | Where-Object { $_ -match '/api/orchestration/shell' -and $_ -match '"http\.response\.status_code":200' }).Count
}
# Evidence for a failure: the service's own records and what it answers.
function Get-ServiceEvidence {
  $evidence = [ordered]@{}
  $owner = Join-Path $appData 'managed-host\v1'
  $files = @('logs\service-supervisor.log', 'logs\boot-service.log')
  $logs = Join-Path $owner 'host\userdata\logs'
  if (Test-Path -LiteralPath $logs) { $files += @(Get-ChildItem -LiteralPath $logs -File -Recurse | Sort-Object LastWriteTime -Descending | Select-Object -First 4 | ForEach-Object { $_.FullName.Substring($owner.Length + 1) }) }
  foreach ($file in $files) {
    $path = Join-Path $owner $file
    if (Test-Path -LiteralPath $path) { $evidence[$file] = ((Get-Content -LiteralPath $path -Tail 60) -join "`n") -replace '[A-Za-z0-9_\-=]{32,}', '[redacted]' }
  }
  # The longest paths in the payload cache: many Windows programs and
  # libraries cannot open a path longer than 260 characters.
  $cache = Join-Path $appData 'payloads'
  if (Test-Path -LiteralPath $cache) {
    $longest = @(Get-ChildItem -LiteralPath $cache -Recurse -File -Force -ErrorAction SilentlyContinue | Sort-Object { $_.FullName.Length } -Descending | Select-Object -First 5)
    $evidence['longest-cache-paths'] = (@($longest | ForEach-Object { "$($_.FullName.Length) $($_.FullName.Substring($appData.Length))" })) -join "`n"
  }
  # Failed work and answered requests in the service's and the workspace's
  # own traces: which request got the error, and why.
  $traces = [ordered]@{ service = (Join-Path $owner 'host\userdata\logs\server.trace.ndjson'); workspace = (Join-Path $owner 'native-desktop-profile-v1\userdata\logs\desktop.trace.ndjson') }
  foreach ($kind in $traces.Keys) {
    $trace = $traces[$kind]
    if (-not (Test-Path -LiteralPath $trace)) { $evidence["$kind-trace"] = 'absent'; continue }
    $lines = Get-Content -LiteralPath $trace
    $failed = @($lines | Where-Object { $_ -match '"_tag":"Failure"' } | Select-Object -Last 10 | ForEach-Object { ($_ -replace '[A-Za-z0-9_\-=]{32,}', '[redacted]').Substring(0, [Math]::Min(1800, $_.Length)) })
    $evidence["$kind-failures"] = $failed -join "`n"
    $answers = @{}
    foreach ($line in $lines) {
      if ($line -match '"http\.response\.status_code":(\d+)') {
        $status = $Matches[1]; $path = '?'
        if ($line -match '"(?:url\.path|http\.route|http\.target)":"([^"?]{1,120})') { $path = $Matches[1] }
        $key = "$status $path"; $answers[$key] = 1 + [int]$answers[$key]
      }
    }
    $evidence["$kind-answers"] = (@($answers.GetEnumerator() | Sort-Object Name | ForEach-Object { "$($_.Name) x$($_.Value)" }) | Select-Object -First 60) -join "`n"
  }
  foreach ($route in '/.well-known/t3/environment', '/api/auth/session') {
    try { $reply = Invoke-WebRequest -Uri ("http://127.0.0.1:3773" + $route) -UseBasicParsing -TimeoutSec 20 -SkipHttpErrorCheck
      $evidence[$route] = "$($reply.StatusCode) " + ("$($reply.Content)" -replace '[A-Za-z0-9_\-=]{32,}', '[redacted]').Substring(0, [Math]::Min(1500, "$($reply.Content)".Length))
    } catch { $evidence[$route] = "failed: $($_.Exception.Message)" }
  }
  $evidence
}
# What must survive an upgrade, and what must change: digests and names only.
function Get-ServiceRecord {
  $owner = Join-Path $appData 'managed-host\v1'
  $configuration = Get-Content -LiteralPath (Join-Path $owner 'configuration.json') -Raw | ConvertFrom-Json
  $binding = Get-Content -LiteralPath (Join-Path $owner 'native-issuer-binding.json') -Raw | ConvertFrom-Json
  $layout = Get-Content -LiteralPath (Join-Path $owner 'host\runtime\versions\0.1.7\.blackcrab-service-layout.json') -Raw | ConvertFrom-Json
  $secret = [BitConverter]::ToString([Security.Cryptography.SHA256]::Create().ComputeHash([Text.Encoding]::UTF8.GetBytes($configuration.bootstrapSecret))).Replace('-', '')
  $database = Join-Path $owner 'host\userdata\statev2.sqlite'
  [ordered]@{ manifest = $configuration.manifestDigest; bindingManifest = $binding.manifestSha256; layoutManifest = $layout.manifestSha256
    generation = "$($binding.generation)"; secret = $secret
    environment = (Get-FileHash -LiteralPath (Join-Path $owner 'host\userdata\environment-id') -Algorithm SHA256).Hash
    database = ((Test-Path -LiteralPath $database) -and (Get-Item -LiteralPath $database).Length -gt 0) }
}
function Test-Upgrade($seed) {
  $owner = Join-Path $appData 'managed-host\v1'
  $now = Get-ServiceRecord; $old = $seed.manifest
  if ($old -ne $released.manifest -or $seed.bindingManifest -ne $old -or $seed.layoutManifest -ne $old) { throw 'The released installer did not install the service runtime this check expects' }
  if ($now.bindingManifest -ne $now.manifest -or $now.layoutManifest -ne $now.manifest) { throw 'The service runtime was not replaced consistently' }
  foreach ($key in 'generation', 'environment', 'secret') { if ("$($now[$key])" -ne "$($seed.$key)") { throw "The upgrade changed the service's $key" } }
  if (-not $seed.database -or -not $now.database) { throw 'The service database is missing' }
  # This candidate carries the released runtime unchanged: nothing to replace.
  if ($now.manifest -eq $old) { return [ordered]@{ from = $old; to = $old; runtimeReplaced = $false; identityRetained = $true } }
  $retired = Join-Path $owner "host\runtime\retired\$old"
  $kept = Get-Content -LiteralPath (Join-Path $retired '.blackcrab-service-layout.json') -Raw | ConvertFrom-Json
  if ($kept.manifestSha256 -ne $old -or -not (Test-Path -LiteralPath (Join-Path $retired 'payload\t3.exe'))) { throw 'The previous runtime was not kept whole' }
  if (-not (Test-Path -LiteralPath (Join-Path $owner "host\upgrade-backups\$($old.Substring(0, 16))\statev2.sqlite"))) { throw 'The database was not copied before the upgrade' }
  [ordered]@{ from = $old; to = $now.manifest; runtimeReplaced = $true; identityRetained = $true; previousRuntimeKept = $true; databaseCopied = $true }
}
function Get-Identity {
  $owner = Join-Path $appData 'managed-host\v1'
  ('configuration.json', 'host\userdata\environment-id' | ForEach-Object { (Get-FileHash -LiteralPath (Join-Path $owner $_) -Algorithm SHA256).Hash }) -join ':'
}

# Windows keeps the workspace's saved sign-in in the account's Credential
# Manager, outside any profile directory. An earlier step of this same job
# ran a workspace against a different, now removed, service; what it saved
# is recorded by name and removed, as a fresh account would not have it.
function Get-SavedSignIns {
  @(& cmdkey.exe /list 2>$null | ForEach-Object { if ($_ -match 'Target:\s*(.+)$') { $Matches[1].Trim() } } | Where-Object { $_ -match 'blackcrab|t3code|t3 code' })
}
$result.savedSignInsBefore = @(Get-SavedSignIns)
# Over a released installation the saved sign-in is that installation's own and stays.
if (-not $SeedRecord -or $Seed) {
  foreach ($target in $result.savedSignInsBefore) { & cmdkey.exe /delete:$target 2>$null | Out-Null }
  $result.savedSignInsRemoved = ($result.savedSignInsBefore.Count -gt 0 -and @(Get-SavedSignIns).Count -eq 0)
}

try {
  $before = $null
  foreach ($round in $rounds) {
    $answeredBefore = Get-InterfaceAnswers
    $root = Start-Process -FilePath $launcher -PassThru
    $deadline = (Get-Date).AddSeconds(480); $workspace = $null; $title = ''
    while ((Get-Date) -lt $deadline) {
      $workspace = Get-Workspace
      if ($workspace) {
        $workspace.Process.Refresh(); $title = $workspace.Process.MainWindowTitle
        # The window takes this title from the interface once it has loaded.
        if ($title -like 'Blackcrab*') { break }
      }
      if ($root.HasExited -and -not $workspace) { throw "The launcher exited ($($root.ExitCode)) before a workspace opened" }
      Start-Sleep -Milliseconds 500
    }
    if (-not $workspace -or $title -notlike 'Blackcrab*') { throw "No loaded workspace window appeared (last title: '$title')" }
    # Let the acknowledged window finish its first paint for the kept image.
    Start-Sleep -Seconds 10
    Save-Screen "$round-workspace.png"
    $answered = 0
    for ($attempt = 0; $attempt -lt 60 -and $answered -le $answeredBefore; $attempt++) { $answered = Get-InterfaceAnswers; if ($answered -le $answeredBefore) { Start-Sleep -Seconds 1 } }
    if ($answered -le $answeredBefore) { throw 'The workspace window opened but its interface never loaded its workspace state' }
    $task = Get-ServiceTask
    if (@($task).Count -ne 1 -or $task.Status -ne 'Running') { throw "Background service task is not running: $(@($task | ForEach-Object { $_.Status }) -join ',')" }
    $identity = Get-Identity
    if ($before -and $before -ne $identity) { throw 'Reopening changed the persistent service identity' }
    $before = $identity
    if ($Seed) { Get-ServiceRecord | ConvertTo-Json | Set-Content -LiteralPath $SeedRecord }
    elseif ($SeedRecord -and $round -eq 'first-launch') { $result.upgrade = Test-Upgrade (Get-Content -LiteralPath $SeedRecord -Raw | ConvertFrom-Json) }
    # Quit as a person would: close the workspace window. The launcher, hidden
    # since the handoff, must then exit too; the service must not.
    if (-not $workspace.Process.CloseMainWindow()) { throw 'The workspace window refused a close request' }
    $deadline = (Get-Date).AddSeconds(60)
    while ((Get-Date) -lt $deadline -and (-not $workspace.Process.HasExited -or (Get-Launcher))) { Start-Sleep -Milliseconds 500 }
    if (-not $workspace.Process.HasExited) { throw 'Closing its window did not quit the workspace' }
    if (Get-Launcher) { throw 'Quitting the workspace did not close its launcher' }
    $task = Get-ServiceTask
    if (@($task).Count -ne 1 -or $task.Status -ne 'Running') { throw 'The background service did not survive quitting the workspace' }
    $result.sessions += [ordered]@{ round = $round; windowTitle = $title; loadedInterface = $true; closeQuitBoth = $true; serviceSurvived = $true; identityRetained = $true }
  }
  $result.passed = $true
} catch {
  $result.error = "$($_.Exception.Message)".Substring(0, [Math]::Min(500, "$($_.Exception.Message)".Length))
  Save-Screen 'failure-screen.png'
  $result.processes = @(Get-Blackcrab | ForEach-Object { [ordered]@{ title = $_.Process.MainWindowTitle; window = ($_.Process.MainWindowHandle -ne 0); launcher = ($_.Path -ieq $launcher) } })
  $result.serviceTasks = @(Get-ServiceTask | ForEach-Object { $_.Status })
  $result.savedSignInsAtFailure = @(Get-SavedSignIns)
  try { $result.service = Get-ServiceEvidence } catch { $result.service = "evidence failed: $($_.Exception.Message)" }
} finally {
  # This run's own launcher, workspace and scheduled task only.
  $cleanup = @()
  Get-Blackcrab | Where-Object { $_.Path -and ($_.Path -ieq $launcher -or $_.Path.StartsWith($appData, [StringComparison]::OrdinalIgnoreCase)) } | ForEach-Object { try { $_.Process.Kill() } catch { } }
  # The released installation's service stays for the candidate to upgrade.
  foreach ($task in @(if ($Seed -and $result.passed) { @() } else { Get-ServiceTask })) {
    $name = $task.Name
    & schtasks.exe /End /TN $name 2>$null | Out-Null
    & schtasks.exe /Delete /F /TN $name 2>$null | Out-Null
    if ($LASTEXITCODE -ne 0) { $cleanup += 'scheduled task' }
  }
  $result.cleanupErrors = $cleanup
  if ($cleanup.Count) { $result.passed = $false }
  $result | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $output 'result.json')
}
if (-not $result.passed -or $result.sessions.Count -ne $rounds.Count) { Write-Output ($result | ConvertTo-Json -Depth 6); throw 'Installed graphical acceptance did not pass' }
if ($Seed) { Write-Output "RELEASED_$($released.version)_INSTALLED_AND_OPENED_FOR_UPGRADE"; return }
if ($SeedRecord) {
  if ($result.upgrade.identityRetained -ne $true) { Write-Output ($result | ConvertTo-Json -Depth 6); throw 'The upgrade from the released version was not verified' }
  Write-Output ("UPGRADE_FROM_RELEASED_$($released.version)_KEPT_SERVICE_IDENTITY_AND_DATA" + $(if ($result.upgrade.runtimeReplaced) { '' } else { '_RUNTIME_UNCHANGED' }))
}
Write-Output 'INSTALLED_WINDOWS_WORKSPACE_ACCEPTANCE_PASSED'
