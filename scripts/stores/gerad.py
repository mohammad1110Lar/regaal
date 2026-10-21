#!/usr/bin/env python3
"""
گراد (gerad.ir) — همان پلتفرم ال‌سی‌من؛ صفحه‌های بعدی از مسیر اسکرول بی‌پایان

  https://www.gerad.ir/search/java/scroll?Params=<دسته>?pageno=N&sortby=1&stock=1
  هر صفحه ۲۴ کارت HTML با نام، عکس، قیمت (data-value به ریال) و سایزهای موجود.

  python3 scripts/stores/gerad.py
"""
import argparse, html as H, os, re, sys, urllib.parse

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common  # noqa: E402

HOST = "https://www.gerad.ir"
ROOTS = {"آقایان": "M", "بانوان": "W"}


def page_url(slug, page):
    params = slug + ("" if page == 1 else f"?pageno={page}") + ("&" if page > 1 else "?") + "sortby=1&stock=1"
    return f"{HOST}/search/java/scroll?Params=" + urllib.parse.quote(params)


def parse(h, gender):
    for c in re.split(r'<div class="product-wrap', h)[1:]:
        m = re.search(r'/product/(\d+)/([^"?]+)', c)
        name = re.search(r'class="product-name">\s*<a[^>]*>(.*?)</a>', c, re.S)
        img = re.search(r'data-src="([^"]+)"', c)
        price = re.search(r'class="product-price" data-value="([\d.]+)"', c)
        if not (m and name and img and price):
            continue
        old = re.search(r'class="old-price">\s*([\d,]+)', c)
        sizes = [s.strip() for s in re.findall(r'class="size[^"]*"[^>]*>\s*([^<]{1,8})\s*</a>', c)]
        title = re.sub(r"\s+\d{5,}$", "", H.unescape(name.group(1)).strip())
        toman = int(float(price.group(1))) // 10
        yield common.finalize({
            "id": f"gerad:{m.group(1)}",
            "store": "gerad",
            "title": title,
            "brand": "گراد",
            "gender": gender if common.guess_gender(title) == "U" else common.guess_gender(title),
            "cat": [],
            "price": toman,
            "basePrice": common.to_int(old.group(1)) if old else toman,
            "sizes": list(dict.fromkeys(sizes))[:12],
            "url": f"{HOST}/product/{m.group(1)}/{m.group(2)}",
            "img": urllib.parse.urljoin(HOST, img.group(1)),
        })


def crawl(limit=None, log=print, pages=40):
    items, seen = [], set()
    for slug, gender in ROOTS.items():
        for page in range(1, pages + 1):
            h = H.unescape(common.get_html(page_url(slug, page), timeout=120) or "")
            got = 0
            for it in parse(h, gender):
                if it and it["id"] not in seen:
                    seen.add(it["id"])
                    items.append(it)
                    got += 1
            log(f"gerad {slug} page {page}: +{got}  (total {len(items)})")
            common.save("gerad", items)
            if not got:
                break
            if limit and len(items) >= limit:
                return items[:limit]
    return items


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int)
    a = ap.parse_args()
    print(common.save("gerad", crawl(a.limit)))
