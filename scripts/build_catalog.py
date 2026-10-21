#!/usr/bin/env python3
"""
ساخت کاتالوگ محصولات «بوتیک هوشمند جین‌وست» از روی سایت jeanswest.ir

خروجی:
  data/catalog.js            ->  window.JW_CATALOG = {...}   (برای نسخه‌ی استاتیک / پیش‌نمایش)
  data/catalog.json          ->  همان داده برای سرور هوش مصنوعی
  assets/img/products/*.jpg  ->  عکس محصولات (اختیاری، با --download-images)

اجرا:
  python3 scripts/build_catalog.py --download-images
  # بیرون از ایران (jeanswest.ir روی IP خارجی بسته است):
  python3 scripts/build_catalog.py --via-google --download-images
  # همه‌ی کالاهای موجود سایت (هر دسته تا جایی که کالای موجود دارد):
  python3 scripts/build_catalog.py --all-in-stock --download-images
  # کل سایت (همه‌ی صفحه‌های همه‌ی دسته‌ها):
  python3 scripts/build_catalog.py --pages 0
"""
import argparse, io, json, os, re, sys, time, urllib.parse, urllib.request
from concurrent.futures import ThreadPoolExecutor

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141 Safari/537.36"

# (مسیر دسته در سایت، جنسیت، گروه، نوع نرمال‌شده، تعداد هدف کالای موجود در پیش‌نمایش)
CATEGORIES = [
    # ---------- زنانه / پوشاک
    ("زنانه/پوشاک-زنانه/شلوار-زنانه", "W", "apparel", "pants", 60),
    ("زنانه/پوشاک-زنانه/تی-شرت-زنانه", "W", "apparel", "tshirt", 40),
    ("زنانه/پوشاک-زنانه/شومیز-و-پیراهن-زنانه", "W", "apparel", "shirt", 40),
    ("زنانه/پوشاک-زنانه/مانتو-زنانه", "W", "apparel", "manto", 40),
    ("زنانه/پوشاک-زنانه/بلوز-زنانه", "W", "apparel", "blouse", 20),
    ("زنانه/پوشاک-زنانه/تاپ-زنانه", "W", "apparel", "top", 20),
    ("زنانه/پوشاک-زنانه/هودی-زنانه", "W", "apparel", "hoodie", 20),
    ("زنانه/پوشاک-زنانه/سوییشرت-زنانه", "W", "apparel", "sweatshirt", 20),
    ("زنانه/پوشاک-زنانه/پلیور-و-ژاکت-زنانه", "W", "apparel", "knit", 40),
    ("زنانه/پوشاک-زنانه/کاپشن-زنانه", "W", "apparel", "jacket", 20),
    ("زنانه/پوشاک-زنانه/پالتو-زنانه", "W", "apparel", "coat", 20),
    ("زنانه/پوشاک-زنانه/دامن-زنانه", "W", "apparel", "skirt", 20),
    ("زنانه/پوشاک-زنانه/کت-و-شلوار-زنانه", "W", "apparel", "suit", 20),
    ("زنانه/پوشاک-زنانه/دورس-زنانه", "W", "apparel", "sweatshirt", 20),
    ("زنانه/پوشاک-زنانه/شلوارک-زنانه", "W", "apparel", "shorts", 20),
    ("زنانه/پوشاک-زنانه/ست-لباس-زنانه", "W", "apparel", "set", 20),
    # ---------- زنانه / اکسسوری، کیف و کفش، عطر
    ("زنانه/اکسسوری-و-زیورآلات-زنانه/کمربند-زنانه", "W", "accessory", "belt", 20),
    ("زنانه/اکسسوری-و-زیورآلات-زنانه/شال-و-روسری-زنانه", "W", "accessory", "scarf", 20),
    ("زنانه/اکسسوری-و-زیورآلات-زنانه/عینک-زنانه", "W", "accessory", "glasses", 20),
    ("زنانه/اکسسوری-و-زیورآلات-زنانه/زیور-آلات-زنانه", "W", "accessory", "jewelry", 20),
    ("زنانه/اکسسوری-و-زیورآلات-زنانه/ساعت-زنانه", "W", "accessory", "watch", 20),
    ("زنانه/اکسسوری-و-زیورآلات-زنانه/دستکش-و-کلاه-زنانه", "W", "accessory", "hat", 20),
    ("زنانه/اکسسوری-و-زیورآلات-زنانه/جوراب-زنانه", "W", "accessory", "socks", 20),
    ("زنانه/اکسسوری-و-زیورآلات-زنانه/چتر-زنانه", "W", "accessory", "umbrella", 10),
    ("زنانه/کیف-و-کفش-زنانه/کیف-زنانه", "W", "accessory", "bag", 40),
    ("زنانه/کیف-و-کفش-زنانه/کفش-زنانه", "W", "accessory", "shoes", 40),
    ("زنانه/کیف-و-کفش-زنانه/صندل-زنانه", "W", "accessory", "sandals", 20),
    ("زنانه/عطر-و-ادکلن-زنانه", "W", "accessory", "perfume", 20),
    # ---------- مردانه / پوشاک
    ("مردانه/پوشاک-مردانه/شلوار-مردانه", "M", "apparel", "pants", 60),
    ("مردانه/پوشاک-مردانه/تی-شرت-مردانه", "M", "apparel", "tshirt", 40),
    ("مردانه/پوشاک-مردانه/پیراهن-مردانه", "M", "apparel", "shirt", 40),
    ("مردانه/پوشاک-مردانه/پولوشرت-مردانه", "M", "apparel", "polo", 20),
    ("مردانه/پوشاک-مردانه/هودی-مردانه", "M", "apparel", "hoodie", 20),
    ("مردانه/پوشاک-مردانه/سوییشرت-مردانه", "M", "apparel", "sweatshirt", 20),
    ("مردانه/پوشاک-مردانه/دورس-مردانه", "M", "apparel", "sweatshirt", 20),
    ("مردانه/پوشاک-مردانه/پلیور-و-ژاکت-مردانه", "M", "apparel", "knit", 40),
    ("مردانه/پوشاک-مردانه/کاپشن-مردانه", "M", "apparel", "jacket", 40),
    ("مردانه/پوشاک-مردانه/پالتو-مردانه", "M", "apparel", "coat", 20),
    ("مردانه/پوشاک-مردانه/کت-و-شلوار-مردانه", "M", "apparel", "suit", 20),
    ("مردانه/پوشاک-مردانه/شلوارک-مردانه", "M", "apparel", "shorts", 20),
    ("مردانه/پوشاک-مردانه/ست-لباس-مردانه", "M", "apparel", "set", 20),
    # ---------- مردانه / اکسسوری، کیف و کفش، عطر
    ("مردانه/اکسسوری-و-زیورآلات-مردانه/کمربند-مردانه", "M", "accessory", "belt", 20),
    ("مردانه/اکسسوری-و-زیورآلات-مردانه/دستکش-و-کلاه-مردانه", "M", "accessory", "hat", 20),
    ("مردانه/اکسسوری-و-زیورآلات-مردانه/عینک-مردانه", "M", "accessory", "glasses", 20),
    ("مردانه/اکسسوری-و-زیورآلات-مردانه/ساعت-مردانه", "M", "accessory", "watch", 20),
    ("مردانه/اکسسوری-و-زیورآلات-مردانه/دستبند-مردانه", "M", "accessory", "jewelry", 20),
    ("مردانه/اکسسوری-و-زیورآلات-مردانه/جوراب-مردانه", "M", "accessory", "socks", 20),
    ("مردانه/اکسسوری-و-زیورآلات-مردانه/چتر-مردانه", "M", "accessory", "umbrella", 10),
    ("مردانه/کیف-و-کفش-مردانه/کیف-مردانه", "M", "accessory", "bag", 40),
    ("مردانه/کیف-و-کفش-مردانه/کفش-مردانه", "M", "accessory", "shoes", 40),
    ("مردانه/کیف-و-کفش-مردانه/صندل-مردانه", "M", "accessory", "sandals", 20),
    ("مردانه/عطر-و-ادکلن-مردانه", "M", "accessory", "perfume", 20),
    # ---------- بچگانه
    ("بچه-گانه/پوشاک-دخترانه", "K", "apparel", "kids", 20),
    ("بچه-گانه/پوشاک-پسرانه", "K", "apparel", "kids", 20),
    ("بچه-گانه/کیف-و-کفش-بچه-گانه", "K", "accessory", "kids-acc", 20),
]

# ویژگی‌هایی که برای جست‌وجو ارزش دارند (بقیه مثل دمای اتو حذف می‌شوند)
KEEP_FEATURES = {"طرح", "استایل", "جنس پارچه", "مناسب برای فصول", "یقه", "آستین", "قد", "ارتفاع فاق",
                 "نحوه بسته‌شدن", "جیب", "کاربرد", "سایر توضیحات", "جنس", "مدل", "رنگ", "نوع",
                 "سبک", "طرح پارچه", "جنس رویه", "جنس زیره", "نوع پاشنه", "ارتفاع پاشنه", "جنس بند",
                 "شکل قاب", "جنس قاب", "جنس فریم", "جنس عدسی", "نوع عطر", "رایحه", "برند", "مناسب برای"}


def norm(s):
    return (s or "").replace("ي", "ی").replace("ك", "ک").replace("‌", " ").strip()


class Fetcher:
    def __init__(self, via_google, delay):
        self.via_google, self.delay = via_google, delay

    def url(self, u):
        if not self.via_google:
            return u
        p = urllib.parse.urlsplit(u)
        host = p.netloc.replace("-", "--").replace(".", "-") + ".translate.goog"
        q = (p.query + "&" if p.query else "") + "_x_tr_sl=fa&_x_tr_tl=en&_x_tr_hl=en"
        return urllib.parse.urlunsplit((p.scheme, host, p.path, q, ""))

    def get(self, u, tries=3):
        for t in range(tries):
            try:
                req = urllib.request.Request(self.url(u), headers={"User-Agent": UA})
                with urllib.request.urlopen(req, timeout=60) as r:
                    data = r.read()
                time.sleep(self.delay)
                return data
            except Exception as e:  # noqa: BLE001
                print(f"  retry {t + 1}: {e}", file=sys.stderr)
                time.sleep(2 + 3 * t)
        return None


def parse_plp(html):
    """محصولات و اطلاعات صفحه‌بندی را از payload نکست‌جی‌اس (RSC) بیرون می‌کشد."""
    chunks = re.findall(r'self\.__next_f\.push\(\[1,"(.*?)"\]\)', html, re.S)
    txt = json.loads('"' + "".join(chunks).replace("\n", "\\n") + '"')
    m = re.search(r'"page":(\d+),"perPage":(\d+),"total":(\d+)', txt)
    meta = tuple(map(int, m.groups())) if m else (1, 20, 0)
    i = txt.find('"products":[{')
    if i < 0:
        return meta, []
    try:
        arr, _ = json.JSONDecoder().raw_decode(txt, i + len('"products":'))
        return meta, arr
    except ValueError as e:
        print(f"  parse error: {e}", file=sys.stderr)
        return meta, []


def to_item(p, cat, gender, group, ptype):
    bd = p.get("banimodeDetails") or {}
    sizes = [s for s in (bd.get("size") or []) if s.get("active")]
    in_stock = [s["name"] for s in sizes if (s.get("quantity") or 0) > 0]
    imgs = bd.get("images") or {}
    big = imgs.get("thickbox_default") or []
    small = imgs.get("large_default") or []
    if not big and not small:
        return None
    feats = {}
    for f in bd.get("product_features") or []:
        t, v = norm(f.get("title")), norm(f.get("value"))
        if t in KEEP_FEATURES and v and t not in feats:
            feats[t] = v
    sale, base = p.get("salePrice") or 0, p.get("basePrice") or 0
    seo = (p.get("seo") or {}).get("urlPath") or ""
    return {
        "id": p.get("sku"),
        "style": p.get("styleCode"),
        "title": norm(p.get("title")),
        "name": norm(bd.get("product_name") or p.get("title")),
        "brand": norm(feats.pop("برند", "") or bd.get("product_manufacturer_en_name") or "Jeanswest"),
        "gender": gender,
        "group": group,
        "type": ptype,
        "cat": [norm(c.replace("-", " ")) for c in cat.split("/")],
        "subGroup": norm((p.get("erpDetails") or {}).get("subGroup")),
        "color": norm(bd.get("color_name")),
        "features": feats,
        "price": round(sale / 10),        # تومان
        "basePrice": round(base / 10),    # تومان
        "discount": round(100 - sale * 100 / base) if base and sale < base else 0,
        "sizes": in_stock,
        "label": norm(p.get("label")) if p.get("showLabel") else "",
        "url": "https://jeanswest.ir/products" + seo,
        "remote": {"main": big[0] if big else small[0], "alt": (small[1] if len(small) > 1 else small[0]) if small else None},
        "orders": p.get("orderCount") or 0,
    }


def save_image(fetcher, url, path, max_w):
    if os.path.exists(path):
        return True
    data = fetcher.get(url)
    if not data:
        return False
    try:
        from PIL import Image
        im = Image.open(io.BytesIO(data)).convert("RGB")
        if im.width > max_w:
            im = im.resize((max_w, round(im.height * max_w / im.width)), Image.LANCZOS)
        im.save(path, "JPEG", quality=74, optimize=True, progressive=True)
    except Exception:  # noqa: BLE001  — اگر Pillow نصب نبود، خود فایل ذخیره می‌شود
        with open(path, "wb") as fh:
            fh.write(data)
    return True


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--via-google", action="store_true", help="عبور از طریق translate.goog (برای اجرا بیرون از ایران)")
    ap.add_argument("--pages", type=int, default=-1, help="تعداد صفحه برای هر دسته؛ 0 یعنی همه‌ی صفحه‌ها (کل سایت)؛ پیش‌فرض: تعداد هدف جدول")
    ap.add_argument("--download-images", action="store_true")
    ap.add_argument("--include-out-of-stock", action="store_true")
    ap.add_argument("--all-in-stock", action="store_true", help="همه‌ی کالاهای موجود؛ هر دسته بعد از دو صفحه‌ی پشت‌سرهم بدون کالای موجود تمام می‌شود")
    ap.add_argument("--delay", type=float, default=0.6)
    ap.add_argument("--workers", type=int, default=4, help="تعداد دانلود هم‌زمان عکس‌ها")
    args = ap.parse_args()

    f = Fetcher(args.via_google, args.delay)
    items, seen = [], set()
    for cat, gender, group, ptype, target in CATEGORIES:
        # --pages N: دقیقاً N صفحه؛ 0: همه‌ی صفحه‌ها؛ پیش‌فرض: تا رسیدن به «هدف» (حداکثر چند صفحه‌ی اضافه)
        if args.all_in_stock:
            target = 10 ** 6
        max_pages = 0 if args.all_in_stock else args.pages if args.pages >= 0 else target // 20 + 4
        page, total_pages, got, dry = 1, 1, 0, 0
        while page <= total_pages and (max_pages == 0 or page <= max_pages):
            if args.pages < 0 and got >= target:
                break
            if args.all_in_stock and dry >= 2:  # سایت کالاهای موجود را اول می‌آورد
                break
            q = "?page=%d" % page if page > 1 else ""
            html = f.get("https://jeanswest.ir/plp/" + urllib.parse.quote(cat) + q)
            if not html:
                break
            (pg, per, total), prods = parse_plp(html.decode("utf-8", "ignore"))
            total_pages = max(1, -(-total // per)) if per else 1
            added = 0
            for p in prods:
                if args.pages < 0 and got >= target:
                    break
                it = to_item(p, cat, gender, group, ptype)
                if not it or it["id"] in seen:
                    continue
                if not it["sizes"] and not args.include_out_of_stock:
                    continue
                seen.add(it["id"])
                items.append(it)
                added += 1
                got += 1
            dry = dry + 1 if added == 0 else 0
            print(f"{cat}  page {page}/{total_pages}  +{added}  (site total {total})")
            page += 1

    write_catalog(items)  # اول خود داده ذخیره شود؛ دانلود عکس‌ها ممکن است طول بکشد

    if args.download_images:
        os.makedirs(os.path.join(ROOT, "assets", "img", "products"), exist_ok=True)

        def fetch_images(it):
            main_rel = f"assets/img/products/{it['id']}.jpg"
            alt_rel = f"assets/img/products/{it['id']}-b.jpg"
            if save_image(f, it["remote"]["main"], os.path.join(ROOT, main_rel), 520):
                it["img"] = main_rel
            if it["remote"]["alt"] and save_image(f, it["remote"]["alt"], os.path.join(ROOT, alt_rel), 350):
                it["img2"] = alt_rel

        with ThreadPoolExecutor(max_workers=args.workers) as pool:
            for n, _ in enumerate(pool.map(fetch_images, items), 1):
                if n % 50 == 0:
                    print(f"images {n}/{len(items)}")
        write_catalog(items)
    print(f"done: {len(items)} products")


def write_catalog(items):
    for it in items:  # عکس‌هایی که از قبل دانلود شده‌اند
        for key, rel in (("img", f"assets/img/products/{it['id']}.jpg"), ("img2", f"assets/img/products/{it['id']}-b.jpg")):
            if not it.get(key) and os.path.exists(os.path.join(ROOT, rel)):
                it[key] = rel
    data = {"source": "https://jeanswest.ir", "generated": time.strftime("%Y-%m-%d"), "count": len(items), "items": items}
    os.makedirs(os.path.join(ROOT, "data"), exist_ok=True)
    with open(os.path.join(ROOT, "data", "catalog.json"), "w", encoding="utf-8") as fh:
        json.dump(data, fh, ensure_ascii=False)
    with open(os.path.join(ROOT, "data", "catalog.js"), "w", encoding="utf-8") as fh:
        fh.write("/* generated by scripts/build_catalog.py — do not edit by hand */\n")
        fh.write("window.JW_CATALOG = " + json.dumps(data, ensure_ascii=False) + ";\n")


if __name__ == "__main__":
    main()
