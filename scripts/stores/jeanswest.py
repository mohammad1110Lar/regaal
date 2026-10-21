#!/usr/bin/env python3
"""
جین‌وست (jeanswest.ir)

داده از خزنده‌ی اختصاصی scripts/build_catalog.py می‌آید (صفحه‌های دسته‌بندی Next.js سایت).
این ماژول خروجی آن را به قالب مشترک فروشگاه‌ها (common.py) تبدیل می‌کند:

  python3 scripts/build_catalog.py --via-google --all-in-stock     # خزیدن تازه → data/catalog.json قدیمی
  python3 scripts/stores/jeanswest.py --from data/jeanswest-raw.json
"""
import argparse, json, os, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


def convert(raw_items):
    out = []
    for it in raw_items:
        remote = it.get("remote") or {}
        item = {
            "id": "jeanswest:" + it["id"],
            "store": "jeanswest",
            "style": "jeanswest:" + str(it.get("style") or it["id"]),
            "title": it.get("title"),
            "brand": it.get("brand") or "جین‌وست",
            "gender": it.get("gender") or "U",
            "type": it.get("type"),
            "cat": it.get("cat") or [],
            "color": it.get("color") or "",
            "features": it.get("features") or {},
            "price": it.get("price"),
            "basePrice": it.get("basePrice"),
            "discount": it.get("discount"),
            "sizes": it.get("sizes") or [],
            "url": it.get("url"),
            "img": remote.get("main"),
            "img2": remote.get("alt"),
            "orders": it.get("orders") or 0,
        }
        if item["type"] == "kids":
            item["type"] = None  # از عنوان حدس زده می‌شود
        item = common.finalize(item)
        if item:
            out.append(item)
    return out


def crawl(limit=None, log=print, source=None):
    path = source or os.path.join(ROOT, "data", "jeanswest-raw.json")
    with open(path, encoding="utf-8") as fh:
        raw = json.load(fh)
    items = convert(raw["items"] if isinstance(raw, dict) else raw)
    log(f"jeanswest: {len(items)} items")
    return items[:limit] if limit else items


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--from", dest="source")
    ap.add_argument("--limit", type=int)
    a = ap.parse_args()
    print(common.save("jeanswest", crawl(a.limit, source=a.source)))
