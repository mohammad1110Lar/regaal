/*
 * سرور رگال (Regaal) — استایلیست هوشمند مد
 *
 *  - فایل‌های سایت (index.html، assets، data) را سرو می‌کند
 *  - POST /api/auth/otp     : کد ورود ۵ رقمی را به موبایل پیامک می‌کند (کاوه‌نگار)
 *  - POST /api/auth/verify  : کد را بررسی و نشست (کوکی امضاشده) می‌سازد
 *  - POST /api/auth/logout
 *  - POST /api/stylist      : فقط برای کاربر واردشده؛ جمله‌ی کاربر + پاسخ‌های مشاوره + نامزدهای موتور داخلی را
 *                             به Claude می‌دهد و شناسه‌ی محصولات انتخاب‌شده و متن استایلیست را برمی‌گرداند
 *  - GET  /api/health       : وضعیت هوش مصنوعی، ورود و کاربر فعلی
 *  - GET  /api/me           : داده‌های کاربر واردشده (دیده‌شده‌ها و سفارش‌های دوخت)
 *  - POST /api/seen         : محصولاتی که کاربر دیده (تا دفعه‌ی بعد چیز تازه بیاید)
 *  - GET  /api/pins?q=      : نمونه‌های الهام از پینترست برای دوخت سفارشی (server/pins.mjs)
 *  - GET  /api/pinimg?u=    : عکس پینترست از راه سرور (i.pinimg.com در ایران فیلتر است)
 *  - POST /api/orders       : ثبت سفارش دوخت (طرح انتخاب‌شده + اندازه‌ها) → server/data/
 *
 * اجرا:  ANTHROPIC_API_KEY=sk-ant-... KAVENEGAR_API_KEY=... SESSION_SECRET=... npm start
 * بدون کلید Claude، سایت با موتور داخل مرورگر کار می‌کند. بدون کلید پیامک (و خارج از production)
 * کد ورود در پاسخ برگردانده می‌شود تا رابط کاربری آن را مثل یک پیامک آزمایشی نشان دهد.
 */
import crypto from "node:crypto";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Anthropic from "@anthropic-ai/sdk";
import { createPins } from "./pins.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = Number(process.env.PORT) || 8080;
const MODEL = process.env.JW_MODEL || "claude-opus-5-5";
const AI_ENABLED = Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);

const catalog = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "catalog.json"), "utf8"));
const byId = new Map(catalog.items.map((it) => [it.id, it]));
const STORES = catalog.stores || {};

/* ------------------------------------------------------------ پرامپت */

// کاتالوگ چند فروشگاه بزرگ‌تر از آن است که هر بار کامل فرستاده شود؛
// موتور داخلی نامزدها را پیدا می‌کند و Claude از میان آن‌ها (به‌علاوه‌ی اکسسوری‌های پرطرفدار) انتخاب می‌کند
const GENDER = { W: "زنانه", M: "مردانه", K: "بچگانه", U: "یونیسکس" };
function line(it) {
  const f = it.features || {};
  return [it.id, (STORES[it.store] && STORES[it.store].name) || it.store, it.title, GENDER[it.gender], it.group === "accessory" ? "اکسسوری:" + it.type : it.type, it.color,
    f["استایل"], f["جنس پارچه"] || f["جنس"], f["مناسب برای فصول"], f["طرح"], it.price + " تومان", it.discount ? it.discount + "٪ تخفیف" : "",
    it.sizes && it.sizes.length ? "سایز " + it.sizes.join("/") : ""].filter(Boolean).join(" | ");
}
const accessoryPool = {};
for (const it of catalog.items) {
  if (it.group !== "accessory") continue;
  for (const g of it.gender === "U" ? ["W", "M"] : [it.gender]) {
    const key = g + ":" + it.type;
    (accessoryPool[key] = accessoryPool[key] || []).push(it);
  }
}
Object.values(accessoryPool).forEach((list) => list.sort((a, b) => (b.orders || 0) - (a.orders || 0)));
function candidatesText(hints, gender) {
  const ids = new Set((Array.isArray(hints) ? hints : []).filter((id) => byId.has(id)).slice(0, 150));
  const g = ["W", "M"].includes(gender) ? gender : null;
  for (const [key, list] of Object.entries(accessoryPool)) {
    if (g && !key.startsWith(g + ":")) continue;
    list.slice(0, g ? 6 : 3).forEach((it) => ids.add(it.id));
  }
  return [...ids].map((id) => line(byId.get(id))).join("\n");
}

const INSTRUCTIONS = `تو استایلیست «رگال» هستی؛ سرویسی مستقل که در محصولات فروشگاه‌های معتبر پوشاک ایران می‌گردد و برای کاربر استایل کامل می‌چیند. در استایل و عرف ایرانی متخصصی.
کاربر معمولاً یک جمله‌ی کامل و محاوره‌ای می‌نویسد که موقعیتش را توضیح می‌دهد (مثلاً «می‌خوام برم مراسم عزاداری» یا «فردا مصاحبه دارم و یه مانتو ساده می‌خوام که مشکی نباشه»)، نه فقط اسم یک مناسبت یا لباس.
اول جمله را کامل بفهم: موقعیت و مکان، چیزهایی که می‌خواهد، چیزهایی که «نمی‌خواهد» (نباشه، نمی‌خوام، بدون، به جز…)، حس، هوا و بودجه.
تو فقط از محصولات فهرست candidates انتخاب می‌کنی و فقط شناسه‌ی (ستون اول) همان محصولات را برمی‌گردانی؛ هیچ شناسه‌ای نساز.
محصولات از فروشگاه‌های مختلف‌اند (ستون دوم)؛ ترکیب فروشگاه‌ها اشکالی ندارد و حتی بهتر است اگر استایل هماهنگ‌تر شود.

ورودی (JSON):
- query: جمله‌ی کاربر. previous: درخواست قبلی (پیام جدید ممکن است اصلاح همان باشد: «ارزان‌ترش»، «مشکی‌اش»).
- gender: خانم (W) یا آقا (M) اگر مشخص است.
- profile: پاسخ‌های کاربر به سؤال‌های مشاوره. place (مکان: office، uni، party، wedding، family، mourning، pilgrimage، date، travel، sport، casual، home)،
  style (classic، minimal، casual، sport، trendy، street)، likeColors و avoidColors (خانواده‌ی رنگ)، fit (slim، regular، loose)، cover (modest یعنی بلند و پوشیده)،
  height و weight (سانتی‌متر و کیلوگرم)، age، skin (fair، tan، olive)، weather (warm، mild، cold، rain)، budget (بودجه‌ی کل استایل به تومان؛ صفر یعنی مهم نیست).
  هرچه در جمله‌ی کاربر آمده بر profile مقدم است. اگر لباس برای کس دیگری است (هدیه، مامانم، همسرم)، قد و وزن و سلیقه‌ی خود کاربر را اعمال نکن.
- understood: برداشت موتور داخلی از جمله (راهنما است، نه قطعی).
- candidates: نامزدها، هر خط یک محصول (شناسه | فروشگاه | نام | جنسیت | نوع | رنگ | استایل | جنس | فصل | طرح | قیمت | تخفیف | سایزهای موجود).
- اگر profile.acc برابر "without" است، accessories را خالی بگذار و کل بودجه را برای لباس‌ها خرج کن.
- seen: شناسه‌ی محصولاتی که کاربر در درخواست‌های قبلی دیده است. هر بار چیز تازه بیاور: تا جای ممکن این‌ها را دوباره در look و نتیجه‌های اول نگذار.

قواعد انتخاب:
- «نمی‌خوام»ها قطعی‌اند: رنگ، نوع یا جنسی که کاربر رد کرده هرگز در نتایج و استایل نیاید.
- profile.likeColors رنگ محبوب همین درخواست است: اگر کالای آن رنگ در نامزدها هست و با مناسبت جور است، تکه‌ی اول look و چند نتیجه‌ی اول از همان رنگ باشد.
  اگر برای مناسبت مناسب نیست (مثلاً رنگ روشن در مراسم سوگواری یا سفید برای خانم‌ها در عروسی)، استفاده نکن و در message و understood صادقانه بگو چرا.
- سایز: از قد و وزن سایز کاربر را تخمین بزن (خانم‌ها تقریباً: زیر ۵۱ کیلو S، تا ۶۰ M، تا ۶۸ L، تا ۷۷ XL، تا ۸۷ XXL؛ آقایان: زیر ۶۲ S، تا ۷۲ M، تا ۸۲ L، تا ۹۲ XL، تا ۱۰۴ XXL) و فقط لباس‌هایی را بیاور که آن سایز در ستون سایز موجود است.
- بودجه: جمع look و accessories از budget بیشتر نشود؛ اگر نشد، نزدیک‌ترین را بده و صادقانه بگو.
- results: ۶ تا ۱۰ محصول به ترتیب نزدیکی؛ اگر نوع لباس اسم برده شده، اول همان نوع.
- look: استایل کامل ۲ تا ۴ تکه (بالاتنه، پایین‌تنه و در صورت نیاز لایه‌ی رویی). اولین تکه بهترین نتیجه باشد؛ همه هم‌جنسیت.
  برای خانم‌ها بیرون از خانه معمولاً مانتو یا لایه‌ی رویی لازم است، مگر مهمانی، عروسی، خانه یا ورزش.
- accessories: ۳ تا ۶ اکسسوری هم‌جنسیت، از هر نوع یکی (کفش، کیف، کمربند، شال و روسری، عینک، کلاه، ساعت، زیورآلات، جوراب، عطر، چتر).

قواعد استایل ایرانی:
- حداکثر سه رنگ در یک ست و فقط یک رنگ شاخص؛ بقیه خنثی (مشکی، سفید، کرم، طوسی، سرمه‌ای، قهوه‌ای).
- کمربند هم‌رنگ و هم‌تون کفش؛ کیف با کفش یا شال هماهنگ.
- مراسم عزاداری و ختم: فقط مشکی و رنگ‌های خیلی تیره، بدون طرح و براقی، پوشیده؛ زیورآلات و عطر تند نه.
- زیارت و مسجد: پوشیده، ساده و تیره یا خنثی. مصاحبه و اداره: نیمه‌رسمی، ساده، بدون طرح شلوغ؛ مانتو یا پیراهن مرتب.
- دانشگاه: ساده و راحت، مانتو یا لایه‌ی رویی برای خانم‌ها. عروسی: شیک و مجلسی؛ خانم‌ها سفید نپوشند.
- یلدا: قرمز، زرشکی و سبز؛ نوروز: رنگ‌های روشن و تازه. شمال: لایه‌ای و ضدآب با چتر؛ جنوب و کیش: نخی و خنک، عینک و کلاه آفتابی.
- پوست گندمی و سبزه: کرم، قهوه‌ای، زیتونی، زرشکی و سرمه‌ای؛ پوست روشن: سرمه‌ای، زرشکی، صورتی ملایم، طوسی.
- اندام درشت‌تر: راسته و آزاد و تیره‌تر، نه جذب و کراپ؛ قد کوتاه: فاق‌بلند و کوتاه‌تر، نه خیلی بلند. سن بالاتر: کلاسیک‌تر، کمتر کراپ و پاره.

متن‌ها به فارسی روان و کوتاه:
- title: عنوان صفحه، حداکثر ۵ کلمه. line: یک جمله‌ی ادبی و آرام به سبک مجله‌های مد (حداکثر ۱۸ کلمه).
- understood: ۳ تا ۸ برچسب کوتاه از برداشت تو از جمله و پاسخ‌ها (مثل «مراسم سوگواری»، «بدون مشکی»، «سایز L»، «بودجه تا ۲۰ میلیون»).
- message: ۲ تا ۳ جمله؛ چه انتخاب کردی و چرا، با اشاره به پاسخ‌های کاربر.
- notes: برای هر تکه‌ی look و هر اکسسوری یک جمله‌ی کوتاه که چرا این انتخاب (مثل «کمربند مشکی هم‌رنگ کفش»).
- followups: ۳ تا ۴ پیشنهاد کوتاه برای ادامه‌ی گفت‌وگو.
`;

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    title: { type: "string" },
    line: { type: "string" },
    understood: { type: "array", items: { type: "string" } },
    message: { type: "string" },
    results: { type: "array", items: { type: "string" } },
    look: { type: "array", items: { type: "string" } },
    accessories: { type: "array", items: { type: "string" } },
    notes: {
      type: "array",
      items: { type: "object", additionalProperties: false, properties: { id: { type: "string" }, note: { type: "string" } }, required: ["id", "note"] },
    },
    followups: { type: "array", items: { type: "string" } },
  },
  required: ["title", "line", "understood", "message", "results", "look", "accessories", "notes", "followups"],
};

// فقط کلیدهای شناخته‌شده‌ی پروفایل با نوع درست به مدل می‌رسند
const PROFILE_KEYS = { place: "s", style: "a", likeColors: "a", avoidColors: "a", fit: "s", cover: "s", height: "n", weight: "n", age: "n", skin: "s", weather: "s", budget: "n", acc: "s", gender: "s" };
function cleanProfile(p) {
  const out = {};
  if (!p || typeof p !== "object") return out;
  for (const [k, t] of Object.entries(PROFILE_KEYS)) {
    const v = p[k];
    if (t === "s" && typeof v === "string" && /^[a-zA-Z]{1,12}$/.test(v)) out[k] = v;
    if (t === "n" && Number.isFinite(v) && v >= 0 && v < 1e9) out[k] = v;
    if (t === "a" && Array.isArray(v)) out[k] = v.filter((x) => typeof x === "string" && /^[a-z]{1,12}$/.test(x)).slice(0, 13);
  }
  return out;
}

const client = AI_ENABLED ? new Anthropic() : null;

async function stylist({ query, previous, gender, profile, understood, hints, seen }, phone) {
  // دیده‌شده‌ها: آنچه سرور برای این شماره دارد، به‌علاوه‌ی فهرست مرورگر
  const seenIds = [...new Set([...((users[phone] || {}).seen || []).slice(-80).map((x) => x[0]), ...(Array.isArray(seen) ? seen : [])])]
    .filter((id) => typeof id === "string" && byId.has(id)).slice(-120);
  const user = JSON.stringify({
    query: String(query).slice(0, 300),
    previous: previous ? String(previous).slice(0, 300) : null,
    gender: ["W", "M"].includes(gender) ? gender : null,
    profile: cleanProfile(profile),
    understood: Array.isArray(understood) ? understood.filter((x) => typeof x === "string").map((x) => x.slice(0, 60)).slice(0, 16) : [],
    candidates: candidatesText(hints, gender),
    seen: seenIds,
  });
  const response = await client.beta.messages.create({
    model: MODEL,
    max_tokens: 8000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: "low", format: { type: "json_schema", schema: SCHEMA } },
    // دستورالعمل ثابت است و کش می‌شود؛ نامزدها با هر درخواست در پیام کاربر می‌آیند
    system: [{ type: "text", text: INSTRUCTIONS, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: user }],
  });

  if (response.stop_reason === "refusal") {
    const err = new Error("refusal");
    err.status = 422;
    throw err;
  }
  const text = response.content.filter((b) => b.type === "text").map((b) => b.text).join("");
  const data = JSON.parse(text);
  const keep = (ids, group) => [...new Set(ids || [])].filter((id) => byId.has(id) && (!group || byId.get(id).group === group));
  return {
    title: data.title,
    line: data.line,
    understood: (data.understood || []).filter((x) => typeof x === "string").slice(0, 10),
    message: data.message,
    results: keep(data.results).slice(0, 12),
    look: keep(data.look, "apparel").slice(0, 4),
    accessories: keep(data.accessories, "accessory").slice(0, 6),
    notes: (data.notes || []).filter((n) => n && byId.has(n.id) && typeof n.note === "string").map((n) => ({ id: n.id, note: n.note.slice(0, 200) })),
    followups: (data.followups || []).slice(0, 4),
    model: response.model,
  };
}

/* ------------------------------------------------------------ ورود با موبایل و کد */

const PROD = process.env.NODE_ENV === "production";
const SMS_KEY = process.env.KAVENEGAR_API_KEY || "";
const SMS_TEMPLATE = process.env.KAVENEGAR_TEMPLATE || "verify";
const SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString("hex");
if (!process.env.SESSION_SECRET) console.warn("SESSION_SECRET تنظیم نشده؛ با هر بار اجرای سرور، کاربران دوباره باید وارد شوند.");
const otps = new Map(); // phone → { hash, exp, tries, sentAt }

const normPhone = (v) => {
  let p = String(v || "").replace(/[۰-۹]/g, (d) => "۰۱۲۳۴۵۶۷۸۹".indexOf(d)).replace(/[^\d+]/g, "");
  if (p.startsWith("+98")) p = "0" + p.slice(3);
  else if (p.startsWith("0098")) p = "0" + p.slice(4);
  else if (p.startsWith("98") && p.length === 12) p = "0" + p.slice(2);
  return /^09\d{9}$/.test(p) ? p : null;
};
const sha = (s) => crypto.createHmac("sha256", SECRET).update(s).digest("base64url");
const sign = (phone, exp) => `${phone}.${exp}.${sha(phone + "." + exp)}`;
function sessionUser(req) {
  const m = /(?:^|;\s*)rg_session=([^;]+)/.exec(req.headers.cookie || "");
  if (!m) return null;
  const [phone, exp, sig] = decodeURIComponent(m[1]).split(".");
  if (!phone || !exp || !sig || Number(exp) < Date.now()) return null;
  const ok = sig.length === sha(phone + "." + exp).length && crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(sha(phone + "." + exp)));
  return ok ? { phone } : null;
}
async function sendSms(phone, code) {
  const url = `https://api.kavenegar.com/v1/${encodeURIComponent(SMS_KEY)}/verify/lookup.json?receptor=${phone}&token=${code}&template=${encodeURIComponent(SMS_TEMPLATE)}`;
  const r = await fetch(url);
  if (!r.ok) throw Object.assign(new Error("ارسال پیامک ممکن نشد؛ کمی بعد دوباره امتحان کنید."), { status: 502 });
}

async function authOtp(req, res) {
  const body = JSON.parse(await readBody(req, 2_000));
  const phone = normPhone(body.phone);
  if (!phone) return send(res, 400, { error: "bad phone", message: "شماره‌ی موبایل درست نیست." });
  const prev = otps.get(phone);
  if (prev && Date.now() - prev.sentAt < 60_000) return send(res, 429, { error: "wait", message: "یک دقیقه صبر کنید و دوباره امتحان کنید." });
  if (!SMS_KEY && PROD) return send(res, 503, { error: "sms disabled", message: "ورود موقتاً در دسترس نیست." });
  const code = String(crypto.randomInt(10000, 100000));
  otps.set(phone, { hash: sha(phone + ":" + code), exp: Date.now() + 120_000, tries: 0, sentAt: Date.now() });
  if (SMS_KEY) await sendSms(phone, code);
  // بدون سرویس پیامک (فقط محیط توسعه): کد برگردانده می‌شود تا در رابط کاربری نشان داده شود
  return send(res, 200, { ok: true, wait: 120, ...(SMS_KEY ? {} : { devCode: code }) });
}
async function authVerify(req, res) {
  const body = JSON.parse(await readBody(req, 2_000));
  const phone = normPhone(body.phone);
  const entry = phone && otps.get(phone);
  if (!entry || entry.exp < Date.now()) return send(res, 400, { error: "expired", message: "کد منقضی شده؛ دوباره کد بگیرید." });
  if (++entry.tries > 5) { otps.delete(phone); return send(res, 429, { error: "too many", message: "تلاش‌ها زیاد شد؛ دوباره کد بگیرید." }); }
  if (sha(phone + ":" + String(body.code || "").replace(/[۰-۹]/g, (d) => "۰۱۲۳۴۵۶۷۸۹".indexOf(d))) !== entry.hash) {
    return send(res, 401, { error: "wrong code", message: "کد درست نیست؛ دوباره امتحان کنید." });
  }
  otps.delete(phone);
  const exp = Date.now() + 30 * 24 * 3600_000;
  res.setHeader("Set-Cookie", `rg_session=${encodeURIComponent(sign(phone, exp))}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${30 * 24 * 3600}${PROD ? "; Secure" : ""}`);
  return send(res, 200, { ok: true, user: { phone } });
}

/* ------------------------------------------------------------ داده‌ی کاربران (به شماره‌ی موبایل) */

// یک فایل JSON ساده: { "0912…": { seen: [[id, n], …], orders: [ … ] } }
// پوشه‌ی server/ سرو نمی‌شود، پس این فایل از بیرون خواندنی نیست.
const DB_DIR = path.join(ROOT, "server", "data");
const USERS_FILE = path.join(DB_DIR, "users.json");
const SEEN_MAX = 1500;
let users = {};
try { users = JSON.parse(fs.readFileSync(USERS_FILE, "utf8")); } catch { users = {}; }
let saveT = null;
function saveUsers() {
  clearTimeout(saveT);
  saveT = setTimeout(() => {
    fs.mkdirSync(DB_DIR, { recursive: true });
    const tmp = USERS_FILE + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(users));
    fs.renameSync(tmp, USERS_FILE); // نوشتن کامل یا هیچ؛ فایل نیمه‌کاره نمی‌ماند
  }, 300);
}
const userRec = (phone) => (users[phone] = users[phone] || { seen: [], orders: [] });

function addSeen(phone, ids) {
  const rec = userRec(phone);
  const m = new Map(rec.seen);
  for (const id of ids) {
    if (typeof id !== "string" || !byId.has(id)) continue;
    const n = Math.min(9, (m.get(id) || 0) + 1);
    m.delete(id); // ترتیب = تازگی
    m.set(id, n);
  }
  rec.seen = [...m].slice(-SEEN_MAX);
  saveUsers();
}

/* ------------------------------------------------------------ دوخت سفارشی */

const pins = createPins(DB_DIR);
const ORDERS_LOG = path.join(DB_DIR, "orders.jsonl"); // هر خط یک سفارش؛ برای کارگاه خیاطی
const MEASURES = ["height", "weight", "shoulder", "chest", "waist", "hip", "sleeve", "arm", "wrist", "neck", "length", "torso", "rise", "pants", "thigh", "hem"];
const str = (v, n) => String(v == null ? "" : v).replace(/[\u0000-\u001f]/g, " ").trim().slice(0, n);

function cleanOrder(b) {
  const d = b.design || {};
  const pinUrl = (u) => (/^https:\/\/i\.pinimg\.com\//.test(String(u || "")) ? String(u).slice(0, 300) : null);
  const order = {
    request: str(b.request, 400),
    design: { id: str(d.id, 64), title: str(d.title, 160), img: pinUrl(d.img), big: pinUrl(d.big), query: str(d.query, 160), source: /^https?:\/\//.test(String(d.source || "")) ? str(d.source, 300) : null },
    designer: !!b.designer,
    measures: {},
    fabric: str(b.fabric, 80), color: str(b.color, 60), deliver: str(b.deliver, 40), notes: str(b.notes, 1000),
    budget: Number.isFinite(+b.budget) && +b.budget >= 0 && +b.budget < 1e10 ? Math.round(+b.budget) : 0,
  };
  for (const k of MEASURES) {
    const v = +((b.measures || {})[k]);
    if (Number.isFinite(v) && v > 0 && v < 300) order.measures[k] = Math.round(v * 10) / 10;
  }
  if (!order.request && !order.design.img) throw Object.assign(new Error("طرح یا توضیح لباس لازم است."), { status: 400 });
  if (!order.measures.height || !order.measures.weight) throw Object.assign(new Error("قد و وزن لازم است."), { status: 400 });
  return order;
}

function addOrder(phone, body) {
  const o = cleanOrder(body);
  const now = new Date();
  o.id = "RG-" + now.toISOString().slice(2, 10).replace(/-/g, "") + "-" + crypto.randomInt(1000, 10000);
  o.status = "received";
  o.createdAt = now.toISOString();
  const rec = userRec(phone);
  rec.orders = [o].concat(rec.orders || []).slice(0, 100);
  saveUsers();
  fs.mkdirSync(DB_DIR, { recursive: true });
  fs.appendFileSync(ORDERS_LOG, JSON.stringify(Object.assign({ phone }, o)) + "\n");
  return o;
}

/* ------------------------------------------------------------ HTTP */

const MIME = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8", ".svg": "image/svg+xml", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
  ".png": "image/png", ".webp": "image/webp", ".ico": "image/x-icon", ".woff2": "font/woff2",
};

function send(res, status, body, type = "application/json; charset=utf-8") {
  res.writeHead(status, { "Content-Type": type, "Cache-Control": "no-store" });
  res.end(typeof body === "string" || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}

// محدودیت ساده: هر IP حداکثر ۲۰ درخواست هوش مصنوعی در دقیقه
const hits = new Map();
function limited(ip) {
  const now = Date.now();
  const list = (hits.get(ip) || []).filter((t) => now - t < 60_000);
  list.push(now);
  hits.set(ip, list);
  return list.length > 20;
}

function readBody(req, max = 12_000) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (c) => {
      size += c.length;
      if (size > max) { reject(Object.assign(new Error("too large"), { status: 413 })); req.destroy(); return; }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function serveStatic(req, res, pathname) {
  let rel = decodeURIComponent(pathname);
  if (rel === "/" || rel === "/ai" || rel === "/ai/") rel = "/index.html";
  const file = path.resolve(ROOT, "." + rel);
  if (!file.startsWith(ROOT + path.sep) || /[\\/]\.|node_modules|[\\/]server[\\/]|[\\/]scripts[\\/]/.test(file.slice(ROOT.length))) {
    return send(res, 404, "Not found", "text/plain; charset=utf-8");
  }
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) return send(res, 404, "Not found", "text/plain; charset=utf-8");
    res.writeHead(200, {
      "Content-Type": MIME[path.extname(file).toLowerCase()] || "application/octet-stream",
      "Cache-Control": /\/assets\/img\//.test(file) ? "public, max-age=86400" : "no-cache",
    });
    fs.createReadStream(file).pipe(res);
  });
}

const server = http.createServer(async (req, res) => {
  const { pathname } = new URL(req.url, "http://localhost");

  if (pathname.endsWith("/api/health")) {
    return send(res, 200, { ok: true, ai: AI_ENABLED, auth: true, user: sessionUser(req), model: AI_ENABLED ? MODEL : null, products: catalog.items.length });
  }

  if (pathname.endsWith("/api/pins")) {
    const q = new URL(req.url, "http://localhost").searchParams.get("q") || "";
    if (!q.trim()) return send(res, 400, { error: "q required" });
    if (limited(req.socket.remoteAddress)) return send(res, 429, { error: "too many requests" });
    try {
      const items = await pins.searchPins(q);
      // عکس‌ها از راه همین سرور، چون i.pinimg.com در ایران باز نمی‌شود
      const via = (u) => "api/pinimg?u=" + encodeURIComponent(u);
      return send(res, 200, { query: q, items: items.map((p) => Object.assign({}, p, { thumb: via(p.img), large: via(p.big) })) });
    } catch (e) {
      console.error("Pinterest:", e.message);
      return send(res, 502, { error: "pinterest unavailable" });
    }
  }

  if (pathname.endsWith("/api/pinimg")) {
    const u = new URL(req.url, "http://localhost").searchParams.get("u") || "";
    try {
      const im = await pins.pinImage(u);
      if (!im) return send(res, 404, "Not found", "text/plain; charset=utf-8");
      res.writeHead(200, { "Content-Type": MIME[im.ext], "Cache-Control": "public, max-age=604800" });
      return res.end(im.body);
    } catch (e) {
      return send(res, 502, "Bad gateway", "text/plain; charset=utf-8");
    }
  }

  if (pathname.endsWith("/api/orders")) {
    const u = sessionUser(req);
    if (!u) return send(res, 401, { error: "login required", message: "برای ثبت سفارش اول وارد شوید." });
    if (req.method === "GET") return send(res, 200, { orders: (users[u.phone] || {}).orders || [] });
    if (req.method !== "POST") return send(res, 405, { error: "method not allowed" });
    try {
      return send(res, 200, { ok: true, order: addOrder(u.phone, JSON.parse(await readBody(req, 20_000))) });
    } catch (e) {
      if (e instanceof SyntaxError) return send(res, 400, { error: "bad json" });
      return send(res, e.status || 500, { error: "order", message: e.status ? e.message : "خطای سرور؛ دوباره امتحان کنید." });
    }
  }

  if (pathname.endsWith("/api/me")) {
    const u = sessionUser(req);
    if (!u) return send(res, 401, { error: "login required" });
    const rec = users[u.phone] || { seen: [], orders: [] };
    return send(res, 200, { user: u, seen: rec.seen, orders: rec.orders });
  }

  if (pathname.endsWith("/api/seen")) {
    if (req.method !== "POST") return send(res, 405, { error: "method not allowed" });
    const u = sessionUser(req);
    if (!u) return send(res, 401, { error: "login required" });
    try {
      const body = JSON.parse(await readBody(req, 40_000));
      addSeen(u.phone, Array.isArray(body.ids) ? body.ids.slice(0, 400) : []);
      return send(res, 200, { ok: true });
    } catch (e) {
      return send(res, e.status || 400, { error: "bad request" });
    }
  }

  if (pathname.includes("/api/auth/")) {
    if (req.method !== "POST") return send(res, 405, { error: "method not allowed" });
    if (limited(req.socket.remoteAddress)) return send(res, 429, { error: "too many requests", message: "درخواست‌ها زیاد است؛ کمی صبر کنید." });
    try {
      if (pathname.endsWith("/api/auth/otp")) return await authOtp(req, res);
      if (pathname.endsWith("/api/auth/verify")) return await authVerify(req, res);
      if (pathname.endsWith("/api/auth/logout")) {
        res.setHeader("Set-Cookie", "rg_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0");
        return send(res, 200, { ok: true });
      }
      return send(res, 404, { error: "not found" });
    } catch (e) {
      if (e instanceof SyntaxError) return send(res, 400, { error: "bad json" });
      if (e.status) return send(res, e.status, { error: "auth", message: e.message });
      console.error(e);
      return send(res, 500, { error: "internal", message: "خطای سرور؛ دوباره امتحان کنید." });
    }
  }

  if (pathname.endsWith("/api/stylist")) {
    if (req.method !== "POST") return send(res, 405, { error: "method not allowed" });
    if (!AI_ENABLED) return send(res, 503, { error: "ai disabled" });
    if (!sessionUser(req)) return send(res, 401, { error: "login required" });
    if (limited(req.socket.remoteAddress)) return send(res, 429, { error: "too many requests" });
    try {
      const body = JSON.parse(await readBody(req));
      if (!body.query || typeof body.query !== "string") return send(res, 400, { error: "query required" });
      return send(res, 200, await stylist(body, sessionUser(req).phone));
    } catch (e) {
      if (e instanceof Anthropic.RateLimitError) return send(res, 429, { error: "rate limited" });
      if (e instanceof Anthropic.AuthenticationError) { console.error("کلید API نامعتبر است"); return send(res, 503, { error: "ai unavailable" }); }
      if (e instanceof Anthropic.APIConnectionError) return send(res, 502, { error: "ai unreachable" });
      if (e instanceof Anthropic.APIError) { console.error("Claude API:", e.status, e.message); return send(res, 502, { error: "ai error" }); }
      if (e instanceof SyntaxError) return send(res, 400, { error: "bad json" });
      if (e.status) return send(res, e.status, { error: e.message });
      console.error(e);
      return send(res, 500, { error: "internal" });
    }
  }

  if (req.method !== "GET" && req.method !== "HEAD") return send(res, 405, { error: "method not allowed" });
  serveStatic(req, res, pathname);
});

server.listen(PORT, () => {
  console.log(`رگال: http://localhost:${PORT}`);
  console.log(SMS_KEY ? "ورود: پیامک با کاوه‌نگار" : "ورود: بدون سرویس پیامک — کد در رابط کاربری نشان داده می‌شود (فقط برای توسعه)");
  console.log(AI_ENABLED ? `هوش مصنوعی: فعال (${MODEL}) · ${catalog.items.length} محصول` : "هوش مصنوعی: غیرفعال (ANTHROPIC_API_KEY تنظیم نشده) — موتور داخل مرورگر استفاده می‌شود");
});
