#!/usr/bin/env python3
"""
ساخت فایل‌های HTML تک‌فایلی از پیش‌نمایش (برای فرستادن یا باز کردن بدون سرور)

دو نسخه:

  offline   حدود ۱۰ هزار محصول متعادل از همه‌ی فروشگاه‌ها؛ عکس‌ها داخل فایل (AVIF، ۴۴۰ پیکسل؛ برای قاب بزرگ «استایل کامل» هم تیز)
            بدون اینترنت باز می‌شود.                                                   → dist/regaal-offline.html
  online    همه‌ی محصولات؛ عکس‌ها از سایت خود فروشگاه‌ها خوانده می‌شوند (در اندازه‌ی هر قاب)
            فقط با اینترنت داخل ایران (سایت فروشگاه‌ها روی IP خارجی بسته‌اند).        → dist/regaal-online.html

در هر دو، CSS، فونت‌ها، کدها، کاتالوگ و نمونه‌های «دوخت سفارشی» (data/pins.js، عکس‌ها داخل فایل) هست.
عکس‌ها مستقیم از فروشگاه دانلود و یک بار در dist/thumbs نگه داشته می‌شوند (داخل ایران VIA_GOOGLE=0).

  python scripts/build_standalone.py                      # هر دو
  python scripts/build_standalone.py --mode offline --max 10000 --width 440 --quality 38
  python scripts/build_standalone.py --mode online
"""
import argparse, base64, collections, concurrent.futures as cf, hashlib, io, json, os, re, sys

from PIL import Image, features

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "scripts", "stores"))
import common  # noqa: E402

MIME = {".woff2": "font/woff2", ".ttf": "font/ttf", ".jpg": "image/jpeg", ".webp": "image/webp", ".avif": "image/avif"}


def data_uri(raw, mime):
    return f"data:{mime};base64," + base64.b64encode(raw).decode("ascii")


def file_uri(rel):
    with open(os.path.join(ROOT, rel), "rb") as fh:
        return data_uri(fh.read(), MIME[os.path.splitext(rel)[1]])


# همان نسخه‌های اندازه‌ای engine.js (variants): [نشانی، عرض]
def variants(url):
    m = re.match(r"^(https://dkstatics-public\.digikala\.com/[^?]+)", url)
    if m:
        return [(m[1] + f"?x-oss-process=image/resize,m_lfit,h_{w},w_{w}/quality,q_90", w) for w in (400, 800, 1200)] + [(m[1], 1305)]
    m = re.match(r"^(https://www\.banimode\.com/)(\d+)(?:-[a-z_]+)?(/.+)$", url)
    if m:
        return [(m[1] + m[2] + "-large_default" + m[3], 350), (m[1] + m[2] + "-thickbox_default" + m[3], 600), (m[1] + m[2] + m[3], 1200)]
    m = re.match(r"^(https://novinleather\.com/upload/)(?:thumb\d/)?(.+)$", url)
    if m:
        return [(m[1] + "thumb1/" + m[2], 565), (m[1] + m[2], 1000)]
    m = re.match(r"^(https://core\.dayamode\.com/storage/)(?:small|medium|large)/(.+)$", url)
    if m:
        return [(m[1] + "medium/" + m[2], 512), (m[1] + "large/" + m[2], 819)]
    return []


def source_for(url, width):
    """کوچک‌ترین نسخه‌ای که برای کوچک‌کردن به width کافی است (کمی بزرگ‌تر، برای تیزی)"""
    v = variants(url)
    need = int(width * 1.3)
    return next((u for u, w in v if w >= need), v[-1][0] if v else url)


def pick(items, total):
    """سهم متعادل از هر فروشگاه؛ داخل هر فروشگاه پرطرفدارها با تنوع نوع"""
    by_store = collections.defaultdict(list)
    for it in items:
        if it.get("gender") != "K":
            by_store[it["store"]].append(it)
    # سهم مساوی؛ فروشگاهی که کمتر دارد همه‌اش را می‌دهد و باقی‌مانده بین بقیه پخش می‌شود
    shares, left, rest = {}, total, dict(by_store)
    while rest:
        share = max(1, left // len(rest))
        small = {k: len(v) for k, v in rest.items() if len(v) <= share}
        if not small:
            shares.update({k: share for k in rest})
            break
        for k, n in small.items():
            shares[k] = n
            left -= n
            rest.pop(k)
    out = []
    for store, lst in by_store.items():
        share = shares[store]
        lst.sort(key=lambda x: (-(x.get("orders") or 0), -(x.get("discount") or 0)))
        buckets = collections.defaultdict(list)
        for it in lst:
            buckets[(it.get("gender"), it.get("type"))].append(it)
        chosen, seen, rnd = [], set(), 0
        while len(chosen) < min(share, len(lst)) and rnd < 400:
            for b in buckets.values():
                if rnd < len(b) and b[rnd].get("style") not in seen:
                    seen.add(b[rnd].get("style"))
                    chosen.append(b[rnd])
                    if len(chosen) >= share:
                        break
            rnd += 1
        out += chosen
    # فروشگاهی که سهمش پر نشد (رنگ‌های تکراری یک مدل): باقی‌مانده یک در میان از پرطرفدارهای بقیه
    if len(out) < total:
        taken = {it["id"] for it in out}
        rest = {k: [it for it in v if it["id"] not in taken] for k, v in by_store.items()}
        while len(out) < total and any(rest.values()):
            for k in list(rest):
                if rest[k] and len(out) < total:
                    out.append(rest[k].pop(0))
    return out


def encode(im, fmt, quality):
    buf = io.BytesIO()
    if fmt == "avif":
        im.save(buf, "AVIF", quality=quality, speed=6)
    elif fmt == "webp":
        im.save(buf, "WEBP", quality=quality, method=6)
    else:
        im.save(buf, "JPEG", quality=quality, optimize=True, progressive=True)
    return buf.getvalue()


def thumb(url, cache, width, quality, fmt):
    key = hashlib.sha1(f"{url}|{width}|{quality}|{fmt}".encode()).hexdigest()
    path = os.path.join(cache, key + "." + fmt)
    if os.path.exists(path):
        with open(path, "rb") as fh:
            return fh.read()
    src = source_for(url, width)
    raw = common.fetch(src, timeout=40, tries=2) or (common.fetch(url, timeout=40, tries=2) if src != url else None)
    if not raw:
        return None
    try:
        im = Image.open(io.BytesIO(raw)).convert("RGB")
    except Exception:
        return None
    if im.width > width:
        im = im.resize((width, round(im.height * width / im.width)), Image.LANCZOS)
    b = encode(im, fmt, quality)
    with open(path, "wb") as fh:
        fh.write(b)
    return b


def flat(b):
    """عکس تقریباً یک‌رنگ (جای خالی یا خطای فروشگاه)"""
    lo, hi = Image.open(io.BytesIO(b)).convert("L").getextrema()
    return hi - lo < 24


def pins_js(fmt="webp", width=360, quality=60):
    """data/pins.js با عکس‌های داخل فایل (برای «دوخت سفارشی» بدون سرور)"""
    path = os.path.join(ROOT, "data", "pins.js")
    if not os.path.exists(path):
        return "window.RG_PINS = {sets: []};"
    txt = open(path, encoding="utf-8").read()
    data = json.loads(txt[txt.index("{"): txt.rindex("}") + 1])
    for s in data.get("sets", []):
        for p in s.get("items", []):
            f = os.path.join(ROOT, p.get("thumb") or "")
            if not os.path.isfile(f):
                continue
            im = Image.open(f).convert("RGB")
            if im.width > width:
                im = im.resize((width, round(im.height * width / im.width)), Image.LANCZOS)
            p["thumb"] = p["large"] = data_uri(encode(im, fmt, quality), MIME["." + fmt])
    return "window.RG_PINS = " + json.dumps(data, ensure_ascii=False, separators=(",", ":")) + ";"


# فایل آفلاین AVIF دارد؛ اگر مرورگر خیلی قدیمی است، پیام کوتاهی نشان داده می‌شود
def avif_check():
    if not features.check("avif"):
        return ""
    probe = data_uri(encode(Image.new("RGB", (2, 2), (200, 190, 180)), "avif", 60), "image/avif")
    return ("<script>(function(){var i=new Image();i.onerror=function(){var d=document.createElement('div');"
            "d.textContent='مرورگر شما عکس‌های این فایل (AVIF) را نشان نمی‌دهد؛ لطفاً Chrome، Edge یا Firefox به‌روز را امتحان کنید.';"
            "d.style.cssText='position:fixed;z-index:999;top:0;left:0;right:0;padding:10px;text-align:center;background:#a0522d;color:#fff;font:14px Tahoma';"
            "document.addEventListener('DOMContentLoaded',function(){document.body.appendChild(d)})};i.src='" + probe + "'})()</script>")


def build(mode, args, catalog):
    read = lambda rel: open(os.path.join(ROOT, rel), encoding="utf-8").read()
    html = read("index.html")
    css = read("assets/css/boutique.css")
    css = re.sub(r'url\("\.\./fonts/([^"]+)"\)', lambda m: f'url("{file_uri("assets/fonts/" + m.group(1))}")', css)

    if mode == "offline":
        fmt = args.format if args.format != "avif" or features.check("avif") else "webp"
        chosen = pick(catalog["items"], args.max)
        cache = os.path.join(ROOT, "dist", "thumbs")
        os.makedirs(cache, exist_ok=True)
        common.DELAY = 0.03

        def work(it):
            b = thumb(it["img"], cache, args.width, args.quality, fmt)
            return it, (None if b and flat(b) else b)

        kept, done = [], 0
        with cf.ThreadPoolExecutor(args.workers) as ex:
            for it, b in ex.map(work, chosen):
                done += 1
                if done % 500 == 0:
                    print(f"  images {done}/{len(chosen)}", flush=True)
                if not b:
                    continue
                it = dict(it)
                it["img"] = data_uri(b, MIME["." + fmt])
                it.pop("img2", None)  # در نسخه‌ی آفلاین فقط عکس اصلی
                kept.append(it)
    else:
        kept = [it for it in catalog["items"]]  # همه؛ عکس‌ها از سایت فروشگاه‌ها

    stores = {k: dict(v) for k, v in catalog.get("stores", {}).items()}
    counts = collections.Counter(it["store"] for it in kept)
    for k in stores:
        stores[k]["count"] = counts.get(k, 0)
    out_catalog = {"generated": catalog.get("generated"), "count": len(kept), "stores": {k: v for k, v in stores.items() if v["count"]}, "items": kept}
    catalog_js = "window.JW_CATALOG = " + json.dumps(out_catalog, ensure_ascii=False, separators=(",", ":")) + ";"

    script = lambda code: "<script>" + code.replace("</script", "<\\/script") + "</script>"
    html = html.replace('<link rel="stylesheet" href="assets/css/boutique.css">', "<style>" + css + "</style>")
    html = html.replace('<script src="data/catalog.js"></script>', (avif_check() if mode == "offline" else "") + script(catalog_js))
    # نسخه‌ی آفلاین AVIF دارد؛ آنلاین WebP (سازگارتر)
    html = html.replace('<script src="data/pins.js"></script>', script(pins_js("avif", quality=42) if mode == "offline" and features.check("avif") else pins_js()))
    html = html.replace('<script src="assets/js/engine.js"></script>', script(read("assets/js/engine.js")))
    html = html.replace('<script src="assets/js/app.js"></script>', script(read("assets/js/app.js")))

    out = os.path.join(args.out_dir, f"regaal-{mode}.html")
    os.makedirs(args.out_dir, exist_ok=True)
    with open(out, "w", encoding="utf-8") as fh:
        fh.write(html)
    print(f"{out}  ({os.path.getsize(out) / 1e6:.1f} MB, {len(kept)} products from {len(out_catalog['stores'])} stores)")
    for k, n in counts.most_common():
        print(f"  {k:14} {n}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--mode", choices=("offline", "online", "both"), default="both")
    ap.add_argument("--out-dir", default=os.path.join(ROOT, "dist"))
    ap.add_argument("--max", type=int, default=10000, help="حداکثر تعداد محصول در نسخه‌ی آفلاین")
    ap.add_argument("--width", type=int, default=440, help="عرض عکس محصولات در نسخه‌ی آفلاین")
    ap.add_argument("--quality", type=int, default=38)
    ap.add_argument("--format", choices=("avif", "webp"), default="avif")
    ap.add_argument("--workers", type=int, default=12)
    args = ap.parse_args()
    with open(os.path.join(ROOT, "data", "catalog.json"), encoding="utf-8") as fh:
        catalog = json.load(fh)
    for mode in (("online", "offline") if args.mode == "both" else (args.mode,)):
        build(mode, args, catalog)


if __name__ == "__main__":
    main()
