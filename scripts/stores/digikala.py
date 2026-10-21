#!/usr/bin/env python3
"""
دیجی‌کالا (digikala.com) — API عمومی جست‌وجوی دسته‌بندی

  https://api.digikala.com/v1/categories/<code>/search/?page=N&sort=7&has_selling_stock=1
  sort=7 یعنی پرفروش‌ترین؛ has_selling_stock=1 فقط کالاهای موجود. هر صفحه ۲۰ کالا. قیمت‌ها ریال‌اند.

  python3 scripts/stores/digikala.py [--pages 2]
"""
import argparse, os, re, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common  # noqa: E402

API = "https://api.digikala.com/v1/categories/{code}/search/?page={page}&sort=7&has_selling_stock=1"

# دسته → (جنسیت، نوع در صورت قطعی بودن)
CATEGORIES = {
    # زنانه: پوشاک
    "women-tee-shirts": ("W", "tshirt"), "women-shirt": ("W", "shirt"), "women-blouse": ("W", "blouse"), "women-polo-shirt": ("W", "polo"),
    "women-tops-and-croptops": ("W", "top"), "women-trousers": ("W", "pants"), "women-jeans": ("W", "pants"), "women-skirts": ("W", "skirt"),
    "women-shorts-": ("W", "shorts"), "women-dresses": ("W", "dress"), "women's-evening-dress": ("W", "dress"), "women-sarafan": ("W", "dress"),
    "women-knitwear": ("W", "knit"), "women-hoodies-collection": ("W", "hoodie"), "women-sweatshirts-collection": ("W", "sweatshirt"),
    "women-warm-jacket": ("W", "jacket"), "women-light-jacket": ("W", "jacket"), "women-leather-outwear": ("W", "jacket"), "women-coat-": ("W", "coat"),
    "women-raincoat": ("W", "coat"), "women-coat-manto": ("W", "manto"), "women-tunic": ("W", "manto"), "women-mantou-and-pant": ("W", "set"),
    "women-jacket-": ("W", "suit"), "women-suits-and-sets": ("W", "set"), "women-tracksuits-and-sets": ("W", "set"),
    "women-sport-trousers-and-jumpsuits": ("W", "pants"), "women-legging": ("W", "pants"),
    # مردانه: پوشاک
    "men-tee-shirts": ("M", "tshirt"), "men-polo-shirt": ("M", "polo"), "men-shirts": ("M", "shirt"), "men-trousers": ("M", "pants"),
    "men-jeans": ("M", "pants"), "men-shorts": ("M", "shorts"), "men-knitwear": ("M", "knit"), "men-hoodies-collection": ("M", "hoodie"),
    "men-sweatshirts-collection": ("M", "sweatshirt"), "men-warm-jacket": ("M", "jacket"), "menjacket": ("M", "jacket"),
    "men-leather-outwear": ("M", "jacket"), "men-coat": ("M", "coat"), "men-formal-jacket": ("M", "suit"), "men-suits-and-sets": ("M", "suit"),
    "men-sport-trousers-jumpsuits": ("M", "pants"), "men-tracksuits-sets": ("M", "set"),
    # زنانه: کیف، کفش و اکسسوری
    "women-bags": ("W", "bag"), "women-backpacks": ("W", "bag"), "women-scarves": ("W", "scarf"), "women-eyewear": ("W", "glasses"),
    "women-analouge-watches": ("W", "watch"), "women-earrings": ("W", "jewelry"), "women-jewelry-sets": ("W", "jewelry"), "women-chain": ("W", "jewelry"),
    "women-ring": ("W", "jewelry"), "casual-shoes-for-women": ("W", "shoes"), "women-sport-shoes-": ("W", "shoes"), "women-heeled-shoes": ("W", "shoes"),
    "women-flat-shoes": ("W", "shoes"), "women-ankle-boots": ("W", "shoes"), "women-boots": ("W", "shoes"), "women-boat-shoes": ("W", "shoes"),
    "women-sandals": ("W", "sandals"), "women-socks-": ("W", "socks"), "women-headwear": ("W", "hat"), "women-gloves-and-mittens": ("W", "hat"),
    # مردانه: کیف، کفش و اکسسوری
    "men-bags": ("M", "bag"), "men-backpacks": ("M", "bag"), "men-eyewear": ("M", "glasses"), "men-analouge-watches": ("M", "watch"),
    "men-wallets-bags": ("M", "wallet"), "casual-shoes-for-men": ("M", "shoes"), "men-sport-shoes-": ("M", "shoes"), "men-formal-shoes": ("M", "shoes"),
    "men-driving-shoes": ("M", "shoes"), "men-ankle-boots": ("M", "shoes"), "men-boots": ("M", "shoes"), "men-sandals": ("M", "sandals"),
    "men-socks-tights": ("M", "socks"), "men-headwear": ("M", "hat"), "men-gloves-mittens": ("M", "hat"), "men-ties": ("M", "scarf"),
    "men-shawl": ("M", "scarf"), "men-chain": ("M", "jewelry"), "men-ring": ("M", "jewelry"),
    "men-belts": ("M", "belt"), "women-belts": ("W", "belt"),
}


def to_item(p, code, gender, ptype):
    if p.get("status") != "marketable":
        return None
    dv = p.get("default_variant") or {}
    pr = dv.get("price") or {}
    if not pr.get("selling_price"):
        return None
    imgs = ((p.get("images") or {}).get("main") or {}).get("url") or []
    if not imgs:
        return None
    img = re.sub(r"h_\d+,w_\d+", "h_500,w_500", imgs[0])
    color = next((t["value"]["title"] for t in dv.get("themes") or [] if t.get("type") == "colored" and t.get("value")), "")
    dl = p.get("data_layer") or {}
    cats = [dl.get(k) for k in ("item_category3", "item_category4", "item_category5") if dl.get(k)]
    return common.finalize({
        "id": f"digikala:{p['id']}",
        "store": "digikala",
        "title": p.get("title_fa"),
        "brand": dl.get("brand") or "",
        "gender": gender,
        "type": ptype or common.guess_type(p.get("title_fa"), cats),
        "cat": cats,
        "color": color,
        "price": pr["selling_price"] // 10,
        "basePrice": (pr.get("rrp_price") or pr["selling_price"]) // 10,
        "discount": pr.get("discount_percent") or 0,
        "sizes": [],
        "url": "https://www.digikala.com" + ((p.get("url") or {}).get("uri") or f"/product/dkp-{p['id']}/"),
        "img": img,
        "orders": (p.get("rating") or {}).get("count") or 0,
    })


def crawl(limit=None, log=print, pages=2, store="digikala", api=API):
    items, seen = [], set()
    for code, (gender, ptype) in CATEGORIES.items():
        got = 0
        for page in range(1, pages + 1):
            d = common.get_json(api.format(code=code, page=page))
            prods = ((d or {}).get("data") or {}).get("products") or []
            if not prods:
                break
            for p in prods:
                it = to_item(p, code, gender, ptype)
                if it and it["id"] not in seen:
                    if store != "digikala":
                        it["id"] = it["id"].replace("digikala:", store + ":")
                        it["store"] = store
                    seen.add(it["id"])
                    items.append(it)
                    got += 1
        log(f"{store} {code:38} +{got}  (total {len(items)})")
        if len(items) % 500 < 40:
            common.save(store, items)
        if limit and len(items) >= limit:
            break
    return items[:limit] if limit else items


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--pages", type=int, default=2)
    ap.add_argument("--limit", type=int)
    a = ap.parse_args()
    print(common.save("digikala", crawl(a.limit, pages=a.pages)))
