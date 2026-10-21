#!/usr/bin/env python3
"""
ادغام خزش تازه روی داده‌ی قبلی هر فروشگاه

خزش دوباره با STORES_OUT=data/stores-new در پوشه‌ی جدا ذخیره می‌شود تا اگر نیمه‌کاره ماند، داده‌ی قبلی از بین نرود.
این اسکریپت برای هر data/stores-new/<store>.json اجتماع را با data/stores/<store>.json می‌سازد (بر اساس id؛ داده‌ی تازه برنده)
و در data/stores/<store>.json می‌نویسد. بعد: python scripts/merge_catalog.py

  python scripts/merge_stores.py [--src data/stores-new] [--drop-missing]

--drop-missing: کالاهایی که در خزش تازه نیامده‌اند حذف شوند (فقط وقتی خزش تازه کامل بوده است).
"""
import argparse, glob, json, os, time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def load(path):
    try:
        with open(path, encoding="utf-8") as fh:
            return json.load(fh)
    except FileNotFoundError:
        return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", default=os.path.join(ROOT, "data", "stores-new"))
    ap.add_argument("--dst", default=os.path.join(ROOT, "data", "stores"))
    ap.add_argument("--drop-missing", action="store_true")
    a = ap.parse_args()
    os.makedirs(a.dst, exist_ok=True)
    for path in sorted(glob.glob(os.path.join(a.src, "*.json"))):
        new = load(path)
        if not new or not new.get("items"):
            print(f"{os.path.basename(path):20} empty, skipped")
            continue
        store = new.get("store") or os.path.splitext(os.path.basename(path))[0]
        old = load(os.path.join(a.dst, store + ".json")) or {"items": []}
        fresh = {it["id"]: it for it in new["items"] if it.get("id")}
        merged = [] if a.drop_missing else [it for it in old.get("items", []) if it.get("id") and it["id"] not in fresh]
        kept_old = len(merged)
        merged += list(fresh.values())
        out = {"store": store, "crawledAt": new.get("crawledAt") or time.strftime("%Y-%m-%d"), "count": len(merged), "items": merged}
        tmp = os.path.join(a.dst, store + ".json.tmp")
        with open(tmp, "w", encoding="utf-8") as fh:
            json.dump(out, fh, ensure_ascii=False)
        os.replace(tmp, os.path.join(a.dst, store + ".json"))
        print(f"{store:14} old {len(old.get('items', [])):6}  new {len(fresh):6}  kept-old {kept_old:6}  → {len(merged):6}")


if __name__ == "__main__":
    main()
