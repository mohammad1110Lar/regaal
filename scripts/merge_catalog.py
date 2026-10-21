#!/usr/bin/env python3
"""
ادغام فروشگاه‌ها در یک کاتالوگ

هر فروشگاه خروجی خودش را در data/stores/<store>.json دارد (scripts/stores/<store>.py).
این اسکریپت همه را یکی می‌کند، تکراری‌ها را حذف و فیلدها را کوچک می‌کند و می‌نویسد:

  data/catalog.json   برای سرور
  data/catalog.js     برای نسخه‌ی استاتیک (window.JW_CATALOG)

  python3 scripts/merge_catalog.py
"""
import glob, json, os, time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# نام فارسی و دامنه‌ی هر فروشگاه (ترتیب = ترتیب نمایش)
STORES = {
    "digikala": ("دیجی‌کالا", "digikala.com"),
    "digistyle": ("دیجی‌استایل", "digistyle.com"),
    "banimode": ("بانی‌مد", "banimode.com"),
    "jeanswest": ("جین‌وست", "jeanswest.ir"),
    "gerad": ("گراد", "gerad.ir"),
    "lcman": ("ال‌سی‌من", "lc-man.com"),
    "charmmashhad": ("چرم مشهد", ""),
    "dorsa": ("چرم درسا", ""),
    "novincharm": ("نوین چرم", "novinleather.com"),
    "hacoupian": ("هاکوپیان", "shop.hacoupian.net"),
    "salian": ("سالیان", "salian.com"),
    "bodyspinner": ("بادی اسپینر", "bodyspinner.co"),
    "dayamod": ("دایامد", "dayamode.com"),
}
# یک کالا در چند فروشگاه از یک انبار: نسخه‌ی فروشگاهِ اول این فهرست نگه داشته می‌شود
PREFER = ["charmmashhad", "dorsa", "digistyle", "digikala"]
KEEP_FEATURES = ("استایل", "جنس پارچه", "جنس", "مناسب برای فصول", "فصل", "یقه", "آستین", "قد", "ارتفاع فاق", "طرح", "نحوه بسته‌شدن", "سایر توضیحات")
FIELDS = ("id", "store", "style", "title", "brand", "gender", "group", "type", "cat", "color", "features", "price", "basePrice",
          "discount", "sizes", "url", "img", "img2", "orders", "via")


def compact(it):
    out = {k: it[k] for k in FIELDS if it.get(k) not in (None, "", [], {})}
    out.setdefault("price", it.get("price"))
    if out.get("img2") == out.get("img"):
        out.pop("img2", None)
    f = {k: str(v)[:80] for k, v in (it.get("features") or {}).items() if k in KEEP_FEATURES and v}
    if f:
        out["features"] = f
    else:
        out.pop("features", None)
    out["cat"] = [str(c)[:40] for c in (it.get("cat") or [])][-3:]
    if out.get("basePrice") == out.get("price"):
        out.pop("basePrice", None)
    return out


def main():
    items, seen, meta = [], set(), {}
    paths = sorted(glob.glob(os.path.join(ROOT, "data", "stores", "*.json")))
    rank = lambda p: PREFER.index(os.path.splitext(os.path.basename(p))[0]) if os.path.splitext(os.path.basename(p))[0] in PREFER else -1
    dk_seen = set()  # شناسه‌ی عددی کالاهای دیجی‌کالایی (دیجی‌کالا، دیجی‌استایل، برندهای «via digikala»)
    for path in sorted(paths, key=lambda p: (rank(p) < 0, rank(p))):
        with open(path, encoding="utf-8") as fh:
            data = json.load(fh)
        store = data.get("store") or os.path.splitext(os.path.basename(path))[0]
        n = 0
        for it in data.get("items", []):
            if not it.get("id") or it["id"] in seen or not it.get("img") or not it.get("price") or it["price"] <= 0:
                continue
            if store in PREFER:
                num = it["id"].split(":", 1)[1]
                if num in dk_seen:
                    continue
                dk_seen.add(num)
            seen.add(it["id"])
            items.append(compact(it))
            n += 1
        name, domain = STORES.get(store, (store, ""))
        meta[store] = {"name": name, "domain": domain, "count": n, "crawledAt": data.get("crawledAt")}
        print(f"{store:14} {n:6}")
    order = list(STORES)
    meta = dict(sorted(meta.items(), key=lambda kv: order.index(kv[0]) if kv[0] in order else 99))
    catalog = {"generated": time.strftime("%Y-%m-%d"), "count": len(items), "stores": meta, "items": items}
    with open(os.path.join(ROOT, "data", "catalog.json"), "w", encoding="utf-8") as fh:
        json.dump(catalog, fh, ensure_ascii=False, separators=(",", ":"))
    with open(os.path.join(ROOT, "data", "catalog.js"), "w", encoding="utf-8") as fh:
        fh.write("window.JW_CATALOG = " + json.dumps(catalog, ensure_ascii=False, separators=(",", ":")) + ";\n")
    size = os.path.getsize(os.path.join(ROOT, "data", "catalog.json")) / 1e6
    print(f"total {len(items)} items from {len(meta)} stores → data/catalog.json ({size:.1f} MB)")


if __name__ == "__main__":
    main()
