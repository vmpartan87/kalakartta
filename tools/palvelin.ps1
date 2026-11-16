# Yksinkertainen paikallinen palvelin testaukseen ilman Pythonia.
# Kaytto: powershell -ExecutionPolicy Bypass -File tools\palvelin.ps1   ->  http://localhost:8000
param([int]$Port = 8000)
$root = Split-Path -Parent $PSScriptRoot
$mime = @{ '.html' = 'text/html; charset=utf-8'; '.js' = 'text/javascript; charset=utf-8'; '.css' = 'text/css; charset=utf-8';
    '.json' = 'application/json; charset=utf-8'; '.webmanifest' = 'application/manifest+json'; '.png' = 'image/png'; '.svg' = 'image/svg+xml'; '.ico' = 'image/x-icon' }
$l = New-Object Net.HttpListener
$l.Prefixes.Add("http://localhost:$Port/")
$l.Start()
Write-Host "Palvelin käynnissä: http://localhost:$Port/  (Ctrl+C lopettaa)"
while ($l.IsListening) {
    $c = $l.GetContext()
    $path = [Uri]::UnescapeDataString($c.Request.Url.AbsolutePath).TrimStart('/')
    if ($path -eq '' -or $path.EndsWith('/')) { $path += 'index.html' }
    $file = Join-Path $root $path
    $full = [IO.Path]::GetFullPath($file)
    if ($full.StartsWith($root) -and (Test-Path $full -PathType Leaf)) {
        $ext = [IO.Path]::GetExtension($full).ToLower()
        $c.Response.ContentType = if ($mime.ContainsKey($ext)) { $mime[$ext] } else { 'application/octet-stream' }
        $c.Response.Headers.Add('Cache-Control', 'no-cache')
        $b = [IO.File]::ReadAllBytes($full)
        $c.Response.ContentLength64 = $b.Length
        try { $c.Response.OutputStream.Write($b, 0, $b.Length) } catch {}
    } else { $c.Response.StatusCode = 404 }
    try { $c.Response.Close() } catch {}
}
