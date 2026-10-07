$ErrorActionPreference = 'Stop'
$minecraftRoot = Join-Path $env:APPDATA 'Minecraft Bedrock/users/shared/games/com.mojang'
$packs = @(
    @{ Source = 'bp'; Target = 'development_behavior_packs/mqdt_exp_bp'; Uuid = '3f2a1b40-1c11-4e01-9a01-000000000001' },
    @{ Source = 'rp'; Target = 'development_resource_packs/mqdt_exp_rp'; Uuid = '3f2a1b40-1c11-4e01-9a01-000000000011' }
)
# Validate both destinations before copying either pack. No deletion, no production-pack writes.
foreach ($pack in $packs) {
    $pack.SourcePath = Join-Path $PSScriptRoot $pack.Source
    $pack.TargetPath = Join-Path $minecraftRoot $pack.Target
    $manifestPath = Join-Path $pack.TargetPath 'manifest.json'
    if (-not (Test-Path -LiteralPath $manifestPath)) { throw "Missing existing experiment: $manifestPath" }
    $manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
    if ($manifest.header.uuid -ne $pack.Uuid) { throw "Unexpected pack UUID: $manifestPath" }
}
$copied = 0
foreach ($pack in $packs) {
    foreach ($file in Get-ChildItem -LiteralPath $pack.SourcePath -Recurse -File) {
        $relative = [IO.Path]::GetRelativePath($pack.SourcePath, $file.FullName)
        $destination = Join-Path $pack.TargetPath $relative
        $parent = Split-Path -Parent $destination
        New-Item -ItemType Directory -Path $parent -Force | Out-Null
        Copy-Item -LiteralPath $file.FullName -Destination $destination -Force
        if ((Get-FileHash -LiteralPath $file.FullName).Hash -ne (Get-FileHash -LiteralPath $destination).Hash) {
            throw "Hash mismatch: $relative"
        }
        $copied++
    }
}
Write-Output "Synced $copied experiment files; all SHA-256 hashes match. Reload the world to load them."
