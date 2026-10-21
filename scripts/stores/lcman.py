#!/usr/bin/env python3
"""
ال‌سی‌من (lc-man.com) — صفحه‌های دسته با JSON-LD

  https://www.lc-man.com/search/<slug>?pageno=N
  صفحه‌ی N همه‌ی کالاهای صفحه‌های ۱ تا N را در JSON-LD (ItemList) دارد؛ پس با pageno بزرگ
  همه‌ی کالاهای دسته در یک درخواست می‌آید. قیمت ریال است؛ موجودی از availability.

  python3 scripts/stores/lcman.py
"""
import argparse, os, re, sys, urllib.parse

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common  # noqa: E402

BASE = "https://www.lc-man.com/search/{slug}?pageno=60"
# دسته → جنسیت (نوع از عنوان)
SLUGS = {
    "casual-shirts": "M", "formal-shirts": "M", "mens_long_sleeve_shirt": "M", "hawaiian_shirt_for_men": "M", "casual-tshirts": "M",
    "casual-sweatshirts": "M", "smart-pullover": "M", "pants": "M", "formal-pants": "M", "cotton-pants": "M", "jeans": "M",
    "suits": "M", "smart-jackets": "M", "waistcoats": "M", "coats": "M", "smart-palto": "M", "trench_coat": "M", "mens_shaket": "M",
    "shoes": "M", "dress_shoes": "M", "mens_vans_shoes": "M", "belt": "M", "ties": "M", "socks": "M", "accessories": "M",
    "womens_blouse": "W", "womens_pants": "W", "womens_tshirts": "W", "womens_coat": "W", "womens_suit": "W",
    "womens_vest_and_pants": "W", "womens_vest_suit": "W", "womens_wear": "W",
}
COLORS = "مشکی|سفید|شیری|کرم|بژ|طوسی|خاکستری|ذغالی|نوک مدادی|سرمه ای|سرمه‌ای|آبی روشن|آبی|نفتی|قهوه ای|قهوه‌ای|شتری|زیتونی|سبز|یشمی|قرمز|زرشکی|صورتی|بنفش|یاسی|زرد|خردلی|نارنجی|گلبهی|کاراملی|عسلی|نباتی|استخوانی|لجنی|طلایی|نقره ای"


def crawl(limit=None, log=print):
    items, seen = [], set()
    for slug, gender in SLUGS.items():
        h = common.get_html(BASE.format(slug=slug), timeout=120) or ""
        lst = []
        for b in common.json_ld(h):
            if isinstance(b, dict) and b.get("@type") == "ItemList":
                lst = [e.get("item") or {} for e in b.get("itemListElement", [])]
        got = 0
        for p in lst:
            offer = p.get("offers") or {}
            if "InStock" not in str(offer.get("availability")):
                continue
            url = p.get("url") or ""
            m = re.search(r"/product/(\d+)", url)
            if not m or m.group(1) in seen:
                continue
            name = p.get("name") or ""
            color = (re.search(COLORS, name) or [None])[0] or ""
            title = re.sub(r"\s+\d+$", "", name)  # «شلوار فاستونی دوپیلی مشکی 84» → بدون کد
            g = common.guess_gender(title)
            g = gender if g == "U" else g
            it = common.finalize({
                "id": f"lcman:{m.group(1)}",
                "store": "lcman",
                "style": "lcman:" + re.sub(r"\s*(" + COLORS + r")\b.*$", "", title),
                "title": title + ("" if re.search("مردانه|زنانه", title) else " " + {"M": "مردانه", "W": "زنانه"}[g]),
                "brand": "ال‌سی‌من",
                "gender": g,
                "cat": [slug],
                "color": color,
                "price": common.to_int(offer.get("price")) // 10,
                "url": urllib.parse.quote(url, safe=":/"),
                "img": urllib.parse.quote(p.get("image") or "", safe=":/"),
            })
            if it:
                seen.add(m.group(1))
                items.append(it)
                got += 1
        log(f"lcman {slug:26} {len(lst):4} listed, +{got} in stock  (total {len(items)})")
        common.save("lcman", items)
        if limit and len(items) >= limit:
            break
    return items[:limit] if limit else items


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int)
    a = ap.parse_args()
    print(common.save("lcman", crawl(a.limit)))
