#!/usr/bin/env python3
"""
نمونه‌های ازپیش‌گرفته‌ی پینترست برای «دوخت سفارشی» بدون سرور

پینترست و i.pinimg.com در ایران فیلترند و فایل تک‌فایلی هم سرور ندارد؛ پس نتیجه‌ی چند درخواست رایج
یک بار (از جایی که پینترست باز است) گرفته و کنار سایت گذاشته می‌شود:

  data/pins/<id>.jpg   عکس‌های کوچک‌شده
  data/pins.js         window.RG_PINS = { sets: [{ fa, en, items: [...] }] }

app.js وقتی api/pins در دسترس نیست، نزدیک‌ترین دسته را نشان می‌دهد؛ build_standalone.py عکس‌ها را داخل فایل می‌گذارد.
راه جست‌وجو همان راه داخلی سایت پینترست است (رسمی نیست؛ برای نسخه‌ی نمایشی).

  python scripts/fetch_pins.py [--per 8] [--width 420]
"""
import argparse, http.cookiejar, io, json, os, time, urllib.parse, urllib.request

from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141 Safari/537.36"
HOST = "https://www.pinterest.com"

# (درخواست فارسی، کلیدواژه‌ی انگلیسی؛ همان خروجی tailorQuery در engine.js)
QUERIES = [
    ("پیراهن مجلسی بلند یقه قایقی", "evening dress boat neck long"),
    ("پیراهن مجلسی آستین پفی", "evening dress puff sleeve"),
    ("لباس مجلسی پوشیده با آستین بلند", "long sleeve modest evening dress"),
    ("پیراهن مجلسی دکلته", "evening dress off shoulder"),
    ("پیراهن مجلسی گیپور", "evening dress lace"),
    ("پیراهن مجلسی ماهی دنباله‌دار", "evening dress mermaid train"),
    ("پیراهن میدی گل‌دار", "midi dress floral"),
    ("پیراهن یلدا مخمل قرمز", "evening dress velvet red yalda"),
    ("لباس نامزدی", "engagement dress"),
    ("لباس محلی کردی", "kurdish dress"),
    ("مانتو کتی", "blazer tunic coat"),
    ("مانتو بلند لینن", "modest long tunic coat linen"),
    ("کت و دامن", "skirt suit"),
    ("کت و شلوار زنانه", "women suit"),
    ("کت و شلوار مردانه", "men suit"),
    ("پیراهن مردانه", "men shirt"),
    ("شومیز ساتن یقه پاپیونی", "blouse bow neck satin"),
    ("دامن پلیسه بلند", "pleated skirt long"),
    ("شلوار پالازو", "wide leg pants"),
    ("جامپسوت مجلسی", "jumpsuit evening"),
]


def session():
    jar = http.cookiejar.CookieJar()
    return urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar)), jar


def search(op, jar, q):
    src = "/search/pins/?q=" + urllib.parse.quote(q) + "&rs=typed"
    op.open(urllib.request.Request(HOST + src, headers={"User-Agent": UA, "Accept": "text/html", "Accept-Language": "en-US,en;q=0.9"}), timeout=40).read()
    data = json.dumps({"options": {"query": q, "scope": "pins", "rs": "typed", "redux_normalize_feed": True}, "context": {}})
    url = HOST + "/resource/BaseSearchResource/get/?source_url=" + urllib.parse.quote(src) + "&data=" + urllib.parse.quote(data)
    h = {"User-Agent": UA, "Accept": "application/json, text/javascript, */*, q=0.01", "X-Requested-With": "XMLHttpRequest", "X-Pinterest-AppState": "active",
         "X-Pinterest-Source-Url": src, "X-Pinterest-PWS-Handler": "www/search/[scope].js", "Referer": HOST + src}
    csrf = next((c.value for c in jar if c.name == "csrftoken"), None)
    if csrf:
        h["X-CSRFToken"] = csrf
    d = json.loads(op.open(urllib.request.Request(url, headers=h), timeout=40).read())
    res = (d.get("resource_response") or {}).get("data") or {}
    out = []
    for r in (res if isinstance(res, list) else res.get("results") or []):
        im = r.get("images") or {}
        small, big = im.get("474x") or im.get("236x"), im.get("736x") or im.get("orig")
        if r.get("type") != "pin" or r.get("is_promoted") or not small:
            continue
        out.append({"id": r.get("image_signature") or r["id"], "title": " ".join(str(r.get("grid_title") or r.get("title") or "").split())[:140],
                    "img": small["url"], "big": (big or small)["url"], "w": small.get("width"), "h": small.get("height"),
                    "color": r.get("dominant_color"), "source": r.get("link") if str(r.get("link") or "").startswith("http") else None})
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--per", type=int, default=8, help="تعداد نمونه برای هر درخواست")
    ap.add_argument("--width", type=int, default=420)
    a = ap.parse_args()
    out_dir = os.path.join(ROOT, "data", "pins")
    os.makedirs(out_dir, exist_ok=True)
    op, jar = session()
    sets = []
    for fa, en in QUERIES:
        try:
            pins = search(op, jar, en)
        except Exception as e:
            print("search failed:", en, e)
            continue
        items = []
        for p in pins:
            if len(items) >= a.per:
                break
            path = os.path.join(out_dir, p["id"] + ".jpg")
            if not os.path.exists(path):
                try:
                    raw = urllib.request.urlopen(urllib.request.Request(p["img"], headers={"User-Agent": UA, "Referer": HOST + "/"}), timeout=40).read()
                    im = Image.open(io.BytesIO(raw)).convert("RGB")
                    if im.width > a.width:
                        im = im.resize((a.width, round(im.height * a.width / im.width)), Image.LANCZOS)
                    im.save(path, "JPEG", quality=80, optimize=True, progressive=True)
                except Exception as e:
                    print("  image failed:", p["img"], e)
                    continue
            rel = "data/pins/" + p["id"] + ".jpg"
            items.append(dict(p, thumb=rel, large=rel))
        sets.append({"fa": fa, "en": en, "items": items})
        print(f"{len(items):3}  {fa}  ({en})")
        time.sleep(1.5)
    with open(os.path.join(ROOT, "data", "pins.js"), "w", encoding="utf-8") as fh:
        fh.write("window.RG_PINS = " + json.dumps({"generated": time.strftime("%Y-%m-%d"), "sets": sets}, ensure_ascii=False) + ";\n")
    print("data/pins.js", sum(len(s["items"]) for s in sets), "pins")


if __name__ == "__main__":
    main()
