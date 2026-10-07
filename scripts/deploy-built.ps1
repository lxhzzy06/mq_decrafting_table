$ErrorActionPreference = 'Stop'
$workspaceRoot = Split-Path -Parent $PSScriptRoot
$minecraftRoot = Join-Path $env:APPDATA 'Minecraft Bedrock/users/shared/games/com.mojang'
$packs = @(
    @{ Name = 'mq_decrafting_table_bp'; Kind = 'development_behavior_packs'; Uuid = 'b200fcb0-1af8-460d-aa70-dc1b9e361158' },
    @{ Name = 'mq_decrafting_table_rp'; Kind = 'development_resource_packs'; Uuid = '57133ec7-a62c-46f9-b391-5bdcde4ad417' }
)
foreach ($pack in $packs) {
    $pack.Source = Join-Path $workspaceRoot ('target/' + $pack.Name)
    $pack.Destination = Join-Path $minecraftRoot ($pack.Kind + '/' + $pack.Name)
    $sourceManifest = Get-Content -LiteralPath (Join-Path $pack.Source 'manifest.json') -Raw | ConvertFrom-Json
    if ($sourceManifest.header.uuid -ne $pack.Uuid) { throw 'Unexpected built pack UUID' }
    $manifestPath = Join-Path $pack.Destination 'manifest.json'
    if (Test-Path -LiteralPath $manifestPath) {
        $manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
        if ($manifest.header.uuid -ne $pack.Uuid) { throw 'Unexpected installed pack UUID' }
    }
}
$backupRoot = Join-Path $workspaceRoot ('.workbuddy/deploy-backup-' + (Get-Date -Format 'yyyyMMdd-HHmmss'))
$copied = 0
foreach ($pack in $packs) {
    foreach ($file in Get-ChildItem -LiteralPath $pack.Source -Recurse -File) {
        $relative = [IO.Path]::GetRelativePath($pack.Source, $file.FullName)
        $destination = Join-Path $pack.Destination $relative
        if (Test-Path -LiteralPath $destination) {
            if ((Get-FileHash -LiteralPath $file.FullName).Hash -eq (Get-FileHash -LiteralPath $destination).Hash) { continue }
            $backup = Join-Path $backupRoot ($pack.Name + '/' + $relative)
            New-Item -ItemType Directory -Path (Split-Path -Parent $backup) -Force | Out-Null
            Copy-Item -LiteralPath $destination -Destination $backup
        }
        New-Item -ItemType Directory -Path (Split-Path -Parent $destination) -Force | Out-Null
        Copy-Item -LiteralPath $file.FullName -Destination $destination -Force
        if ((Get-FileHash -LiteralPath $file.FullName).Hash -ne (Get-FileHash -LiteralPath $destination).Hash) {
            throw "Hash mismatch: $relative"
        }
        $copied++
    }
    # Remove only obsolete generated files in this exact, UUID-validated pack, with backups.
    $obsolete = @()
    if ($pack.Name -eq 'mq_decrafting_table_bp') {
        foreach ($folder in @('recipes/decrafting', 'items/decrafting', 'loot_tables/decrafting')) {
            $oldFolder = Join-Path $pack.Destination $folder
            if (Test-Path -LiteralPath $oldFolder) {
                $obsolete += Get-ChildItem -LiteralPath $oldFolder -Filter '*.json' -File | Where-Object {
                    -not (Test-Path -LiteralPath (Join-Path $pack.Source ([IO.Path]::GetRelativePath($pack.Destination, $_.FullName))))
                }
            }
        }
    } else {
        $oldUi = Join-Path $pack.Destination 'ui/chest_screen.json'
        if (Test-Path -LiteralPath $oldUi) {
            $uiText = Get-Content -LiteralPath $oldUi -Raw
            if ($uiText -notmatch 'MQDT') { throw 'Unrecognized legacy chest UI, preserved' }
            $obsolete += Get-Item -LiteralPath $oldUi
        }
    }
    foreach ($file in $obsolete) {
        $absolute = [IO.Path]::GetFullPath($file.FullName)
        $packRoot = [IO.Path]::GetFullPath($pack.Destination) + [IO.Path]::DirectorySeparatorChar
        if (-not $absolute.StartsWith($packRoot, [StringComparison]::OrdinalIgnoreCase)) { throw 'Cleanup path escaped pack' }
        $relative = [IO.Path]::GetRelativePath($pack.Destination, $absolute)
        $backup = Join-Path $backupRoot ($pack.Name + '/' + $relative)
        New-Item -ItemType Directory -Path (Split-Path -Parent $backup) -Force | Out-Null
        Copy-Item -LiteralPath $absolute -Destination $backup -Force
        Remove-Item -LiteralPath $absolute
    }
}
Write-Output "Deployed $copied verified files. Old files backed up under $backupRoot"
