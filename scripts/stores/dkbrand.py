"""
برندهایی که فروشگاه اینترنتی قابل‌دسترس ندارند: محصولات خود برند در دیجی‌کالا
  https://api.digikala.com/v1/search/?q=<نام برند>&page=N&has_selling_stock=1  (فقط کالاهایی که brand دقیقاً همان است)
"""
import urllib.parse

import common
from digikala import to_item


def crawl_brand(store, query, brand, limit=None, log=print, pages=30):
    items, seen = [], set()
    for page in range(1, pages + 1):
        d = common.get_json("https://api.digikala.com/v1/search/?q=" + urllib.parse.quote(query) + f"&page={page}&has_selling_stock=1")
        prods = ((d or {}).get("data") or {}).get("products") or []
        if not prods:
            break
        got = 0
        for p in prods:
            dl = p.get("data_layer") or {}
            if (dl.get("brand") or "").strip() != brand:
                continue
            g = {"زنانه": "W", "مردانه": "M"}.get(dl.get("item_category3"), common.guess_gender(p.get("title_fa"), dl.get("item_category4"), dl.get("item_category5")))
            it = to_item(p, None, g, None)
            if not it:
                continue
            it["id"] = it["id"].replace("digikala:", store + ":")
            it["store"], it["style"], it["brand"], it["via"] = store, it["id"], brand, "digikala"
            if it["id"] not in seen:
                seen.add(it["id"])
                items.append(it)
                got += 1
        log(f"{store} page {page}: +{got}  (total {len(items)})")
        common.save(store, items)
        if limit and len(items) >= limit:
            break
    return items[:limit] if limit else items
