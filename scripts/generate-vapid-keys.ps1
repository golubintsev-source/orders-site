# Генерация VAPID-ключей для Web Push без Node.js (Windows PowerShell + .NET)
function To-Base64Url([byte[]]$Bytes) {
  $b64 = [Convert]::ToBase64String($Bytes)
  return $b64.TrimEnd('=').Replace('+', '-').Replace('/', '_')
}

$ec = [System.Security.Cryptography.ECDsa]::Create()
$ec.GenerateKey([System.Security.Cryptography.ECCurve]::NamedCurves.nistP256)
$p = $ec.ExportParameters($true)

$pub = New-Object byte[] 65
$pub[0] = 0x04
[Array]::Copy($p.Q.X, 0, $pub, 1 + (32 - $p.Q.X.Length), $p.Q.X.Length)
[Array]::Copy($p.Q.Y, 0, $pub, 1 + 32 + (32 - $p.Q.Y.Length), $p.Q.Y.Length)

$priv = New-Object byte[] 32
[Array]::Copy($p.D, 0, $priv, 32 - $p.D.Length, $p.D.Length)

$pubB64 = To-Base64Url $pub
$privB64 = To-Base64Url $priv
$secret = -join ((48..57 + 65..90 + 97..122 | Get-Random -Count 32 | ForEach-Object { [char]$_ }))

Write-Host ""
Write-Host "Скопируйте эти значения в Vercel -> Settings -> Environment Variables:" -ForegroundColor Cyan
Write-Host ""
Write-Host "VAPID_PUBLIC_KEY=$pubB64"
Write-Host "VAPID_PRIVATE_KEY=$privB64"
Write-Host "VAPID_SUBJECT=mailto:ВАШ_EMAIL@example.com"
Write-Host "PUSH_WEBHOOK_SECRET=$secret"
Write-Host ""
$ec.Dispose()
