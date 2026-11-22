$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent $PSScriptRoot
Push-Location $Root

$EmbeddedBin = Join-Path $Root "src-tauri\embedded_runtime.bin"
$EmbeddedSha = Join-Path $Root "src-tauri\embedded_runtime.sha"

try {
  Write-Host "==> Packing deduplicated CPU + Vulkan runtime for single-EXE embedding..." -ForegroundColor Cyan
  node (Join-Path $Root "scripts\pack_runtime.mjs")
  if ($LASTEXITCODE -ne 0) {
    throw "pack_runtime.mjs failed with exit code $LASTEXITCODE"
  }

  Write-Host "==> Building single standalone LocalAI.exe..." -ForegroundColor Cyan
  npm.cmd run tauri build -- --no-bundle --features embed-runtime
  if ($LASTEXITCODE -ne 0) {
    throw "tauri build failed with exit code $LASTEXITCODE"
  }

  $ExeSrc = Join-Path $Root "src-tauri\target\release\localai.exe"
  if (!(Test-Path $ExeSrc)) {
    throw "Expected release binary not found at $ExeSrc"
  }

  $RootExe = Join-Path $Root "LocalAI.exe"
  Stop-Process -Name "LocalAI","localai" -Force -ErrorAction SilentlyContinue
  Start-Sleep -Milliseconds 300
  Copy-Item $ExeSrc $RootExe -Force

  # Clean legacy multi-file portable stage/zip in dist/ so dist/ stays clean
  $LegacyStage = Join-Path $Root "dist\LocalAI"
  if (Test-Path $LegacyStage) {
    Remove-Item -Recurse -Force $LegacyStage
  }
  $LegacyZip = Join-Path $Root "dist\LocalAI-win-x64.zip"
  if (Test-Path $LegacyZip) {
    Remove-Item -Force $LegacyZip
  }

  $SizeMb = [math]::Round((Get-Item $RootExe).Length / 1MB, 2)
  Write-Host "==> Single portable LocalAI.exe ready: $RootExe ($SizeMb MB)" -ForegroundColor Green
}
finally {
  if (Test-Path $EmbeddedBin) { Remove-Item -Force $EmbeddedBin }
  if (Test-Path $EmbeddedSha) { Remove-Item -Force $EmbeddedSha }
  Pop-Location
}
