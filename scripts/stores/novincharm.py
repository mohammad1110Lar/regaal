#!/usr/bin/env python3
"""
نوین چرم (novinleather.com) — صفحه‌های دسته (HTML)

  https://novinleather.com/fa/product/cat/1-آقایان.html&page=N&order=sell
  هر کارت چند رنگ دارد (data-price1/2، data-pic1، data-href با priceid)؛ برای هر رنگ یک کالا.
  رنگ از نام فایل عکس (MESHKI، GHAHVEI…) خوانده می‌شود. قیمت تومان.

  python3 scripts/stores/novincharm.py
"""
import argparse, html as H, os, re, sys, urllib.parse

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common  # noqa: E402

ROOTS = {"1-آقایان": "M", "2-خانم-ها": "W"}
COLOR = {"MESHKI": "مشکی", "BLACK": "مشکی", "GHAHVEI": "قهوه‌ای", "GHAHVE": "قهوه‌ای", "GHAHVEYI": "قهوه‌ای", "BROWN": "قهوه‌ای",
         "ZERESHKI": "زرشکی", "ASALI": "عسلی", "SORMEI": "سرمه‌ای", "NAVY": "سرمه‌ای", "TOOSI": "طوسی", "TOSI": "طوسی", "GRAY": "طوسی",
         "KHAKESTARI": "طوسی", "KEREM": "کرم", "KREM": "کرم", "BEZH": "بژ", "BEIGE": "بژ", "SEFID": "سفید", "WHITE": "سفید",
         "SABZ": "سبز", "ZEITOONI": "زیتونی", "ZEYTOONI": "زیتونی", "GHERMEZ": "قرمز", "RED": "قرمز", "ABI": "آبی", "BLUE": "آبی",
         "NAFTI": "سرمه‌ای", "SHOTORI": "شتری", "KARAMELI": "کاراملی", "TAN": "عسلی", "COGNAC": "عسلی", "SOORATI": "صورتی", "SORATI": "صورتی"}


def color_of(url):
    name = os.path.basename(url or "").upper()
    return next((fa for en, fa in COLOR.items() if re.search(r"(^|[-_])" + en + r"([-_.]|$)", name)), "")


def cards(h):
    for m in re.finditer(r'<div class="item">(.*?)</li>', h, re.S):
        yield m.group(1)


def crawl(limit=None, log=print, pages=40):
    items, seen = [], set()
    for root, gender in ROOTS.items():
        for page in range(1, pages + 1):
            url = "https://novinleather.com" + urllib.parse.quote(f"/fa/product/cat/{root}.html") + f"&page={page}&order=sell"
            h = H.unescape(common.get_html(url, timeout=90) or "")
            got = 0
            for c in cards(h):
                if "ناموجود" in c:
                    continue
                t = re.search(r'class="title">\s*(.*?)\s*</a>', c, re.S)
                title = re.sub(r"\s+(Fm|Fw|M|W)?-?\s*[A-Z]{1,3}\d{3,6}\s*$", "", re.sub(r"<[^>]+>", "", t.group(1)).strip()) if t else ""
                if not title:
                    continue
                for v in re.finditer(r'data-price2="(\d+)" data-price1="(\d+)" data-href="([^"]+)" data-pic1="([^"]+)"(?: data-pic2="([^"]+)")?', c):
                    sale, orig, href, pic1, pic2 = v.groups()
                    href = common.unproxy(href)
                    pid = re.search(r"/(\d+)-[^/]*\.html.*?priceid=(\d+)", href)
                    key = f"{pid.group(1)}-{pid.group(2)}" if pid else href
                    if key in seen:
                        continue
                    seen.add(key)
                    it = common.finalize({
                        "id": f"novincharm:{key}",
                        "store": "novincharm",
                        "style": f"novincharm:{pid.group(1) if pid else key}",
                        "title": title + ("" if re.search("مردانه|زنانه", title) else " " + {"M": "مردانه", "W": "زنانه"}[gender]),
                        "brand": "نوین چرم",
                        "gender": gender,
                        "cat": [x for x in urllib.parse.unquote(href).split("/")[5:7]],
                        "color": color_of(pic1),
                        "features": {"جنس": "چرم طبیعی"},
                        "price": int(sale) or int(orig),
                        "basePrice": int(orig),
                        "url": urllib.parse.quote(href, safe=":/&=?%"),
                        "img": pic1.replace("/thumb2/", "/thumb1/") if False else pic1,
                        "img2": pic2,
                    })
                    if it:
                        items.append(it)
                        got += 1
            log(f"novincharm {root} page {page}: +{got}  (total {len(items)})")
            common.save("novincharm", items)
            if not got:
                break
            if limit and len(items) >= limit:
                return items[:limit]
    return items


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int)
    a = ap.parse_args()
    print(common.save("novincharm", crawl(a.limit)))
