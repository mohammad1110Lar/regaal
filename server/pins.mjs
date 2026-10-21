/*
 * نمونه‌های الهام برای «دوخت سفارشی» از پینترست
 *
 *  searchPins(q)   جست‌وجوی داخلی سایت پینترست (BaseSearchResource)؛ q انگلیسی است (engine.js ترجمه می‌کند)
 *  pinImage(url)   عکس از i.pinimg.com؛ پینترست در ایران فیلتر است، پس سرور (بیرون ایران یا با دسترسی) واسطه می‌شود
 *
 * این راه رسمی نیست و برای نمایش نمونه (prototype) است؛ برای راه‌اندازی عمومی باید API رسمی پینترست
 * (دسترسی partner) یا منبع مجاز دیگری جایگزین شود. نتیجه‌ها و عکس‌ها روی دیسک کش می‌شوند تا درخواست کم بماند.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141 Safari/537.36";
const HOST = "https://www.pinterest.com";
const DAY = 24 * 3600_000;

export function createPins(dataDir) {
  const cacheFile = path.join(dataDir, "pins-cache.json");
  const imgDir = path.join(dataDir, "pinimg");
  let cache = {};
  try { cache = JSON.parse(fs.readFileSync(cacheFile, "utf8")); } catch { cache = {}; }
  let saveT = null;
  const saveCache = () => {
    clearTimeout(saveT);
    saveT = setTimeout(() => {
      fs.mkdirSync(dataDir, { recursive: true });
      fs.writeFileSync(cacheFile + ".tmp", JSON.stringify(cache));
      fs.renameSync(cacheFile + ".tmp", cacheFile);
    }, 500);
  };

  // نشست مهمان پینترست (کوکی csrftoken و _pinterest_sess) با بازکردن صفحه‌ی جست‌وجو؛ نیم ساعت نگه داشته می‌شود
  let session = null;
  async function getSession(src) {
    if (session && Date.now() - session.at < 30 * 60_000) return session;
    const r = await fetch(HOST + src, { headers: { "User-Agent": UA, Accept: "text/html", "Accept-Language": "en-US,en;q=0.9" } });
    const cookies = (r.headers.getSetCookie ? r.headers.getSetCookie() : [r.headers.get("set-cookie") || ""]).map((c) => c.split(";")[0]).filter(Boolean);
    await r.arrayBuffer();
    const csrf = (cookies.find((c) => c.startsWith("csrftoken=")) || "").slice(10);
    session = { cookie: cookies.join("; "), csrf, at: Date.now() };
    return session;
  }

  const clean = (s) => String(s || "").replace(/\s+/g, " ").trim().slice(0, 140);
  function toPin(r) {
    const im = r && r.images;
    if (!im || r.type !== "pin" || r.is_promoted) return null;
    const small = im["474x"] || im["236x"], big = im["736x"] || im.orig || small;
    if (!small || !/^https:\/\/i\.pinimg\.com\//.test(small.url)) return null;
    return {
      id: r.image_signature || crypto.createHash("sha1").update(small.url).digest("hex").slice(0, 32),
      title: clean(r.grid_title || r.title || r.seo_alt_text || r.description),
      img: small.url, big: big.url, w: small.width, h: small.height, color: r.dominant_color || null,
      source: r.link && /^https?:\/\//.test(r.link) ? r.link : null,
    };
  }

  async function searchPins(q) {
    q = clean(q).toLowerCase();
    if (!q) return [];
    const hit = cache[q];
    if (hit && Date.now() - hit.at < 3 * DAY) return hit.items;
    const src = "/search/pins/?q=" + encodeURIComponent(q) + "&rs=typed";
    const s = await getSession(src);
    const data = JSON.stringify({ options: { query: q, scope: "pins", rs: "typed", redux_normalize_feed: true }, context: {} });
    const url = HOST + "/resource/BaseSearchResource/get/?source_url=" + encodeURIComponent(src) + "&data=" + encodeURIComponent(data);
    const r = await fetch(url, {
      headers: {
        "User-Agent": UA, Accept: "application/json, text/javascript, */*, q=0.01", "Accept-Language": "en-US,en;q=0.9",
        "X-Requested-With": "XMLHttpRequest", "X-Pinterest-AppState": "active", "X-Pinterest-Source-Url": src,
        "X-Pinterest-PWS-Handler": "www/search/[scope].js", Referer: HOST + src, Cookie: s.cookie, ...(s.csrf ? { "X-CSRFToken": s.csrf } : {}),
      },
    });
    if (!r.ok) { session = null; throw Object.assign(new Error("pinterest " + r.status), { status: 502 }); }
    const j = await r.json();
    const res = (j.resource_response && j.resource_response.data) || {};
    const items = (Array.isArray(res) ? res : res.results || []).map(toPin).filter(Boolean).slice(0, 24);
    cache[q] = { at: Date.now(), items };
    saveCache();
    return items;
  }

  // فقط عکس‌های i.pinimg.com؛ هر عکس یک بار دانلود و روی دیسک نگه داشته می‌شود
  async function pinImage(u) {
    let url;
    try { url = new URL(u); } catch { return null; }
    if (url.protocol !== "https:" || url.hostname !== "i.pinimg.com" || !/^\/(170x|236x|474x|736x|originals)\//.test(url.pathname)) return null;
    const ext = /\.png$/i.test(url.pathname) ? ".png" : /\.webp$/i.test(url.pathname) ? ".webp" : ".jpg";
    const file = path.join(imgDir, crypto.createHash("sha1").update(url.href).digest("hex") + ext);
    try { return { body: fs.readFileSync(file), ext }; } catch { /* هنوز دانلود نشده */ }
    const r = await fetch(url.href, { headers: { "User-Agent": UA, Referer: HOST + "/" } });
    if (!r.ok || !/^image\//.test(r.headers.get("content-type") || "")) return null;
    const body = Buffer.from(await r.arrayBuffer());
    if (body.length > 6e6) return null;
    fs.mkdirSync(imgDir, { recursive: true });
    fs.writeFileSync(file, body);
    return { body, ext };
  }

  return { searchPins, pinImage };
}
