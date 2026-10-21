#!/usr/bin/env python3
"""
بادی اسپینر (bodyspinner.co) — API محصولات سایت

  https://bodyspinner.co/api/products?limit=50&page=N   (تا وقتی hasMore)
  هر محصول چند رنگ دارد؛ برای هر رنگ موجود یک کالا ساخته می‌شود (style = کد مدل).
  قیمت‌ها: عدد API ÷ ۱۰۰ = تومان (چند رقم آخر نویز است؛ گرد می‌شود).

  python3 scripts/stores/bodyspinner.py
"""
import argparse, os, re, sys, urllib.parse

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common  # noqa: E402

API = "https://bodyspinner.co/api/products?limit=50&page={page}"
toman = lambda v: int(round((v or 0) / 1000)) * 10
enc = lambda u: urllib.parse.quote(u, safe=":/?&=%") if u else u
FEATURE_KEYS = {"جنس": "جنس پارچه", "نوع برش": "استایل", "استایل": "سایر توضیحات", "فصل": "مناسب برای فصول", "یقه": "یقه"}


def features(desc):
    out = {}
    for line in (desc or "").splitlines():
        if ":" in line:
            k, v = [x.strip() for x in line.split(":", 1)]
            if k in FEATURE_KEYS and v:
                out[FEATURE_KEYS[k]] = v[:80]
    return out


def items_of(p):
    gender = {"مردانه": "M", "زنانه": "W"}.get((p.get("gender") or "").strip(), common.guess_gender(p.get("name")))
    by_color = {}
    for v in p.get("variations") or []:
        if v.get("inStock") and (v.get("stockQuantity") or 0) > 0:
            by_color.setdefault(v.get("Color") or "", []).append(v)
    seg = "women" if gender == "W" else "men"
    slug = urllib.parse.quote(re.sub(r"\s+", "-", (p.get("productType") or "product").strip()))
    feats = features(p.get("description"))
    out = []
    for color, vs in by_color.items():
        imgs = (p.get("imagesByColor") or {}).get(color) or p.get("images") or []
        thumb = (p.get("thumbnailsByColor") or {}).get(color)
        main = thumb or (imgs[0] if imgs else None)
        if not main:
            continue
        sale = min(toman(v.get("salePrice")) for v in vs)
        label = max(toman(v.get("labelPrice")) for v in vs)
        it = common.finalize({
            "id": f"bodyspinner:{p['mainSku']}-{color}",
            "store": "bodyspinner",
            "style": f"bodyspinner:{p['mainSku']}",
            "title": (p.get("name") or "") + ("" if re.search("مردانه|زنانه", p.get("name") or "") else " " + {"M": "مردانه", "W": "زنانه"}.get(gender, "")),
            "brand": "بادی اسپینر",
            "gender": gender,
            "type": common.guess_type(p.get("name"), [p.get("productCategory") or "", p.get("productType") or ""]),
            "cat": [x for x in [p.get("productCategory"), p.get("productType")] if x],
            "color": color,
            "features": feats,
            "price": sale,
            "basePrice": label,
            "sizes": sorted({v.get("Size") for v in vs if v.get("Size")}),
            "url": f"https://bodyspinner.co/fa/{seg}/{slug}/{p['mainSku']}",
            "img": enc(main),
            "img2": enc(next((x for x in imgs if x != main), None)),
            "orders": p.get("displayPriority") or 0,
        })
        if it:
            out.append(it)
    return out


def crawl(limit=None, log=print, pages=200):
    items, seen = [], set()
    for page in range(1, pages + 1):
        d = common.get_json(API.format(page=page))
        prods = (d or {}).get("products") or []
        for p in prods:
            for it in items_of(p):
                if it["id"] not in seen:
                    seen.add(it["id"])
                    items.append(it)
        if page % 5 == 0:
            log(f"bodyspinner page {page}  total {len(items)}")
            common.save("bodyspinner", items)
        if not prods or not d.get("hasMore") or (limit and len(items) >= limit):
            break
    return items[:limit] if limit else items


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int)
    a = ap.parse_args()
    print(common.save("bodyspinner", crawl(a.limit)))
