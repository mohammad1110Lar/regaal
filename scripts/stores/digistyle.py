#!/usr/bin/env python3
"""
دیجی‌استایل (digistyle.com) — API دسته‌بندی خود دیجی‌استایل

  https://api.digistyle.com/v1/categories/<code>/search/?page=N&sortby=7&page_size=50
  محصولات داخل data.widgets[type=products]؛ هر صفحه ۴۰ کالا؛ قیمت ریال؛ سایزهای موجود از variants.
  کدهای دسته همان کدهای دیجی‌کالاست (به‌علاوه‌ی مانتو و کفش زنانه).

  python3 scripts/stores/digistyle.py [--pages 2]
"""
import argparse, os, re, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common  # noqa: E402
from digikala import CATEGORIES as DK_CATEGORIES  # noqa: E402

API = "https://api.digistyle.com/v1/categories/{code}/search/?page={page}&sortby=7&page_size=50"
CATEGORIES = dict(DK_CATEGORIES, **{"women-manto": ("W", "manto"), "women-shoes": ("W", "shoes"), "men-shoes": ("M", "shoes")})


def to_item(p, gender, ptype):
    if p.get("status") != "marketable":
        return None
    variants = [v for v in p.get("variants") or [] if v.get("status") == "marketable" and (v.get("price") or {}).get("selling_price")]
    if not variants:
        return None
    v0 = min(variants, key=lambda v: v["price"]["selling_price"])
    pr = v0["price"]
    img = ((p.get("images") or {}).get("main") or {}).get("url")
    if not img:
        return None
    img = re.sub(r"h_\d+,w_\d+", "h_500,w_500", img)
    sizes, color = [], ""
    for v in variants:
        for t in v.get("themes") or []:
            val = (t.get("value") or {}).get("title")
            if t.get("type") == "sized" and val and val not in sizes:
                sizes.append(val)
            if t.get("type") == "colored" and val and not color:
                color = val
    cat = (p.get("category") or {}).get("title_fa")
    return common.finalize({
        "id": f"digistyle:{p['id']}",
        "store": "digistyle",
        "title": p.get("title_fa"),
        "brand": (p.get("brand") or {}).get("title_fa") or "",
        "gender": gender,
        "type": ptype or common.guess_type(p.get("title_fa"), [cat or ""]),
        "cat": [c for c in [cat] if c],
        "color": color,
        "price": pr["selling_price"] // 10,
        "basePrice": (pr.get("rrp_price") or pr["selling_price"]) // 10,
        "discount": pr.get("discount_percent") or 0,
        "sizes": sizes[:12],
        "url": (p.get("url") or {}).get("url") or f"https://www.digistyle.com/product/{p['id']}",
        "img": img,
        "orders": (p.get("rating") or {}).get("count") or 0,
    })


def crawl(limit=None, log=print, pages=2):
    items, seen = [], set()
    for code, (gender, ptype) in CATEGORIES.items():
        got = 0
        for page in range(1, pages + 1):
            d = common.get_json(API.format(code=code, page=page))
            data = (d or {}).get("data") or {}
            prods = [p for w in data.get("widgets") or [] if w.get("type") == "products" for p in (w.get("data") or {}).get("products") or []]
            if not prods:
                break
            for p in prods:
                it = to_item(p, gender, ptype)
                if it and it["id"] not in seen:
                    seen.add(it["id"])
                    items.append(it)
                    got += 1
            pager = data.get("pager") or {}
            if page >= (pager.get("total_pages") or 1):
                break
        log(f"digistyle {code:38} +{got}  (total {len(items)})")
        if got and len(items) % 500 < got:
            common.save("digistyle", items)
        if limit and len(items) >= limit:
            break
    return items[:limit] if limit else items


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--pages", type=int, default=2)
    ap.add_argument("--limit", type=int)
    a = ap.parse_args()
    print(common.save("digistyle", crawl(a.limit, pages=a.pages)))
