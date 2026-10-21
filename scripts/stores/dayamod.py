#!/usr/bin/env python3
"""
دایامد (dayamode.com) — صفحه‌های دسته (Next.js، داده‌ی کارت‌ها داخل payload صفحه)

  https://www.dayamode.com/<men|women>/<clothing|shoes|accessories>?page=N   (۲۰ کالا در هر صفحه)
  از هر کارت: شناسه (dmd-…)، نام، برند، عکس، قیمت (تومان) و قیمت قبل از تخفیف.

  python3 scripts/stores/dayamod.py
"""
import argparse, json, os, re, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common  # noqa: E402

SECTIONS = {"men/clothing": "M", "women/clothing": "W", "men/shoes": "M", "women/shoes": "W", "men/accessories": "M", "women/accessories": "W",
            "men/bags": "M", "women/bags": "W"}


def payload(url):
    raw = common.get_html(url, timeout=90) or ""
    try:
        return json.loads('"' + "".join(re.findall(r'self\.__next_f\.push\(\[1,"(.*?)"\]\)', raw, re.S)).replace("\n", "\\n") + '"')
    except Exception:
        return ""


def cards(txt):
    for seg in re.split(r'\["\$","\$L\w+","[^"]*",\{"href":"/product/', txt)[1:]:
        seg = seg[:6000]
        m = re.match(r'(dmd-\d+)/([^"]+)"', seg)
        title = re.search(r'"aria-label":"([^"]+)"', seg)
        img = re.search(r'"src":"(https://core\.dayamode\.com/storage/[^"]+)"', seg)
        prices = re.findall(r'"children":"([\d,]{5,})"', seg)
        brand = re.search(r'line-clamp-1","children":"([^"]+)"', seg)
        if m and title and img and prices:
            yield m.group(1), m.group(2), title.group(1), img.group(1), prices, brand.group(1) if brand else ""


def crawl(limit=None, log=print, pages=30):
    items, seen = [], set()
    for sec, gender in SECTIONS.items():
        for page in range(1, pages + 1):
            got = 0
            for pid, slug, title, img, prices, brand in cards(payload(f"https://www.dayamode.com/{sec}?page={page}")):
                if pid in seen:
                    continue
                seen.add(pid)
                nums = [common.to_int(p) for p in prices]
                # کارت دو نسخه دارد (دسکتاپ و موبایل)؛ قیمت‌ها: [قبل، بعد، قبل، بعد] یا [قیمت، قیمت]
                price, base = (nums[1], nums[0]) if len(nums) >= 2 and nums[0] > nums[1] else (nums[0], nums[0])
                t = re.sub(r"\s*کد\s*[\w-]+\s*$", "", title).strip()
                it = common.finalize({
                    "id": f"dayamod:{pid}",
                    "store": "dayamod",
                    "title": t,
                    "brand": brand,
                    "gender": gender,
                    "cat": [sec],
                    "price": price,
                    "basePrice": base,
                    "url": f"https://www.dayamode.com/product/{pid}/{slug}",
                    "img": img,
                })
                if it:
                    items.append(it)
                    got += 1
            log(f"dayamod {sec} page {page}: +{got}  (total {len(items)})")
            common.save("dayamod", items)
            if not got:
                break
            if limit and len(items) >= limit:
                return items[:limit]
    return items


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int)
    a = ap.parse_args()
    print(common.save("dayamod", crawl(a.limit)))
