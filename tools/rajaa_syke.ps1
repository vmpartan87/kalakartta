<#
Rajaa Syken syvyysaineistot (shapefile/zip) Kalakartan data-kansioon ilman Pythonia.
Toimii Windowsin omalla PowerShellilla (5.1), ei vaadi asennuksia. Sama logiikka kuin tools/rajaa_syke.py.

Kaytto:
    powershell -ExecutionPolicy Bypass -File tools\rajaa_syke.ps1 syvyysalue.zip syvyyskayra.zip luotauspisteet.zip

Valinnat:
    -BBox 453000,6742500,490000,6778000   rajausalue ETRS-TM35FIN (oletus Iitti-Jaala)
    -MinStep 2                            pisteiden vahimmaisvali metreina
    -Kind @{nimi='alueet'}                pakota tason tyyppi (alueet|kayrat|pisteet|vesi)
    -Depth @{nimi='KENTTA,KENTTA2'}       pakota syvyyskentta(t)
    -Work <kansio>                        purkukansio (oletus %TEMP%\kalakartta-rajaus)
#>
[CmdletBinding(PositionalBinding = $false)]
param(
    [Parameter(Mandatory = $true, Position = 0, ValueFromRemainingArguments = $true)][string[]]$Files,
    [double[]]$BBox = @(453000, 6742500, 490000, 6778000),
    [double]$MinStep = 2,
    [hashtable]$Kind = @{},
    [hashtable]$Depth = @{},
    [string]$Work = (Join-Path $env:TEMP 'kalakartta-rajaus')
)
$ErrorActionPreference = 'Stop'

Add-Type -TypeDefinition @'
using System;
using System.IO;
using System.Text;
using System.Collections.Generic;
using System.Globalization;
using System.Text.RegularExpressions;

public class SykeField { public string Name; public char Type; public int Offset; public int Length; public int Decimals; public bool Num; }

public class SykeResult { public string Kind; public string D1; public string D2; public long Total; public long Count; public string Fields; }

public static class SykeCrop {
    static readonly CultureInfo IC = CultureInfo.InvariantCulture;

    public static string GuessKind(string name, char geom, List<SykeField> fields) {
        string n = name.ToLowerInvariant();
        if (Regex.IsMatch(n, "syvyysalue|depare")) return "alueet";
        if (Regex.IsMatch(n, "syvyyskayr|syvyyskäyr|depcnt|kayra")) return "kayrat";
        if (Regex.IsMatch(n, "luotaus|syvyyspiste|sounding")) return "pisteet";
        if (Regex.IsMatch(n, "ranta|jarv|järv|joet|joki|uoma|vesi")) return "vesi";
        if (geom == 'P') return "pisteet";
        if (geom == 'L') return "kayrat";
        foreach (SykeField f in fields) if (f.Num && Regex.IsMatch(f.Name, "syv|dep|drval", RegexOptions.IgnoreCase)) return "alueet";
        return "vesi";
    }

    static string First(List<string> nums, string pat) {
        foreach (string n in nums) if (Regex.IsMatch(n, pat, RegexOptions.IgnoreCase)) return n;
        return null;
    }

    public static string[] GuessDepth(List<SykeField> fields, string kind) {
        List<string> nums = new List<string>();
        foreach (SykeField f in fields) if (f.Num) nums.Add(f.Name);
        if (kind == "vesi") return new string[] { null, null };
        if (kind == "alueet") {
            string mn = First(nums, "min|drval1|syv.*1"), mx = First(nums, "max|drval2|syv.*2|yla|ylä");
            if (mn != null && mx != null && mn != mx) return new string[] { mn, mx };
        }
        if (kind == "pisteet" && nums.Contains("_z")) {
            string p = First(nums, "syv|dep|valsdp");
            return new string[] { p ?? "_z", null };
        }
        string d = First(nums, "syv|dep|drval|valdco|arvo");
        if (d == null && nums.Count > 0) d = nums[0];
        return new string[] { d, null };
    }

    static int BE(byte[] b, int o) { return (b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]; }

    public static List<SykeField> ReadDbfHeader(BinaryReader r, out int nRec, out int hdrLen, out int recLen) {
        byte[] h = r.ReadBytes(32);
        nRec = BitConverter.ToInt32(h, 4); hdrLen = BitConverter.ToInt16(h, 8); recLen = BitConverter.ToInt16(h, 10);
        List<SykeField> fields = new List<SykeField>();
        int off = 1;
        while (true) {
            byte first = r.ReadByte();
            if (first == 0x0D) break;
            byte[] d = new byte[32]; d[0] = first; r.Read(d, 1, 31);
            int end = 0; while (end < 11 && d[end] != 0) end++;
            SykeField f = new SykeField();
            f.Name = Encoding.GetEncoding(1252).GetString(d, 0, end).Trim();
            f.Type = (char)d[11]; f.Length = d[16]; f.Decimals = d[17]; f.Offset = off;
            f.Num = f.Type == 'N' || f.Type == 'F';
            off += f.Length; fields.Add(f);
        }
        r.BaseStream.Seek(hdrLen, SeekOrigin.Begin);
        return fields;
    }

    static string Esc(string s) { return s.Replace("\\", "\\\\").Replace("\"", "\\\""); }

    static string NumVal(byte[] rec, SykeField f) {
        string s = Encoding.ASCII.GetString(rec, f.Offset, f.Length).Trim();
        if (s.Length == 0 || s[0] == '*') return null;
        double v;
        if (!double.TryParse(s, NumberStyles.Float, IC, out v)) return null;
        if (f.Decimals == 0 && f.Type == 'N' && v == Math.Floor(v) && Math.Abs(v) < 1e15) return ((long)v).ToString(IC);
        return v.ToString("R", IC);
    }

    // "0-1,5" -> ["0","1.5"], "3" -> ["3","3"], muu -> null
    static string[] TextRange(byte[] rec, SykeField f) {
        string s = Encoding.GetEncoding(1252).GetString(rec, f.Offset, f.Length).Trim().Replace(',', '.').Replace(" ", "");
        if (s.Length == 0) return null;
        string[] ps = s.Split('-');
        double lo, hi;
        if (ps.Length == 1 && double.TryParse(ps[0], NumberStyles.Float, IC, out lo)) return new string[] { lo.ToString("R", IC), lo.ToString("R", IC) };
        if (ps.Length == 2 && double.TryParse(ps[0], NumberStyles.Float, IC, out lo) && double.TryParse(ps[1], NumberStyles.Float, IC, out hi)) return new string[] { lo.ToString("R", IC), hi.ToString("R", IC) };
        if (ps.Length == 2 && ps[1].Length == 0 && double.TryParse(ps[0], NumberStyles.Float, IC, out lo)) return new string[] { lo.ToString("R", IC), lo.ToString("R", IC) };
        return null;
    }

    static bool IsPoint(int st) { return st == 1 || st == 11 || st == 21 || st == 8 || st == 18 || st == 28; }

    public static SykeResult Process(string shpPath, string name, double[] bb, double minStep, string kindOver, string depthOver, string outPath) {
        // PowerShell muuttaa $null-merkkijonon tyhjaksi
        if (string.IsNullOrEmpty(kindOver)) kindOver = null;
        if (string.IsNullOrEmpty(depthOver)) depthOver = null;
        string dbfPath = Path.ChangeExtension(shpPath, ".dbf");
        SykeResult res = new SykeResult();
        using (BinaryReader shp = new BinaryReader(new BufferedStream(File.OpenRead(shpPath), 1 << 20)))
        using (BinaryReader dbf = new BinaryReader(new BufferedStream(File.OpenRead(dbfPath), 1 << 20))) {
            byte[] hdr = shp.ReadBytes(100);
            long fileLen = (long)BE(hdr, 24) * 2;
            int fileType = BitConverter.ToInt32(hdr, 32);
            int nRec, hdrLen, recLen;
            List<SykeField> fields = ReadDbfHeader(dbf, out nRec, out hdrLen, out recLen);
            bool hasZ = fileType == 11 || fileType == 18;
            List<SykeField> fieldsK = new List<SykeField>(fields);
            if (hasZ) { SykeField z = new SykeField(); z.Name = "_z"; z.Num = true; fieldsK.Add(z); }
            char geom = IsPoint(fileType) ? 'P' : (fileType == 5 || fileType == 15 || fileType == 25) ? 'A' : 'L';
            string kind = kindOver ?? GuessKind(name, geom, fieldsK);
            string[] dd = GuessDepth(fieldsK, kind);
            if (depthOver != null) {
                string[] ps = depthOver.Split(',');
                dd[0] = ps[0].Length > 0 ? ps[0] : null; dd[1] = ps.Length > 1 ? ps[1] : null;
            }
            // Syke tallentaa syvyyden tekstina ("0-1,5", "3"): muunnetaan numeerisiksi kentiksi syv_min / syv_max
            SykeField txt = null;
            foreach (SykeField f in fields) if (!f.Num && Regex.IsMatch(f.Name, "^(syvyysvali|syvyyskayr)", RegexOptions.IgnoreCase)) txt = f;
            if (txt != null && kind != "vesi") {
                SykeField a1 = new SykeField(); a1.Name = "syv_min"; a1.Num = true; a1.Type = 'V'; fieldsK.Add(a1);
                SykeField a2 = new SykeField(); a2.Name = "syv_max"; a2.Num = true; a2.Type = 'V'; fieldsK.Add(a2);
                if (depthOver == null) { dd[0] = "syv_min"; dd[1] = kind == "alueet" ? "syv_max" : null; }
            }
            res.Kind = kind; res.D1 = dd[0]; res.D2 = dd[1];
            List<string> fn = new List<string>();
            foreach (SykeField f in fieldsK) fn.Add(f.Name + (f.Num ? "#" : ""));
            res.Fields = string.Join(" ", fn.ToArray());
            List<SykeField> keep = new List<SykeField>();
            foreach (string k in dd) {
                if (k == null) continue;
                SykeField hit = null;
                foreach (SykeField f in fieldsK) if (f.Name == k) hit = f;
                if (hit != null) keep.Add(hit);
            }
            double ox = bb[0], oy = bb[1];
            using (StreamWriter w = new StreamWriter(outPath, false, new UTF8Encoding(false), 1 << 20)) {
                w.Write("{\"v\":1,\"kind\":\"" + kind + "\",\"name\":\"" + Esc(name) + "\",\"origin\":[" + ox.ToString(IC) + "," + oy.ToString(IC) + "],\"features\":[");
                bool firstFeat = true;
                long pos = 100;
                StringBuilder sb = new StringBuilder();
                while (pos < fileLen) {
                    byte[] rh = shp.ReadBytes(8);
                    if (rh.Length < 8) break;
                    int clen = BE(rh, 4) * 2;
                    byte[] c = shp.ReadBytes(clen);
                    pos += 8 + clen;
                    byte[] rec = dbf.ReadBytes(recLen);
                    res.Total++;
                    int st = BitConverter.ToInt32(c, 0);
                    if (st == 0) continue;
                    // ominaisuudet (vain syvyyskentat)
                    List<string[]> props = new List<string[]>();
                    string[] tr = txt != null ? TextRange(rec, txt) : null;
                    foreach (SykeField f in keep) {
                        if (f.Name == "_z") continue;
                        string v = f.Type == 'V' ? (tr == null ? null : (f.Name == "syv_min" ? tr[0] : tr[1])) : NumVal(rec, f);
                        if (v != null) props.Add(new string[] { f.Name, v });
                    }
                    bool keepZ = false; foreach (SykeField f in keep) if (f.Name == "_z") keepZ = true;
                    if (IsPoint(st)) {
                        int n; int po; int zo = -1;
                        if (st == 1 || st == 11 || st == 21) { n = 1; po = 4; if (st == 11) zo = 20; }
                        else { n = BitConverter.ToInt32(c, 36); po = 40; if (st == 18) zo = 40 + 16 * n + 16; }
                        for (int k = 0; k < n; k++) {
                            double x = BitConverter.ToDouble(c, po + 16 * k), y = BitConverter.ToDouble(c, po + 16 * k + 8);
                            if (!(x >= bb[0] && x <= bb[2] && y >= bb[1] && y <= bb[3])) continue;
                            sb.Length = 0;
                            sb.Append(firstFeat ? "" : ",").Append("{\"t\":\"P\",\"p\":{");
                            bool fp = true;
                            foreach (string[] p in props) { sb.Append(fp ? "" : ",").Append('"').Append(Esc(p[0])).Append("\":").Append(p[1]); fp = false; }
                            if (keepZ && zo >= 0) {
                                double z = Math.Round(BitConverter.ToDouble(c, zo + 8 * k), 2);
                                sb.Append(fp ? "" : ",").Append("\"_z\":").Append(z.ToString("R", IC));
                            }
                            sb.Append("},\"r\":[[").Append(Math.Round(x - ox).ToString(IC)).Append(',').Append(Math.Round(y - oy).ToString(IC)).Append("]]}");
                            w.Write(sb.ToString()); firstFeat = false; res.Count++;
                        }
                        continue;
                    }
                    double xmin = BitConverter.ToDouble(c, 4), ymin = BitConverter.ToDouble(c, 12), xmax = BitConverter.ToDouble(c, 20), ymax = BitConverter.ToDouble(c, 28);
                    if (xmax < bb[0] || xmin > bb[2] || ymax < bb[1] || ymin > bb[3]) continue;
                    bool area = st == 5 || st == 15 || st == 25;
                    int np = BitConverter.ToInt32(c, 36), npt = BitConverter.ToInt32(c, 40);
                    int ptOff = 44 + 4 * np;
                    sb.Length = 0;
                    int rings = 0;
                    StringBuilder rs = new StringBuilder();
                    for (int i = 0; i < np; i++) {
                        int a = BitConverter.ToInt32(c, 44 + 4 * i);
                        int b = i + 1 < np ? BitConverter.ToInt32(c, 44 + 4 * (i + 1)) : npt;
                        rs.Length = 0; int cnt = 0;
                        double px = 1e18, py = 1e18;
                        for (int q = a; q < b; q++) {
                            double x = Math.Round(BitConverter.ToDouble(c, ptOff + 16 * q) - ox), y = Math.Round(BitConverter.ToDouble(c, ptOff + 16 * q + 8) - oy);
                            if (q == b - 1 || Math.Abs(x - px) + Math.Abs(y - py) >= minStep) {
                                rs.Append(cnt == 0 ? "" : ",").Append(x.ToString(IC)).Append(',').Append(y.ToString(IC));
                                cnt += 2; px = x; py = y;
                            }
                        }
                        if (cnt >= (area ? 6 : 4)) { sb.Append(rings == 0 ? "" : ",").Append('[').Append(rs.ToString()).Append(']'); rings++; }
                    }
                    if (rings == 0) continue;
                    StringBuilder fs = new StringBuilder();
                    fs.Append(firstFeat ? "" : ",").Append("{\"t\":\"").Append(area ? "A" : "L").Append("\",\"p\":{");
                    bool f1 = true;
                    foreach (string[] p in props) { fs.Append(f1 ? "" : ",").Append('"').Append(Esc(p[0])).Append("\":").Append(p[1]); f1 = false; }
                    fs.Append("},\"r\":[").Append(sb.ToString()).Append("]}");
                    w.Write(fs.ToString()); firstFeat = false; res.Count++;
                }
                w.Write("]}");
            }
        }
        return res;
    }
}
'@

$root = Split-Path -Parent $PSScriptRoot
$data = Join-Path $root 'data'
New-Item -ItemType Directory -Force $data | Out-Null
$manPath = Join-Path $data 'layers.json'
$layers = @()
if (Test-Path $manPath) { $layers = @((Get-Content -Raw -Encoding UTF8 $manPath | ConvertFrom-Json).layers) }

Add-Type -AssemblyName System.IO.Compression.FileSystem
$shps = @()
foreach ($f in $Files) {
    $full = (Resolve-Path $f).Path
    if ($full.ToLower().EndsWith('.zip')) {
        $dest = Join-Path $Work ([IO.Path]::GetFileNameWithoutExtension($full))
        if (-not (Test-Path $dest)) {
            Write-Host "Puretaan $([IO.Path]::GetFileName($full))..."
            [IO.Compression.ZipFile]::ExtractToDirectory($full, $dest)
        }
        $shps += Get-ChildItem -Path $dest -Recurse -Filter *.shp | Where-Object { $_.FullName -notmatch '__MACOSX' } | ForEach-Object { $_.FullName }
    } elseif ($full.ToLower().EndsWith('.shp')) { $shps += $full }
}

foreach ($shp in ($shps | Select-Object -Unique)) {
    $name = [IO.Path]::GetFileNameWithoutExtension($shp)
    $lid = $name -replace '[^A-Za-z0-9_\-]', '_'
    $out = "$lid.json"
    $outPath = Join-Path $data $out
    Write-Host "Käsitellään $name..."
    $t = Get-Date
    $r = [SykeCrop]::Process($shp, $name, $BBox, $MinStep, $Kind[$name], $Depth[$name], $outPath)
    if ($r.Count -eq 0) {
        Remove-Item $outPath -Force
        Write-Host ("  ei kohteita rajausalueella ({0:N0} tutkittu), ohitetaan" -f $r.Total)
        continue
    }
    $size = (Get-Item $outPath).Length / 1MB
    $layers = @($layers | Where-Object { $_.id -ne $lid }) + [pscustomobject]@{ id = $lid; file = $out; kind = $r.Kind; name = $name; depthField = $r.D1; depthField2 = $r.D2 }
    $d2 = if ($r.D2) { " / $($r.D2)" } else { '' }
    $d1 = if ($r.D1) { $r.D1 } else { '-' }
    Write-Host ("  {0:N0} kohdetta ({1:N0} tutkittu), tyyppi {2}, syvyyskenttä {3}{4}, {5:N1} Mt, {6:N0} s" -f $r.Count, $r.Total, $r.Kind, $d1, $d2, $size, ((Get-Date) - $t).TotalSeconds)
    Write-Host "  kentät (# = numeerinen): $($r.Fields)"
    if ($size -gt 25) { Write-Host '  Varoitus: yli 25 Mt ei mene GitHubiin selaimen kautta. Kasvata -MinStep-arvoa tai pienennä rajausta.' }
}

$json = ([pscustomobject]@{ layers = @($layers) } | ConvertTo-Json -Depth 5)
[IO.File]::WriteAllText($manPath, $json, (New-Object Text.UTF8Encoding $false))
Write-Host 'Valmis. Tarkista tyypit ja kentät tiedostosta data/layers.json.'
