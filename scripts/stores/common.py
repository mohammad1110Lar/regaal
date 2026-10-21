"""
ابزار مشترک خزنده‌ی فروشگاه‌ها

هر فروشگاه یک ماژول در همین پوشه دارد (مثلاً digikala.py) با تابع:

    def crawl(limit=None, log=print) -> list[dict]

که فهرستی از محصولات «موجود» را با قالب یکسان زیر برمی‌گرداند (فقط پوشاک، کیف، کفش و اکسسوری مد):

    {
      "id":        "<store>:<شناسه‌ی محصول در همان فروشگاه>",
      "store":     "<کلید فروشگاه، مثل digikala>",
      "style":     "<شناسه‌ی مدل؛ رنگ‌های مختلف یک مدل همین را دارند>",
      "title":     "عنوان فارسی محصول",
      "brand":     "نام برند (برای بازارهایی مثل دیجی‌کالا)",
      "gender":    "W" | "M" | "K" | "U",       # زنانه، مردانه، بچگانه، نامشخص
      "group":     "apparel" | "accessory",
      "type":      "<نوع؛ guess_type>",
      "cat":       ["مسیر دسته‌بندی"],
      "color":     "رنگ به فارسی" یا "",
      "features":  {"جنس پارچه": "...", ...},   # اختیاری
      "price":     قیمت نهایی به تومان (int),
      "basePrice": قیمت قبل از تخفیف به تومان (int),
      "discount":  درصد تخفیف (int),
      "sizes":     ["S", "M", "38", ...],       # سایزهای موجود؛ اگر معلوم نیست []
      "url":       "نشانی صفحه‌ی محصول در همان فروشگاه",
      "img":       "نشانی عکس اصلی (ترجیحاً حدود ۵۰۰ پیکسل)",
      "img2":      "عکس دوم (اختیاری)",
      "orders":    عدد محبوبیت اگر هست، وگرنه 0,
    }

سایت‌های ایرانی روی IP خارجی بسته‌اند؛ fetch() در صورت نیاز از translate.goog عبور می‌کند.
"""
import http.cookiejar, json, os, random, re, threading, time, urllib.error, urllib.parse, urllib.request

UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141 Safari/537.36"
VIA_GOOGLE = os.environ.get("VIA_GOOGLE", "1") == "1"   # بیرون از ایران: 1؛ داخل ایران: VIA_GOOGLE=0
DELAY = float(os.environ.get("CRAWL_DELAY", "0.7"))
_lock = threading.Lock()
_last = [0.0]
# DigiCDN (دیجی‌کالا) اول یک کوکی می‌گذارد و با 307 به همان نشانی برمی‌گرداند؛ بدون کوکی، تغییر مسیر بی‌پایان است.
# داخل ایران (VIA_GOOGLE=0) سایت فروشگاه‌ها مستقیم و بدون فیلترشکن خوانده می‌شوند (پروکسی سیستم کند است و IP خارجی را می‌بندند)؛
# اگر لازم شد USE_PROXY=1.
_handlers = [urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar())]
if not VIA_GOOGLE and os.environ.get("USE_PROXY") != "1":
    _handlers.append(urllib.request.ProxyHandler({}))
_opener = urllib.request.build_opener(*_handlers)


def proxied(url):
    """https://www.example.ir/a?b=1 → https://www-example-ir.translate.goog/a?b=1&_x_tr_sl=..."""
    if not VIA_GOOGLE:
        return url
    p = urllib.parse.urlparse(url)
    if p.netloc.endswith("translate.goog"):
        return url
    host = p.netloc.replace("-", "--").replace(".", "-") + ".translate.goog"
    q = (p.query + "&" if p.query else "") + "_x_tr_sl=fa&_x_tr_tl=en&_x_tr_hl=en"
    return f"https://{host}{p.path or '/'}?{q}"


def unproxy(url):
    """برعکس proxied: نشانی واقعی را برمی‌گرداند (برای url و img خروجی)."""
    if not url or ".translate.goog" not in url:
        return url
    p = urllib.parse.urlparse(url)
    host = p.netloc.replace(".translate.goog", "")
    host = host.replace("--", "\0").replace("-", ".").replace("\0", "-")
    q = "&".join(x for x in p.query.split("&") if x and not x.startswith("_x_tr_"))
    return f"{p.scheme}://{host}{p.path}" + (f"?{q}" if q else "")


def fetch(url, data=None, headers=None, tries=4, timeout=60, raw=False):
    """GET/POST با تأخیر مؤدبانه و تلاش دوباره؛ bytes برمی‌گرداند یا None"""
    target = url if raw else proxied(url)
    h = {"User-Agent": UA, "Accept": "*/*", "Accept-Language": "fa-IR,fa;q=0.9,en;q=0.8"}
    h.update(headers or {})
    for t in range(tries):
        with _lock:
            wait = _last[0] + DELAY - time.time()
            if wait > 0:
                time.sleep(wait)
            _last[0] = time.time()
        try:
            body = json.dumps(data).encode() if isinstance(data, (dict, list)) else data
            if isinstance(data, (dict, list)):
                h.setdefault("Content-Type", "application/json")
            req = urllib.request.Request(target, data=body, headers=h)
            with _opener.open(req, timeout=timeout) as r:
                return r.read()
        except urllib.error.HTTPError as e:
            if e.code in (404, 410):
                return None
            time.sleep((3 if e.code == 429 else 1.5) * (t + 1) + random.random())
        except Exception:
            time.sleep(2 * (t + 1))
    return None


def get_json(url, **kw):
    b = fetch(url, **kw)
    if not b:
        return None
    try:
        return json.loads(b.decode("utf-8", "ignore"))
    except Exception:
        return None


def get_html(url, **kw):
    b = fetch(url, **kw)
    return b.decode("utf-8", "ignore") if b else None


def next_data(html):
    """داده‌ی __NEXT_DATA__ در صفحه‌های Next.js"""
    m = re.search(r'<script id="__NEXT_DATA__"[^>]*>(.*?)</script>', html or "", re.S)
    return json.loads(m.group(1)) if m else None


def json_ld(html):
    """همه‌ی بلوک‌های application/ld+json صفحه"""
    out = []
    for m in re.finditer(r'<script[^>]+application/ld\+json[^>]*>(.*?)</script>', html or "", re.S):
        try:
            out.append(json.loads(m.group(1).strip()))
        except Exception:
            pass
    return out


FA_DIGITS = "۰۱۲۳۴۵۶۷۸۹"
AR_DIGITS = "٠١٢٣٤٥٦٧٨٩"


def to_int(x):
    """«۱٬۲۹۹٬۰۰۰ تومان» → 1299000"""
    if x is None:
        return 0
    if isinstance(x, (int, float)):
        return int(x)
    s = str(x)
    s = "".join(str(FA_DIGITS.index(c)) if c in FA_DIGITS else str(AR_DIGITS.index(c)) if c in AR_DIGITS else c for c in s)
    s = re.sub(r"[^\d.]", "", s)
    try:
        return int(float(s)) if s else 0
    except ValueError:
        return 0


def norm(s):
    s = str(s or "").replace("ي", "ی").replace("ك", "ک").replace("‌", " ")
    return re.sub(r"\s+", " ", s).strip()


# نوع محصول از روی عنوان و دسته‌بندی (همان کلیدهای engine.js)
TYPE_RULES = [
    ("shorts", ["شلوارک", "شورتک", "شورت ورزشی", "برمودا"]),
    ("suit", ["کت و شلوار", "کت شلوار", "بلیزر", "کت تک", "کت رسمی", "کت اسپرت"]),
    ("set", ["ست لباس", "ست راحتی", "لباس راحتی", "ست ورزشی", "ست تیشرت", "ست هودی", "ست سویشرت", "ست بلوز", "ست شومیز", "ست مانتو", "ست کراپ", "ست تاپ"]),
    ("dress", ["پیراهن مجلسی", "پیراهن زنانه بلند", "لباس مجلسی", "ماکسی", "سارافون", "پیراهن کوتاه زنانه", "پیراهن بلند زنانه", "لباس شب", "پیراهن مجلسی"]),
    ("manto", ["مانتو", "روپوش", "کیمونو"]),
    ("coat", ["پالتو", "ترنچ", "بارانی"]),
    ("jacket", ["کاپشن", "پافر", "بادگیر", "اورکت", "کت جین", "ژیله", "جلیقه", "کت چرم", "کت"]),
    ("hoodie", ["هودی"]),
    ("sweatshirt", ["سویشرت", "سوییشرت", "دورس"]),
    ("knit", ["پلیور", "ژاکت", "بافت", "کاردیگان", "یقه اسکی"]),
    ("polo", ["پولوشرت", "پولو شرت", "پولو"]),
    ("tshirt", ["تیشرت", "تی شرت", "تی‌شرت"]),
    ("top", ["تاپ", "نیم تنه", "کراپ", "بادی"]),
    ("blouse", ["بلوز"]),
    ("shirt", ["پیراهن", "شومیز"]),
    ("skirt", ["دامن"]),
    ("pants", ["شلوار", "لگ", "اسلش", "جاگر", "جین"]),
    ("sandals", ["صندل", "دمپایی"]),
    ("shoes", ["کفش", "کتانی", "کتونی", "اسنیکر", "بوت", "نیم بوت", "کالج", "ونس", "پاشنه", "لوفر", "مخصوص پیاده روی", "مخصوص دویدن"]),
    ("bag", ["کیف", "کوله", "ساک", "چمدان", "کلاچ"]),
    ("belt", ["کمربند"]),
    ("scarf", ["شال", "روسری", "اسکارف", "دستمال گردن", "کراوات", "پاپیون"]),
    ("glasses", ["عینک"]),
    ("watch", ["ساعت مچی", "ساعت"]),
    ("jewelry", ["گردنبند", "دستبند", "گوشواره", "انگشتر", "زیورآلات", "پابند", "سنجاق", "آویز", "رولباسی", "دکمه سردست"]),
    ("hat", ["کلاه", "کپ", "دستکش", "اسکارف گردنی"]),
    ("socks", ["جوراب"]),
    ("wallet", ["کیف پول", "جاکارتی", "جا کارتی", "کیف کارت", "جاسوئیچی", "جا سوئیچی"]),
    ("perfume", ["عطر", "ادکلن", "ادوپرفیوم", "ادو پرفیوم", "بادی اسپلش"]),
    ("umbrella", ["چتر"]),
]
ACCESSORY = {"shoes", "sandals", "bag", "belt", "scarf", "glasses", "watch", "jewelry", "hat", "socks", "wallet", "perfume", "umbrella"}


def guess_type(title, cats=()):
    t = " " + norm(title) + " "
    # کیف پول قبل از کیف؛ کت و شلوار قبل از شلوار و کت
    for key in ("perfume", "wallet", "suit", "shorts", "set", "dress"):
        rule = dict(TYPE_RULES)[key]
        if any(" " + w in t for w in rule):
            return key
    for key, words in TYPE_RULES:
        if any(re.search(r"(^|\s)" + re.escape(w) + r"(\s|ها|های|ی|$)", t) for w in words):
            return key
    c = " ".join(norm(x) for x in cats)
    for key, words in TYPE_RULES:
        if any(w in c for w in words):
            return key
    return None


def guess_gender(*texts):
    t = " ".join(norm(x) for x in texts if x)
    if re.search(r"بچگانه|کودک|نوزاد|پسرانه|دخترانه|نوجوان", t):
        return "K"
    w = re.search(r"زنانه|بانوان|خانم", t)
    m = re.search(r"مردانه|آقایان|آقا", t)
    if w and not m:
        return "W"
    if m and not w:
        return "M"
    return "U"


def group_of(type_):
    return "accessory" if type_ in ACCESSORY else "apparel"


def finalize(item):
    """پر کردن فیلدهای پیش‌فرض و رد کردن چیزهای ناقص"""
    if not item.get("title") or not item.get("img") or not item.get("url") or not item.get("price"):
        return None
    if int(item["price"]) <= 0:
        return None  # قیمت خراب فروشگاه (مثلاً تخفیف بیش از ۱۰۰٪ در بانی‌مد)
    item["title"] = norm(item["title"])
    item.setdefault("brand", "")
    item.setdefault("cat", [])
    item["type"] = item.get("type") or guess_type(item["title"], item["cat"])
    if not item["type"]:
        return None  # چیزی که لباس یا اکسسوری مد نیست (لوازم آرایشی، خانه و…)
    item.setdefault("gender", guess_gender(item["title"], " ".join(item["cat"])))
    item["group"] = group_of(item["type"])
    item.setdefault("color", "")
    item.setdefault("features", {})
    item["price"] = int(item["price"])
    item["basePrice"] = int(item.get("basePrice") or item["price"])
    item["discount"] = max(0, min(95, int(item.get("discount") or (round(100 * (1 - item["price"] / item["basePrice"])) if item["basePrice"] > item["price"] else 0))))
    item.setdefault("sizes", [])
    item.setdefault("orders", 0)
    item.setdefault("style", item["id"])
    item["url"] = unproxy(item["url"])
    item["img"] = unproxy(item["img"])
    if item.get("img2"):
        item["img2"] = unproxy(item["img2"])
    return item


def save(store, items, root=None):
    # STORES_OUT: پوشه‌ی جدا برای خزش دوباره (بعد با merge_stores.py روی قبلی ادغام می‌شود)
    root = root or os.environ.get("STORES_OUT") or os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), "data", "stores")
    os.makedirs(root, exist_ok=True)
    path = os.path.join(root, store + ".json")
    with open(path, "w", encoding="utf-8") as fh:
        json.dump({"store": store, "crawledAt": time.strftime("%Y-%m-%d"), "count": len(items), "items": items}, fh, ensure_ascii=False)
    return path
