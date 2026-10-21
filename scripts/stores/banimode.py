#!/usr/bin/env python3
"""
بانی‌مد (banimode.com) — API موبایل

  https://mobapi.banimode.com/api/v1/products?query=(product_categories.id:2)&page=N
  این API پارامتر دسته و جست‌وجو را نادیده می‌گیرد؛ پس فهرست کلی صفحه‌به‌صفحه خوانده می‌شود و
  فقط کالاهای مد و موجود (total_qty > 0) نگه داشته می‌شوند. هر صفحه ۲۴ کالا؛ قیمت تومان.

  python3 scripts/stores/banimode.py [--pages 250]
"""
import argparse, os, sys, urllib.parse

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common  # noqa: E402

API = "https://mobapi.banimode.com/api/v1/products?query=" + urllib.parse.quote("(product_categories.id:2)") + "&page={page}"
SKIP = ("آرایش", "پوست", "مو ", "بهداشت", "مسواک", "ناخن", "لوازم", "شمع", "خانه", "آشپزخانه", "دکور", "برنز", "ضد آفتاب", "کرم", "شامپو", "اسباب")


def to_item(p):
    if not p.get("total_qty"):
        return None
    cat = p.get("product_category_default_name_en") or ""
    title = p.get("product_name") or ""
    if any(w in cat for w in SKIP):
        return None
    ptype = common.guess_type(title, [cat])
    if not ptype:
        return None
    imgs = p.get("images") or {}
    big = imgs.get("thickbox_default") or imgs.get("large_default") or []
    alt = imgs.get("large_default") or []
    if not big:
        return None
    price = p.get("product_price") or 0
    sp = (p.get("product_specific_price") or {}).get("specific_price")
    sizes = [s.get("name") for s in p.get("size") or [] if s.get("quantity") and s.get("name")]
    link = (p.get("link") or "").split("#")[0]
    brand = p.get("product_manufacturer_name") or ""
    gender = common.guess_gender(cat, title)
    return common.finalize({
        "id": f"banimode:{p['id_product']}-{p.get('id_color') or 0}",
        "store": "banimode",
        "style": f"banimode:{p['id_product']}",
        "title": title + (" " + brand if brand and brand not in title else ""),
        "brand": brand,
        "gender": gender,
        "type": ptype,
        "cat": [cat],
        "color": p.get("color_name") or "",
        "price": sp or price,
        "basePrice": price,
        "discount": (p.get("product_specific_price") or {}).get("discount_percent") or 0,
        "sizes": [s.replace("_", " ") for s in sizes][:12],
        "url": "https://www.banimode.com/" + urllib.parse.quote(link, safe="/.-"),
        "img": big[0],
        "img2": alt[1] if len(alt) > 1 else None,
        "orders": 0,
    })


def crawl(limit=None, log=print, pages=250):
    items, seen = [], set()
    for page in range(1, pages + 1):
        d = common.get_json(API.format(page=page))
        prods = (((d or {}).get("data") or {}).get("data")) or []
        if not prods:
            log(f"banimode page {page}: empty")
            continue
        for p in prods:
            it = to_item(p)
            if it and it["id"] not in seen:
                seen.add(it["id"])
                items.append(it)
        if page % 10 == 0:
            log(f"banimode page {page}  total {len(items)}")
            common.save("banimode", items)
        if limit and len(items) >= limit:
            break
    return items[:limit] if limit else items


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--pages", type=int, default=250)
    ap.add_argument("--limit", type=int)
    a = ap.parse_args()
    print(common.save("banimode", crawl(a.limit, pages=a.pages)))
