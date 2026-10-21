"""
خزنده‌ی عمومی فروشگاه‌های ووکامرس (WooCommerce Store API، عمومی و بدون کلید)

  <base>/wp-json/wc/store/v1/products?per_page=100&page=N
  قیمت‌ها با currency_minor_unit می‌آیند؛ واحد پول (IRR/IRT) تبدیل به تومان می‌شود.
"""
import html, re

import common


def money(prices, key):
    v = common.to_int((prices or {}).get(key))
    minor = int((prices or {}).get("currency_minor_unit") or 0)
    v = v // (10 ** minor) if minor else v
    code = ((prices or {}).get("currency_code") or "").upper()
    return v // 10 if code == "IRR" else v


def attr_terms(p, *names):
    out = []
    for a in p.get("attributes") or []:
        n = (a.get("name") or "") + " " + (a.get("taxonomy") or "")
        if any(k in n for k in names):
            out += [html.unescape(t.get("name") or "") for t in a.get("terms") or []]
    return [x for x in out if x]


def crawl_woo(store, base, brand, limit=None, log=print, default_gender="U", max_pages=60):
    items, seen = [], set()
    for page in range(1, max_pages + 1):
        lst = common.get_json(f"{base}/wp-json/wc/store/v1/products?per_page=100&page={page}")
        if not isinstance(lst, list) or not lst:
            break
        for p in lst:
            if not p.get("is_in_stock") or not p.get("is_purchasable", True):
                continue
            cats = [html.unescape(c.get("name") or "") for c in p.get("categories") or []]
            name = html.unescape(re.sub(r"<[^>]+>", "", p.get("name") or ""))
            imgs = [i.get("src") for i in p.get("images") or [] if i.get("src")]
            price = money(p.get("prices"), "price")
            if not imgs or not price:
                continue
            colors = attr_terms(p, "رنگ", "color", "colour")
            gender = common.guess_gender(name, " ".join(cats))
            it = common.finalize({
                "id": f"{store}:{p['id']}",
                "store": store,
                "title": name,
                "brand": brand,
                "gender": default_gender if gender == "U" else gender,
                "cat": cats[-3:],
                "color": colors[0] if len(colors) == 1 else "",
                "price": price,
                "basePrice": money(p.get("prices"), "regular_price") or price,
                "sizes": attr_terms(p, "سایز", "size")[:12],
                "url": p.get("permalink"),
                "img": imgs[0],
                "img2": imgs[1] if len(imgs) > 1 else None,
            })
            if it and it["id"] not in seen:
                seen.add(it["id"])
                items.append(it)
        log(f"{store} page {page}  total {len(items)}")
        common.save(store, items)
        if len(lst) < 100 or (limit and len(items) >= limit):
            break
    return items[:limit] if limit else items
