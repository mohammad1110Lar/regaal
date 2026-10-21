#!/usr/bin/env python3
"""چرم مشهد — فروشگاه اینترنتی قابل‌دسترس پیدا نشد؛ محصولات خود برند در دیجی‌کالا (پیوند خرید: صفحه‌ی دیجی‌کالا)"""
import argparse, os, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common  # noqa: E402
from dkbrand import crawl_brand  # noqa: E402


def crawl(limit=None, log=print):
    return crawl_brand("charmmashhad", "چرم مشهد", "چرم مشهد", limit, log)


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int)
    a = ap.parse_args()
    print(common.save("charmmashhad", crawl(a.limit)))
