#!/usr/bin/env python3
"""هاکوپیان (shop.hacoupian.net) — ووکامرس؛ پوشاک و اکسسوری مردانه و زنانه"""
import argparse, os, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common  # noqa: E402
from woo import crawl_woo  # noqa: E402


def crawl(limit=None, log=print):
    return crawl_woo("hacoupian", "https://shop.hacoupian.net", "هاکوپیان", limit, log, default_gender="M")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int)
    a = ap.parse_args()
    print(common.save("hacoupian", crawl(a.limit)))
