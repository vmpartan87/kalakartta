#!/usr/bin/env python3
"""Rajaa Syken syvyysaineistot (shapefile/zip) Kalakartan data-kansioon.

Käyttö:
    pip install pyshp
    python tools/rajaa_syke.py syvyysalue.zip syvyyskayra.zip luotauspisteet.zip

Skripti kirjoittaa data/<nimi>.json-tiedostot ja päivittää data/layers.json-luettelon.
Valinnat:
    --bbox E_MIN N_MIN E_MAX N_MAX   rajausalue ETRS-TM35FIN-koordinaatteina (oletus Iitti–Jaala)
    --min-step 2                     pisteiden vähimmäisväli metreinä (yksinkertaistus)
    --kind nimi=alueet|kayrat|pisteet|vesi     pakota tason tyyppi
    --depth nimi=KENTTA[,KENTTA2]              pakota syvyyskenttä(t)
"""
import argparse, json, os, re, sys, tempfile, zipfile
try:
    import shapefile  # pyshp
except ImportError:
    sys.exit("Asenna ensin: pip install pyshp")

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "data")
BBOX = [453000, 6742500, 490000, 6778000]


def guess_kind(name, geom, fields):
    n = name.lower()
    if re.search(r"syvyysalue|depare", n): return "alueet"
    if re.search(r"syvyyskayr|syvyyskäyr|depcnt|kayra", n): return "kayrat"
    if re.search(r"luotaus|syvyyspiste|sounding", n): return "pisteet"
    if re.search(r"ranta|jarv|järv|joet|joki|uoma|vesi", n): return "vesi"
    if geom == "P": return "pisteet"
    if geom == "L": return "kayrat"
    return "alueet" if any(num and re.search(r"syv|dep|drval", f, re.I) for f, num in fields) else "vesi"


def guess_depth(fields, kind):
    nums = [f for f, num in fields if num]
    if kind == "vesi": return None, None
    if kind == "alueet":
        mn = next((n for n in nums if re.search(r"min|drval1|syv.*1", n, re.I)), None)
        mx = next((n for n in nums if re.search(r"max|drval2|syv.*2|yla|ylä", n, re.I)), None)
        if mn and mx and mn != mx: return mn, mx
    if kind == "pisteet" and "_z" in nums:
        return next((n for n in nums if re.search(r"syv|dep|valsdp", n, re.I)), "_z"), None
    return next((n for n in nums if re.search(r"syv|dep|drval|valdco|arvo", n, re.I)), nums[0] if nums else None), None


def inter(a, b):
    return not (a[2] < b[0] or a[0] > b[2] or a[3] < b[1] or a[1] > b[3])


def process(shp_path, name, bbox, min_step, kind_over, depth_over):
    cpg = os.path.splitext(shp_path)[0] + ".cpg"
    enc = "utf-8" if os.path.exists(cpg) and "utf" in open(cpg, errors="ignore").read().lower() else "latin1"
    r = shapefile.Reader(shp_path, encoding=enc, encodingErrors="replace")
    fnames = [f[0] for f in r.fields[1:]]
    fields = [(f[0], f[1] in ("N", "F")) for f in r.fields[1:]]
    ox, oy = bbox[0], bbox[1]
    feats, total = [], 0
    has_z = False
    for sr in r.iterShapeRecords():
        total += 1
        s = sr.shape
        st = s.shapeType
        if st == 0: continue
        rec = dict(zip(fnames, sr.record))
        if st in (1, 11, 21, 8, 18, 28):
            zs = getattr(s, "z", None) if st in (11, 18) else None
            for k, (x, y) in enumerate(s.points):
                if bbox[0] <= x <= bbox[2] and bbox[1] <= y <= bbox[3]:
                    p = dict(rec)
                    if zs is not None and k < len(zs): p["_z"] = round(zs[k], 2); has_z = True
                    feats.append({"t": "P", "p": p, "r": [[round(x - ox), round(y - oy)]]})
            continue
        if not inter(s.bbox, bbox): continue
        t = "A" if st in (5, 15, 25) else "L"
        parts = list(s.parts) + [len(s.points)]
        rings = []
        for a, b in zip(parts[:-1], parts[1:]):
            ring, px, py = [], 1e18, 1e18
            for q in range(a, b):
                x, y = round(s.points[q][0] - ox), round(s.points[q][1] - oy)
                if q == b - 1 or abs(x - px) + abs(y - py) >= min_step:
                    ring += [x, y]; px, py = x, y
            if len(ring) >= (6 if t == "A" else 4): rings.append(ring)
        if rings: feats.append({"t": t, "p": rec, "r": rings})
    if has_z: fields.append(("_z", True))
    geom = "A" if any(f["t"] == "A" for f in feats) else "L" if any(f["t"] == "L" for f in feats) else "P"
    kind = kind_over.get(name) or guess_kind(name, geom, fields)
    d1, d2 = guess_depth(fields, kind)
    if name in depth_over:
        parts = depth_over[name].split(","); d1 = parts[0] or None; d2 = parts[1] if len(parts) > 1 else None
    keep = [k for k in (d1, d2) if k]
    for f in feats:
        f["p"] = {k: f["p"][k] for k in keep if f["p"].get(k) is not None and not isinstance(f["p"].get(k), (bytes,))}
    return {"v": 1, "kind": kind, "name": name, "origin": [ox, oy], "features": feats}, d1, d2, total


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("files", nargs="+")
    ap.add_argument("--bbox", nargs=4, type=float, default=BBOX)
    ap.add_argument("--min-step", type=float, default=2)
    ap.add_argument("--kind", action="append", default=[])
    ap.add_argument("--depth", action="append", default=[])
    a = ap.parse_args()
    kind_over = dict(k.split("=", 1) for k in a.kind)
    depth_over = dict(k.split("=", 1) for k in a.depth)
    os.makedirs(DATA, exist_ok=True)
    man_path = os.path.join(DATA, "layers.json")
    man = json.load(open(man_path, encoding="utf-8")) if os.path.exists(man_path) else {"layers": []}
    tmp = tempfile.mkdtemp()
    shps = []
    for f in a.files:
        if f.lower().endswith(".zip"):
            with zipfile.ZipFile(f) as z:
                z.extractall(tmp)
            for root, _, fs in os.walk(tmp):
                for n in fs:
                    p = os.path.join(root, n)
                    if n.lower().endswith(".shp") and p not in shps and "__MACOSX" not in p: shps.append(p)
        elif f.lower().endswith(".shp"):
            shps.append(f)
    for shp in shps:
        name = os.path.splitext(os.path.basename(shp))[0]
        print(f"Käsitellään {name}…", flush=True)
        data, d1, d2, total = process(shp, name, a.bbox, a.min_step, kind_over, depth_over)
        if not data["features"]:
            print(f"  ei kohteita rajausalueella ({total} tutkittu), ohitetaan"); continue
        lid = re.sub(r"[^A-Za-z0-9_\-]", "_", name)
        out = f"{lid}.json"
        with open(os.path.join(DATA, out), "w", encoding="utf-8") as fh:
            json.dump(data, fh, ensure_ascii=False, separators=(",", ":"))
        size = os.path.getsize(os.path.join(DATA, out)) / 1048576
        man["layers"] = [l for l in man["layers"] if l["id"] != lid] + [{"id": lid, "file": out, "kind": data["kind"], "name": name, "depthField": d1, "depthField2": d2}]
        print(f"  {len(data['features'])} kohdetta, tyyppi {data['kind']}, syvyyskenttä {d1 or '-'}{' / ' + d2 if d2 else ''}, {size:.1f} Mt")
        if size > 50: print("  Varoitus: tiedosto on iso. Kasvata --min-step-arvoa tai pienennä rajausta.")
    with open(man_path, "w", encoding="utf-8") as fh:
        json.dump(man, fh, ensure_ascii=False, indent=2)
    print("Valmis. Tarkista tyypit ja kentät tiedostosta data/layers.json ja vie muutokset GitHubiin.")


if __name__ == "__main__":
    main()
