/*
 * رگال (Regaal) — کنترل رابط کاربری
 * حالت‌ها: is-home → is-consult (ورود + سؤال‌ها) → is-thinking → is-results
 */
(function () {
  "use strict";

  const E = window.JWEngine;

  // نام و متن‌های سایت؛ برای تغییر نام فقط همین‌جا را عوض کنید
  const SITE = {
    name: "Regaal",
    fa: "رگال",
    domain: "regaal.ir",
    legal: "© ۱۴۰۵ رگال",
  };
  const $ = (s, el) => (el || document).querySelector(s);
  const $$ = (s, el) => Array.from((el || document).querySelectorAll(s));
  const body = document.body;
  const escapeHtml = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

  const store = {
    get(k, d) { try { const v = localStorage.getItem("jw-ai:" + k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem("jw-ai:" + k, JSON.stringify(v)); } catch (e) { /* حالت خصوصی مرورگر */ } },
  };

  const state = {
    total: E.load(window.JW_CATALOG),
    prevIntent: null,
    basePrev: null,
    last: null,
    lastQuery: null,
    drops: [],
    gender: store.get("gender", ""),
    ai: false,
    busy: false,
    history: store.get("history", []),
    wish: new Set(store.get("wish", [])),
    orders: store.get("orders", []),                // سفارش‌های دوخت (با سرور از api/me به‌روز می‌شود)
    story: [],
    rest: [],
    profile: store.get("profile", { done: [] }), // مشخصات استایل خود کاربر (سبک، سایز، سن…) و رنگ‌های دفعه‌ی قبل
    req: {},                                     // پاسخ‌های مخصوص همین درخواست (مکان، رنگ، هوا، بودجه)
    sid: null,                                   // شناسه‌ی صفحه‌ی نتیجه‌ی فعلی (برای برگشت با دکمه‌ی Back)
  };

  // محصولاتی که کاربر دیده؛ موتور دفعه‌ی بعد سراغ چیزهای تازه می‌رود.
  // در مرورگر نگه داشته می‌شود و برای کاربر واردشده روی سرور هم (به شماره‌ی موبایل)
  E.setSeen(store.get("seen", []));
  try { localStorage.removeItem("jw-ai:bag"); } catch (e) { /* سبد خرید حذف شده است */ }
  function seen(ids) {
    ids = [...new Set(ids.filter(Boolean))];
    if (!ids.length) return;
    E.markSeen(ids);
    store.set("seen", E.seenList());
    if (auth.server && auth.user) fetch("api/seen", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids }), credentials: "same-origin" }).catch(() => {});
  }
  const seenOf = (res) => (res.story || []).map((s) => s.item.id).concat((res.results || []).slice(0, 6).map((x) => x.id), (res.accessories || []).map((x) => x.id));

  /* ============================================================ تصاویر و کارت */

  // عکس با چند اندازه (srcset): مرورگر نسخه‌ای را برمی‌دارد که به پهنای قاب و تراکم صفحه بخورد.
  // sizes پهنای تقریبی قاب است؛ قاب‌های کوچک (دیوار، تخته، فهرست‌ها) نسخه‌ی سبک می‌گیرند و قاب‌های بزرگ نسخه‌ی اصلی.
  const SIZES = { card: "(max-width: 640px) 50vw, 25vw", bento: "(max-width: 640px) 60vw, (max-width: 1000px) 40vw, 36vw", thumb: "120px" };
  function img(it, cls, alt, sizes, src) {
    const u = src || it._img, set = E.imgSrcset(u);
    return `<img src="${escapeHtml(E.imgUrl(u, 800))}"${set ? ` srcset="${escapeHtml(set)}" sizes="${sizes || SIZES.card}" data-raw="${escapeHtml(u)}"` : ""} alt="${escapeHtml(alt == null ? it.title : alt)}" loading="lazy" decoding="async"${cls ? ` class="${cls}"` : ""}>`;
  }
  const DPR = Math.min(2, window.devicePixelRatio || 1);
  // اگر عکس فروشگاه باز نشد، کارت با رنگ ملایم و نام محصول می‌ماند
  // اگر نسخه‌ی بزرگ‌تر در فروشگاه نبود، همان نشانی کاتالوگ امتحان می‌شود
  document.addEventListener("error", (e) => {
    const t = e.target;
    if (t.tagName !== "IMG") return;
    if (t.dataset.raw && !t.dataset.retried && t.src !== t.dataset.raw) { t.dataset.retried = "1"; t.removeAttribute("srcset"); t.src = t.dataset.raw; return; }
    if (t.parentElement) t.parentElement.classList.add("is-broken");
  }, true);
  const storeOf = (it) => E.storeName(it.store);

  const price = (it) => E.fmtPrice(it.price);
  const heartSvg = '<svg viewBox="0 0 24 24" class="ico"><path d="M12 20s-7.5-4.6-7.5-10.2A4.3 4.3 0 0 1 12 7.2a4.3 4.3 0 0 1 7.5 2.6C19.5 15.4 12 20 12 20Z"/></svg>';
  const sparkSvg = '<svg viewBox="0 0 24 24" class="ico"><path d="M12 3.5 13.6 9l5.4 1.6-5.4 1.6L12 17.7l-1.6-5.5L5 10.6 10.4 9z"/><path d="M18.5 15.5l.7 2 2 .7-2 .7-.7 2-.7-2-2-.7 2-.7z"/></svg>';

  function heart(it) {
    const on = state.wish.has(it.id);
    return `<button type="button" class="heart" data-wish="${escapeHtml(it.id)}" aria-pressed="${on}" aria-label="${on ? "حذف از" : "افزودن به"} علاقه‌مندی‌ها">${heartSvg}</button>`;
  }

  function card(it, opts) {
    opts = opts || {};
    const under = opts.under ? `<div class="under"><span class="under__name">${escapeHtml(it.title)}</span><span class="under__price">${escapeHtml(storeOf(it))} · ${price(it)}</span></div>` : "";
    const second = opts.hover && it._img2 && it._img2 !== it._img ? img(it, "", "", opts.sizes, it._img2) : "";
    return `<article class="card reveal" style="--d:${(opts.i || 0) * 80}ms">
      <button type="button" class="card__img" data-open-item="${escapeHtml(it.id)}" aria-label="${escapeHtml(it.title + "، " + storeOf(it) + "، " + price(it))}">${img(it, "", null, opts.sizes)}${second}</button>
      ${heart(it)}
      <div class="card__cap" aria-hidden="true"><span class="card__name">${escapeHtml(it.title)}</span><span class="card__price">${escapeHtml(storeOf(it))} · ${price(it)}</span></div>
      ${under}
    </article>`;
  }

  /* ============================================================ صفحه‌ی اول: دیوار محصولات */

  // دیوار بی‌انتها از همه‌ی محصولات: می‌شود کشیدش، با چرخ ماوس جابه‌جایش کرد، و با نوشتن در نوار فیلتر می‌شود.
  // فقط کاشی‌های داخل صفحه ساخته می‌شوند و هنگام حرکت دوباره استفاده می‌شوند.
  const wall = (function () {
    const root = $("[data-wall]"), layer = $(".wall__layer", root);
    let tiles = [], list = [], cols = 0, rows = 0, TW = 140, TH = 185, GAP = 12;
    let ox = 0, oy = 0, vx = 0, vy = 0, mx = -9999, my = -9999, raf = 0, running = false;
    let drag = null, dragged = false, filterKey = "", baseList = [];
    const DRIFT_X = reduceMotion ? 0 : 0.22, DRIFT_Y = reduceMotion ? 0 : 0.1;

    // عدد ثابت و پراکنده برای هر خانه، تا کنار هم تکراری نیفتند
    const hash = (c, r) => { let h = (c * 374761393 + r * 668265263) | 0; h = (h ^ (h >>> 13)) * 1274126177 | 0; return (h ^ (h >>> 16)) >>> 0; };
    const itemAt = (c, r) => list[hash(c, r) % list.length];

    function measure() {
      TW = Math.round(Math.min(156, Math.max(104, innerWidth * 0.088)));
      TH = Math.round(TW * 1.32);
      GAP = Math.round(TW * 0.085);
      cols = Math.ceil(innerWidth / (TW + GAP)) + 2;
      rows = Math.ceil(innerHeight / (TH + GAP)) + 2;
      const need = cols * rows;
      while (tiles.length < need) {
        const el = document.createElement("button");
        el.type = "button";
        el.className = "tile";
        el.innerHTML = `<img alt="" decoding="async"><span class="tile__cap"><span class="tile__name"></span><span class="tile__meta"></span></span>`;
        layer.appendChild(el);
        tiles.push({ el, img: el.firstChild, name: $(".tile__name", el), meta: $(".tile__meta", el), key: "" });
      }
      tiles.forEach((t, i) => { t.el.hidden = i >= need; t.el.style.width = TW + "px"; t.el.style.height = TH + "px"; });
    }

    function paint() {
      if (!list.length) return;
      const cw = TW + GAP, ch = TH + GAP;
      const c0 = Math.floor(-ox / cw) - 1, r0 = Math.floor(-oy / ch) - 1;
      for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) {
        const t = tiles[i * rows + j];
        if (!t) continue;
        const c = c0 + i, r = r0 + j;
        const stagger = ((c % 2) + 2) % 2 ? TH * 0.42 : 0;
        const x = c * cw + ox, y = r * ch + oy + stagger;
        const key = c + "," + r;
        if (t.key !== key) {
          const it = itemAt(c, r);
          t.key = key;
          t.el.dataset.openItem = it.id;
          t.el.setAttribute("aria-label", it.title + "، " + E.storeName(it.store));
          // کاشی تا وقتی عکسش برسد کم‌رنگ است؛ بعد آرام روشن می‌شود
          t.el.classList.remove("is-in");
          t.img.onload = () => t.el.classList.add("is-in");
          t.img.dataset.raw = it._img; delete t.img.dataset.retried;
          t.img.src = E.imgUrl(it._img, Math.round(TH * DPR));
          if (t.img.complete && t.img.naturalWidth) t.el.classList.add("is-in");
          t.name.textContent = it.title;
          t.meta.textContent = E.storeName(it.store) + " · " + E.fmtPrice(it.price);
        }
        // ذره‌بین: کاشی‌های نزدیک ماوس کمی بزرگ‌تر
        const dx = x + TW / 2 - mx, dy = y + TH / 2 - my;
        const d = Math.sqrt(dx * dx + dy * dy);
        const k = Math.max(0, 1 - d / 300);
        const s = 1 + 0.14 * k * k * (3 - 2 * k);
        t.el.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0) scale(${s.toFixed(3)})`;
        t.el.style.zIndex = s > 1.01 ? Math.round(s * 100) : "";
      }
    }

    function loop() {
      raf = 0;
      if (!running) return;
      if (!drag) {
        // اینرسی بعد از کشیدن، بعد حرکت آرام همیشگی
        vx *= 0.94; vy *= 0.94;
        ox += vx + DRIFT_X; oy += vy + DRIFT_Y;
      }
      paint();
      raf = requestAnimationFrame(loop);
    }
    const play = () => { running = true; if (!raf) raf = requestAnimationFrame(loop); };
    const pause = () => { running = false; if (raf) cancelAnimationFrame(raf); raf = 0; };

    root.addEventListener("pointerdown", (e) => {
      if (!body.classList.contains("is-home") || e.button !== 0) return;
      drag = { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, t: performance.now() };
      dragged = false;
      vx = vy = 0;
    });
    window.addEventListener("pointermove", (e) => {
      mx = e.clientX; my = e.clientY;
      if (!drag) return;
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      if (!dragged && Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) > 6) { dragged = true; root.classList.add("is-dragging"); }
      if (!dragged) return;
      const now = performance.now(), dt = Math.max(8, now - drag.t);
      ox += dx; oy += dy;
      vx = (dx / dt) * 16; vy = (dy / dt) * 16;
      drag.x = e.clientX; drag.y = e.clientY; drag.t = now;
    });
    window.addEventListener("pointerup", () => { if (drag) { drag = null; root.classList.remove("is-dragging"); } });
    root.addEventListener("pointerleave", () => { mx = my = -9999; });
    // بعد از کشیدن، کلیک باز نکند
    root.addEventListener("click", (e) => { if (dragged) { e.stopPropagation(); e.preventDefault(); dragged = false; } }, true);
    window.addEventListener("wheel", (e) => {
      if (!body.classList.contains("is-home") || e.target.closest(".prompt-wrap, .drawer, .pdp")) return;
      vx -= e.deltaX * 0.12; vy -= e.deltaY * 0.12;
    }, { passive: true });
    window.addEventListener("resize", () => { measure(); tiles.forEach((t) => (t.key = "")); paint(); });

    // فهرست دیوار: لباس و اکسسوری بزرگسال؛ با کلید خانم/آقا محدود می‌شود
    function baseFor(g) {
      return E.all().filter((x) => x.gender !== "K" && !x._minor && (!g || x.gender === g || x.gender === "U"));
    }
    async function setList(next, key) {
      if (key === filterKey && list.length) return;
      filterKey = key;
      if (!next.length) return;
      root.classList.add("is-swapping");
      await sleep(list.length && !reduceMotion ? 260 : 0);
      list = next;
      tiles.forEach((t) => (t.key = ""));
      paint();
      requestAnimationFrame(() => root.classList.remove("is-swapping"));
    }
    function setGender(g) {
      baseList = baseFor(g);
      setList(baseList, "g:" + g);
    }
    // پیش‌نمایش زنده: با نوشتن، دیوار پر از لباس‌های مرتبط می‌شود
    function preview(text, g) {
      const found = text && text.trim().length > 1 ? E.preview(text, g) : null;
      if (found && found.length >= 6) { setList(found, "q:" + text.trim()); return found.length; }
      setList(baseList, "g:" + g);
      return null;
    }
    function init(g) {
      measure();
      baseList = baseFor(g);
      list = baseList;
      filterKey = "g:" + g;
      ox = -Math.random() * 4000; oy = -Math.random() * 3000;
      paint();
      play();
    }
    return { init, play, pause, setGender, preview, count: () => list.length, baseCount: () => baseList.length };
  })();

  /* ============================================================ نوار پرامپت و جنسیت */

  const form = $(".prompt");
  const input = $("#q");
  const clearBtn = $(".prompt__clear");
  const sendBtn = $(".prompt__send");
  const plusBtn = $(".prompt__plus");
  const menu = $("#prompt-menu");
  const genderEl = $(".gender");

  function syncInput() {
    clearBtn.hidden = !input.value;
    sendBtn.classList.toggle("is-ready", input.value.trim().length > 0);
  }
  input.addEventListener("input", syncInput);
  clearBtn.addEventListener("click", () => { input.value = ""; syncInput(); input.focus(); paintWallCount(wall.preview("", state.gender), ""); });
  // نوشتن در نوار، دیوار را همان لحظه پر از لباس‌های مرتبط می‌کند
  let previewT;
  input.addEventListener("input", () => {
    clearTimeout(previewT);
    if (!body.classList.contains("is-home")) return;
    previewT = setTimeout(() => paintWallCount(wall.preview(input.value, state.gender), input.value), 300);
  });
  function paintWallCount(n, text) {
    const stores = Object.keys(E.stores()).length || 1;
    $("[data-wall-count]").textContent = n ? E.faNum(n) + " لباس مرتبط با «" + text.trim().slice(0, 28) + "»" : E.faNum(wall.baseCount()) + " لباس از " + E.faNum(stores) + " فروشگاه";
  }

  // جمله‌ی نمونه‌ی تایپ‌شونده در نوار؛ با جنسیت عوض می‌شود
  let typeLines = E.ideas(state.gender);
  (function typewriter() {
    if (reduceMotion) { input.placeholder = typeLines[0]; return; }
    let li = 0, ci = 0, dir = 1;
    (function tick() {
      if (document.activeElement === input || input.value) { input.placeholder = "موقعیتتان را با یک جمله بنویسید…"; return setTimeout(tick, 600); }
      const line = typeLines[li % typeLines.length];
      ci += dir;
      input.placeholder = line.slice(0, ci);
      if (ci >= line.length) { dir = -1; return setTimeout(tick, 2400); }
      if (ci <= 0) { dir = 1; li = (li + 1) % typeLines.length; return setTimeout(tick, 380); }
      setTimeout(tick, dir > 0 ? 52 : 18);
    })();
  })();

  function renderIdeas() {
    $("[data-ideas]").innerHTML = E.ideas(state.gender).map((t) => `<button type="button" class="chip" data-ask="${escapeHtml(t)}">${escapeHtml(t)}</button>`).join("");
  }
  function toggleMenu(open) {
    const o = open == null ? menu.hidden : open;
    menu.hidden = !o;
    plusBtn.setAttribute("aria-expanded", String(o));
  }
  plusBtn.addEventListener("click", () => toggleMenu());

  function paintGender() {
    const btns = $$("[data-g]", genderEl);
    const on = btns.find((b) => b.dataset.g === state.gender);
    btns.forEach((b) => b.setAttribute("aria-checked", String(b === on)));
    genderEl.classList.toggle("has-value", !!on);
    if (on) {
      const thumb = $(".gender__thumb", genderEl);
      thumb.style.width = on.offsetWidth + "px";
      thumb.style.transform = `translateX(${on.offsetLeft}px)`; // thumb با left:0 فیزیکی؛ در RTL هم درست است
    }
  }
  function setGender(g, opts) {
    opts = opts || {};
    state.gender = g;
    store.set("gender", g);
    paintGender();
    typeLines = E.ideas(g);
    renderIdeas();
    if (body.classList.contains("is-home")) { wall.setGender(g); paintWallCount(wall.preview(input.value, g), input.value); }
    else if (opts.rerun && state.lastQuery) { state.drops = state.drops.filter((k) => k !== "gender"); ask(state.lastQuery, { rerun: true }); }
  }
  genderEl.addEventListener("click", (e) => {
    const b = e.target.closest("[data-g]");
    if (!b || state.busy) return;
    setGender(state.gender === b.dataset.g ? "" : b.dataset.g, { rerun: true });
  });
  window.addEventListener("resize", paintGender);

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const q = input.value.trim();
    if (q) { state.drops = []; ask(q); }
  });

  /* ============================================================ هوش مصنوعی (Claude، اختیاری) */

  (async function detectAI() {
    const el = $("[data-ai-mode]");
    el.textContent = "استایلیست هوشمند داخل مرورگر · " + E.faNum(state.total) + " محصول";
    if (location.protocol === "file:") return;
    try {
      const r = await fetch("api/health", { cache: "no-store" });
      const j = await r.json();
      if (j && j.ai) { state.ai = true; el.textContent = "متصل به Claude · " + E.faNum(state.total) + " محصول"; el.classList.add("is-live"); }
      if (j && j.auth) { auth.server = true; if (j.user) auth.set(j.user); else if (auth.user) auth.set(null); }
    } catch (e) { /* نسخه‌ی استاتیک */ }
  })();

  async function askClaude(query, local) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 30000);
    try {
      const r = await fetch("api/stylist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query, previous: state.basePrev ? state.basePrev.raw : null, gender: state.req.gender || state.gender || null, profile: profileFor(state.req), understood: (local.understood || []).map((u) => u.label), hints: local.candidates.slice(0, 150), seen: E.seenList().slice(-80).map((x) => x[0]) }),
        signal: ctrl.signal,
      });
      if (!r.ok) throw new Error("HTTP " + r.status);
      const j = await r.json();
      const pick = (ids) => (ids || []).map((id) => E.get(id)).filter(Boolean);
      const results = pick(j.results);
      if (!results.length) return null;
      const look = pick(j.look).length ? pick(j.look) : local.look;
      const accessories = pick(j.accessories).length ? pick(j.accessories) : local.accessories;
      const ann = E.annotate(look, accessories, local.intent);
      const notes = new Map((j.notes || []).map((n) => [n.id, n.note]));
      ann.story.forEach((s) => { if (notes.get(s.item.id)) s.note = notes.get(s.item.id); });
      return Object.assign({}, local, {
        title: j.title || local.title, line: j.line || local.line, message: j.message || local.message,
        understood: j.understood && j.understood.length ? j.understood.map((label) => ({ key: "", label, fixed: true })) : local.understood,
        results, look, accessories, story: look.length >= 2 ? ann.story : local.story, tips: ann.tips.length ? ann.tips : local.tips,
        more: local.more.filter((x) => !results.includes(x)),
        followups: (j.followups && j.followups.length ? j.followups : local.followups).slice(0, 4), byClaude: true,
      });
    } catch (e) {
      console.warn("Claude در دسترس نبود؛ موتور داخلی استفاده شد:", e.message);
      return null;
    } finally { clearTimeout(t); }
  }

  /* ============================================================ حالت «در حال فکر» */

  const streamEl = $(".stream");
  function startThinking() {
    body.classList.add("is-busy", "is-thinking");
    body.classList.remove("is-home", "is-results", "is-consult");
    wall.pause();
    closePdp();
    // جریان کاتالوگ: عکس‌هایی که از جلوی چشم رد می‌شوند، یعنی واقعاً در حال گشتن است
    const all = E.all().filter((x) => !x._acc && (!state.gender || x.gender === state.gender));
    const sample = (n) => Array.from({ length: n }, () => all[Math.floor(Math.random() * all.length)]);
    $$(".stream__row", streamEl).forEach((row) => {
      const html = sample(12).map((it) => `<span class="stream__item">${img(it, "", "", "112px")}</span>`).join("");
      row.innerHTML = html + html;
    });
    const txt = $("[data-thinking-text]");
    const lines = ["در حال آماده‌سازی پاسخ شما", "انتخاب رنگ‌ها و فرم‌های هماهنگ", "چیدن اکسسوری‌ها با قواعد استایل"];
    let n = 0, tick = 0;
    txt.textContent = lines[0];
    const iv = setInterval(() => {
      tick++;
      n = Math.min(state.total, n + Math.ceil(state.total / 9));
      txt.textContent = tick < 10 ? "بررسی " + E.faNum(n) + " از " + E.faNum(state.total) + " محصول" : lines[1 + (Math.floor(tick / 4) % 2)];
    }, 140);
    return () => clearInterval(iv);
  }
  function finishThinking() {
    body.classList.remove("is-thinking", "is-busy");
    body.classList.add("is-results");
  }

  /* ============================================================ پرسیدن */

  async function ask(query, opts) {
    opts = opts || {};
    if (state.busy) return;
    toggleMenu(false);
    if (opts.rerun) return runSearch(query, { rerun: true, prev: state.basePrev });
    remember(query);
    // اول جمله‌ی کاربر را نشان بده و چند سؤال کوتاه بپرس (هرچه در جمله نگفته)
    if (openConsult(query, { prev: state.prevIntent })) { input.blur(); input.value = ""; syncInput(); return; }
    state.req = {};
    return runSearch(query, { prev: state.prevIntent });
  }

  async function runSearch(query, opts) {
    state.busy = true;
    input.blur();
    const stop = startThinking();
    const t0 = performance.now();
    let res = E.search(query, opts.prev, { gender: state.req.gender || state.gender, drop: state.drops, profile: profileFor(state.req) });
    if (state.ai && !res.empty) res = (await askClaude(query, res)) || res;
    const wait = (opts.rerun ? 1000 : 1800) - (performance.now() - t0);
    if (wait > 0) await sleep(wait);
    stop();

    if (!opts.rerun) state.basePrev = opts.prev || null;
    state.last = res;
    state.lastQuery = query;
    if (!res.empty) state.prevIntent = res.intent;
    render(res);
    if (!res.empty) seen(seenOf(res));
    finishThinking();
    input.value = "";
    syncInput();
    resultsEl.scrollTop = 0;
    resultsEl.focus({ preventScroll: true });
    newView(opts.rerun);
    state.busy = false;
  }

  async function styleAround(id) {
    if (state.busy) return;
    state.busy = true;
    const stop = startThinking();
    await sleep(reduceMotion ? 200 : 1300);
    stop();
    const res = E.styleAround(id);
    state.last = res;
    state.lastQuery = null;
    state.drops = [];
    state.basePrev = null;
    state.prevIntent = res.intent;
    render(res);
    seen(seenOf(res));
    finishThinking();
    resultsEl.scrollTop = 0;
    newView(false);
    state.busy = false;
  }

  /* ============================================================ برگشت (Back): تاریخچه‌ی مرورگر و بازگرداندن صفحه‌ی نتیجه */

  // هر صفحه‌ی نتیجه یک مدخل تاریخچه است: { v: "results", sid }؛ صفحه‌ی محصول و دوخت سفارشی هم مدخل خودشان را دارند.
  // نتیجه‌ها (همان محصولات، تغییرهای استایل و جای اسکرول) در sessionStorage همین زبانه نگه داشته می‌شوند؛ اگر کاربر به سایت
  // فروشگاه رفت و Back زد و مرورگر صفحه را دوباره بارگذاری کرد، همان صفحه دوباره ساخته می‌شود (نه یک جست‌وجوی تازه).
  const VIEWS = "rg:views";
  const hist = {
    push(st) { try { history.pushState(st, ""); } catch (e) { /* file:// قدیمی */ } },
    replace(st) { try { history.replaceState(st, ""); } catch (e) { /* file:// قدیمی */ } },
    get v() { return (history.state && history.state.v) || "home"; },
  };
  if ("scrollRestoration" in history) history.scrollRestoration = "manual";
  function loadViews() { try { return JSON.parse(sessionStorage.getItem(VIEWS)) || {}; } catch (e) { return {}; } }
  function snapshot() {
    const r = state.last, ids = (a) => (a || []).map((x) => x.id);
    return {
      at: Date.now(), query: state.lastQuery, req: state.req, drops: state.drops, prevIntent: state.prevIntent, basePrev: state.basePrev, scroll: resultsEl.scrollTop,
      res: {
        title: r.title, line: r.line, message: r.message, understood: r.understood, followups: r.followups, tips: r.tips, budget: r.budget || null, size: r.size || null,
        byClaude: !!r.byClaude, intent: r.intent, results: ids(r.results), look: ids(r.look), accessories: ids(r.accessories), more: ids(r.more),
        story: (r.story || []).map((x) => ({ id: x.item.id, role: x.role, slot: x.slot, note: x.note, alts: x.alts || [] })),
      },
      story: state.story.map((x) => ({ id: x.item.id, on: x.on, altIndex: x.altIndex, note: x.note, pool: (x.pool || []).map((y) => y.id) })),
    };
  }
  function saveView() {
    if (!state.sid || !state.last || state.last.empty) return;
    const views = loadViews();
    views[state.sid] = snapshot();
    const keys = Object.keys(views).sort((a, b) => views[a].at - views[b].at);
    while (keys.length > 8) delete views[keys.shift()];
    try { sessionStorage.setItem(VIEWS, JSON.stringify(views)); } catch (e) { /* حالت خصوصی مرورگر */ }
  }
  // صفحه‌ی نتیجه‌ی تازه: مدخل تازه در تاریخچه (برای «حذف برداشت» یا تغییر جنسیت، همان مدخل عوض می‌شود)
  function newView(replace) {
    state.sid = state.last && !state.last.empty ? Date.now().toString(36) + Math.random().toString(36).slice(2, 6) : null;
    saveView();
    const st = { v: "results", sid: state.sid };
    if (replace && hist.v === "results") hist.replace(st); else hist.push(st);
  }
  function showResults() {
    body.classList.remove("is-home", "is-consult", "is-thinking", "is-busy");
    body.classList.add("is-results");
    wall.pause();
  }
  // ساختن دوباره‌ی یک صفحه‌ی نتیجه از sessionStorage؛ همان محصولات، همان تغییرها، همان جای اسکرول
  function restoreView(sid) {
    const snap = loadViews()[sid];
    if (!snap) return false;
    const ids = (a) => (a || []).map(E.get).filter(Boolean);
    const r = snap.res;
    const res = Object.assign({}, r, {
      results: ids(r.results), look: ids(r.look), accessories: ids(r.accessories), more: ids(r.more),
      story: r.story.map((x) => ({ item: E.get(x.id), role: x.role, slot: x.slot, note: x.note, alts: x.alts })).filter((x) => x.item),
    });
    if (!res.results.length && !res.story.length) return false;
    Object.assign(state, { last: res, lastQuery: snap.query, req: snap.req || {}, drops: snap.drops || [], prevIntent: snap.prevIntent || null, basePrev: snap.basePrev || null, sid });
    C = null;
    render(res);
    // گزینه‌ی دیگر و حذف/اضافه‌هایی که کاربر در استایل کامل زده بود
    (snap.story || []).forEach((x, i) => {
      const st = state.story[i], it = E.get(x.id);
      if (!st || !it) return;
      Object.assign(st, { item: it, on: x.on, altIndex: x.altIndex, note: x.note, pool: ids(x.pool) });
      const el = $(`.step[data-step="${i}"]`);
      if (el) el.outerHTML = stepHtml(st, i);
    });
    $$(".reveal, .reveal-text, .step", resultsEl).forEach((el) => el.classList.add("is-in"));
    if (state.story.length >= 2) { activeStep = -1; paintStory(0, true); }
    showResults();
    keepScroll(snap.scroll || 0);
    return true;
  }
  // هنگام بارگذاری صفحه، چیدمان (فونت‌ها، عکس‌ها) چند لحظه بعد نهایی می‌شود؛ تا جای اسکرول بنشیند چند بار امتحان می‌شود،
  // مگر کاربر خودش زودتر اسکرول کند
  function keepScroll(y) {
    let touched = false, got = null;
    const stop = () => { touched = true; };
    ["wheel", "touchstart", "keydown", "pointerdown"].forEach((ev) => resultsEl.addEventListener(ev, stop, { once: true, passive: true }));
    const set = () => {
      const now = resultsEl.scrollTop;
      if (got != null && Math.abs(now - got) >= 2 && now > 2) touched = true; // از آخرین تنظیم ما جابه‌جا شده؛ کار خود کاربر است
      if (touched || Math.abs(now - y) < 2) return;
      resultsEl.style.scrollBehavior = "auto";
      resultsEl.scrollTop = y;
      resultsEl.style.scrollBehavior = "";
      got = resultsEl.scrollTop;
      onScroll();
    };
    requestAnimationFrame(set);
    [120, 400, 900, 1800].forEach((ms) => setTimeout(set, ms));
  }
  // پایه‌ی هر مدخل: صفحه‌ی نتیجه‌اش (اگر دارد) یا صفحه‌ی اول
  function showBase(st) {
    if (!st.sid) { goHome(true); return true; }
    if (st.sid === state.sid && state.last) { showResults(); return true; }
    if (restoreView(st.sid)) return true;
    goHome(true);
    return false;
  }
  window.addEventListener("popstate", (e) => {
    const st = e.state || { v: "home" };
    if (C) { C = null; body.classList.remove("is-consult"); $(".sms").hidden = true; }
    closeDrawer();
    if (st.v !== "pdp") closePdp();
    if (st.v !== "tailor") closeTailor();
    if (st.v === "home") return goHome(true);
    if (!showBase(st)) return;
    if (st.v === "pdp") openPdp(st.id, { noPush: true });
    if (st.v === "tailor") openTailor(null, { noPush: true });
  });
  // رفتن به سایت فروشگاه یا بستن زبانه: جای اسکرول و تغییرها ذخیره شود
  window.addEventListener("pagehide", saveView);
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") saveView(); });
  // بستن صفحه‌ی محصول یا دوخت سفارشی با دکمه‌ی خود سایت = یک قدم برگشت در تاریخچه
  function back(v, close) { if (hist.v === v) history.back(); else close(); }

  function goHome(fromPop) {
    closePdp();
    C = null;
    body.classList.remove("is-results", "is-thinking", "is-consult");
    body.classList.add("is-home");
    $("[data-results-title]").textContent = "";
    state.prevIntent = null;
    state.basePrev = null;
    state.lastQuery = null;
    state.drops = [];
    body.style.setProperty("--p", 0);
    wall.play();
    state.sid = null; // برگشت به نتیجه‌ها، آن صفحه را کامل (با پاسخ‌ها و درخواست قبلی) از sessionStorage می‌سازد
    if (fromPop !== true && hist.v !== "home") hist.push({ v: "home" });
  }

  /* ============================================================ ورود با موبایل و کد */

  // نسخه‌ی سرور کد را واقعاً پیامک می‌کند (api/auth/*)؛ در پیش‌نمایش، یک «پیامک آزمایشی» روی صفحه می‌آید
  const toLatin = (s) => String(s).replace(/[۰-۹]/g, (d) => "۰۱۲۳۴۵۶۷۸۹".indexOf(d)).replace(/[٠-٩]/g, (d) => "٠١٢٣٤٥٦٧٨٩".indexOf(d));
  const faDigits = (s) => String(s).replace(/\d/g, (d) => "۰۱۲۳۴۵۶۷۸۹"[d]);
  function normPhone(v) {
    let p = toLatin(v).replace(/[^\d+]/g, "");
    if (p.startsWith("+98")) p = "0" + p.slice(3);
    else if (p.startsWith("0098")) p = "0" + p.slice(4);
    else if (p.startsWith("98") && p.length === 12) p = "0" + p.slice(2);
    else if (p.startsWith("9") && p.length === 10) p = "0" + p;
    return /^09\d{9}$/.test(p) ? p : null;
  }
  const prettyPhone = (p) => faDigits(p.replace(/^(\d{4})(\d{3})(\d{4})$/, "$1 $2 $3"));

  const auth = {
    user: store.get("user", null),
    server: false,
    pending: null,
    async post(path, data) {
      const r = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data), credentials: "same-origin" });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.message || "خطا؛ دوباره امتحان کنید.");
      return j;
    },
    async send(phone) {
      if (this.server) return this.post("api/auth/otp", { phone });
      const code = String(Math.floor(10000 + Math.random() * 90000));
      this.pending = { phone, code };
      return { ok: true, wait: 120, devCode: code };
    },
    async verify(phone, code) {
      if (this.server) return (await this.post("api/auth/verify", { phone, code })).user;
      if (!this.pending || this.pending.phone !== phone || this.pending.code !== code) throw new Error("کد درست نیست؛ دوباره امتحان کنید.");
      this.pending = null;
      return { phone };
    },
    set(user) { this.user = user; store.set("user", user); paintUser(); if (user) syncMe(); },
    logout() {
      if (this.server) fetch("api/auth/logout", { method: "POST", credentials: "same-origin" }).catch(() => {});
      this.user = null; store.set("user", null); paintUser();
    },
  };
  function paintUser() { $("[data-user-dot]").hidden = !auth.user; }

  // داده‌های کاربر روی سرور (به شماره‌ی موبایل): دیده‌شده‌ها و سفارش‌های دوخت
  async function syncMe() {
    if (!auth.server || !auth.user) return;
    try {
      const r = await fetch("api/me", { credentials: "same-origin", cache: "no-store" });
      if (!r.ok) return;
      const j = await r.json();
      const server = new Map(Array.isArray(j.seen) ? j.seen : []);
      const localOnly = E.seenList().filter(([id]) => !server.has(id)).map(([id]) => id);
      E.seenList().forEach(([id, n]) => server.set(id, Math.max(n, server.get(id) || 0)));
      E.setSeen([...server]);
      store.set("seen", E.seenList());
      if (localOnly.length) fetch("api/seen", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids: localOnly.slice(-400) }), credentials: "same-origin" }).catch(() => {});
      if (Array.isArray(j.orders)) state.orders = j.orders;
    } catch (e) { /* بدون سرور */ }
  }

  let smsT;
  function showSms(code) {
    const el = $(".sms");
    el.innerHTML = `<b>پیامک · ${escapeHtml(SITE.name)}</b><span>کد ورود شما: <bdi dir="ltr">${faDigits(code)}</bdi></span><small>نسخه‌ی پیش‌نمایش؛ بزنید تا خودکار وارد شود</small>`;
    el.dataset.code = code;
    el.hidden = true; void el.offsetWidth; el.hidden = false;
    clearTimeout(smsT);
    smsT = setTimeout(() => { el.hidden = true; }, 14000);
  }
  $(".sms").addEventListener("click", (e) => {
    const box = $("[data-otp]", qEl);
    e.currentTarget.hidden = true;
    if (box) { box.value = e.currentTarget.dataset.code; box.dispatchEvent(new Event("input", { bubbles: true })); }
  });

  function paintLogin(dir) {
    const L = C.login;
    consultEl.classList.add("is-login");
    $("[data-consult-answers]").innerHTML = "";
    if (L.step === "phone") {
      qEl.innerHTML = `
        <span class="q__step">ورود یا ثبت‌نام</span>
        <h2 class="q__title">اول وارد شوید</h2>
        <p class="q__hint">با شماره موبایل؛ اگر حساب ندارید همین‌جا ساخته می‌شود و پاسخ‌ها، علاقه‌مندی‌ها و سفارش‌هایتان برایتان نگه داشته می‌شود.</p>
        <form class="login" data-login-phone novalidate>
          <input class="login__input" name="phone" type="tel" inputmode="numeric" autocomplete="tel" dir="ltr" maxlength="16" placeholder="0912 345 6789" value="${escapeHtml(L.phone || "")}" aria-label="شماره موبایل">
          <button type="submit" class="btn btn--white">دریافت کد</button>
        </form>
        <p class="login__err" data-login-err role="alert"></p>
        <p class="login__terms">ورود یعنی پذیرفتن قوانین و حریم خصوصی ${escapeHtml(SITE.name)}.</p>`;
    } else {
      qEl.innerHTML = `
        <span class="q__step">ورود یا ثبت‌نام</span>
        <h2 class="q__title">کد تأیید را وارد کنید</h2>
        <p class="q__hint">کد ۵ رقمی به <bdi dir="ltr">${prettyPhone(L.phone)}</bdi> پیامک شد. <button type="button" class="q__link q__link--inline" data-login-edit>ویرایش شماره</button></p>
        <label class="otp">
          <input class="otp__input" type="text" inputmode="numeric" autocomplete="one-time-code" maxlength="5" dir="ltr" aria-label="کد تأیید" data-otp>
          <span class="otp__boxes" aria-hidden="true">${"<i></i>".repeat(5)}</span>
        </label>
        <p class="login__err" data-login-err role="alert"></p>
        <p class="login__resend" data-resend></p>`;
      tickResend();
    }
    qEl.classList.remove("is-fwd", "is-back");
    void qEl.offsetWidth;
    qEl.classList.add(dir < 0 ? "is-back" : "is-fwd");
    const f = $("input", qEl);
    if (f) f.focus({ preventScroll: true });
  }
  let resendT;
  function tickResend() {
    clearTimeout(resendT);
    const el = $("[data-resend]", qEl);
    if (!el || !C || !C.login) return;
    const left = Math.max(0, Math.ceil((C.login.until - Date.now()) / 1000));
    el.innerHTML = left ? `ارسال دوباره تا <bdi>${faDigits(Math.floor(left / 60) + ":" + String(left % 60).padStart(2, "0"))}</bdi>` : `<button type="button" class="q__link q__link--inline" data-login-resend>ارسال دوباره‌ی کد</button>`;
    if (left) resendT = setTimeout(tickResend, 1000);
  }
  async function sendCode(phone) {
    const L = C.login;
    const r = await auth.send(phone);
    L.phone = phone;
    L.step = "code";
    L.until = Date.now() + (r.wait || 120) * 1000;
    paintLogin(1);
    if (r.devCode) setTimeout(() => showSms(r.devCode), reduceMotion ? 0 : 700);
  }
  function loginError(msg) {
    const el = $("[data-login-err]", qEl);
    if (el) el.textContent = msg;
    qEl.classList.remove("is-shake");
    void qEl.offsetWidth;
    qEl.classList.add("is-shake");
  }
  // بعد از ورود: یا کاری که منتظرش بود (مثل ست‌سازی)، یا سؤال‌های مشاوره
  function afterLogin() {
    const c = C;
    c.login = null;
    consultEl.classList.remove("is-login");
    $(".sms").hidden = true;
    toast("خوش آمدید؛ حالا سراغ پیشنهادها می‌رویم");
    if (c.then) { C = null; body.classList.remove("is-consult"); return c.then(); }
    const first = pending();
    if (!first.length) return finishConsult();
    c.trail = [first[0]];
    c.pos = 0;
    paintQuestion(1);
  }
  // کاری که ورود لازم دارد؛ اگر کاربر وارد نشده، اول صفحه‌ی ورود
  function requireLogin(label, then) {
    if (auth.user) return then();
    C = { query: label, prev: null, req: {}, done: [], trail: [], pos: 0, revisit: false, draft: null, then, login: { step: "phone" } };
    showConsultView(label);
    paintLogin(1);
  }



  /* ============================================================ مشاوره: جمله‌ی کاربر + سؤال‌های تکمیلی */

  const consultEl = $(".consult");
  const qEl = $("[data-q]");
  let C = null; // { query, prev, req, done, trail, pos, revisit, forOther, draft }

  const saveProfile = () => store.set("profile", state.profile);
  const markDone = (id) => { state.profile.done = [...new Set((state.profile.done || []).concat(id))]; saveProfile(); };
  // فقط سؤال‌های «me» یک‌بارند؛ رنگ و بقیه‌ی سؤال‌های «req» در هر درخواست دوباره پرسیده می‌شوند
  const doneMe = () => (state.profile.done || []).filter((id) => (E.QUESTIONS.find((q) => q.id === id) || {}).scope === "me");
  function profileFor(req) {
    const p = Object.assign({}, state.profile, req || {}, { gender: (req && req.gender) || state.gender || undefined });
    // رنگ‌های همین درخواست (اگر پرسیده شده) بر رنگ‌های دفعه‌ی قبل مقدم‌اند؛ «رد شدن» یعنی این بار بدون قید رنگ
    if (req && "colors" in req) Object.assign(p, { colorsReq: true, likeColors: req.colors ? req.colors.like : [], avoidColors: req.colors ? req.colors.avoid : [] });
    delete p.colors; delete p.done;
    return p;
  }
  const optLabel = (q, v) => ((q.options || []).find((o) => o[0] === v) || [])[1];

  function pending() {
    const done = (C.revisit ? [] : doneMe()).concat(C.done);
    const r = E.consult(C.query, C.prev, { gender: C.req.gender || state.gender, profile: profileFor(C.req), done });
    C.forOther = !!r.intent.forOther;
    return r.questions;
  }

  function showConsultView(query) {
    $("[data-consult-text]").textContent = "«" + query + "»";
    closePdp();
    closeDrawer();
    toggleMenu(false);
    wall.pause();
    body.classList.remove("is-home", "is-results");
    body.classList.add("is-consult");
  }
  // قبل از هر کاری: ورود؛ بعد سؤال‌هایی که جمله جوابشان را نداده
  function openConsult(query, opts) {
    C = { query, prev: opts.prev || null, req: Object.assign({}, opts.req || {}), done: [], trail: [], pos: 0, revisit: !!opts.revisit, draft: null, login: null };
    const first = pending();
    if (!first.length && auth.user) { C = null; return false; }
    C.trail = first.length ? [first[0]] : [];
    showConsultView(query);
    if (!auth.user) { C.login = { step: "phone" }; paintLogin(1); }
    else paintQuestion(1);
    return true;
  }

  // مقدار فعلی هر سؤال (از پاسخ‌های همین درخواست یا مشخصات ذخیره‌شده)
  function valueOf(id) {
    const p = state.profile;
    if (id === "gender") return C.req.gender || (C.forOther ? null : state.gender) || null;
    if (["place", "weather"].includes(id)) return C.req[id];
    // پیش‌فرض رنگ: پاسخ همین درخواست (هنگام ویرایش) یا پاسخ دفعه‌ی قبل
    if (id === "colors") { const c = C.req.colors || { like: p.likeColors, avoid: p.avoidColors }; return { like: (c.like || []).slice(), avoid: (c.avoid || []).slice() }; }
    if (id === "fit") return { main: p.fit, extra: p.cover };
    if (id === "budget") return { main: C.req.budget, extra: C.req.acc || "with" };
    if (id === "body") {
      const g = C.req.gender || state.gender;
      return { height: p.height || (g === "M" ? 177 : 163), weight: p.weight || (g === "M" ? 76 : 60), age: p.age || null };
    }
    if (id === "style") return (p.style || []).slice();
    return p[id];
  }

  function answerLabel(q) {
    const p = state.profile;
    if (q.id === "colors") {
      const c = C.req.colors, a = [];
      if (!c) return "colors" in C.req ? "رنگ: فرقی نمی‌کند" : "";
      if (c.like.length) a.push(c.like.map(E.colorLabel).join("، "));
      if (c.avoid.length) a.push("نه " + c.avoid.map(E.colorLabel).join("، "));
      return a.join(" · ") || "رنگ: فرقی نمی‌کند";
    }
    if (q.id === "style") return (p.style || []).map((v) => optLabel(q, v)).join("، ");
    if (q.id === "fit") return [optLabel(q, p.fit), p.cover === "modest" ? "پوشیده" : ""].filter(Boolean).join(" · ");
    if (q.id === "budget") return C.req.budget == null ? "" : [optLabel(q, C.req.budget), C.req.acc === "without" ? "بدون اکسسوری" : C.req.acc === "with" ? "با اکسسوری" : ""].filter(Boolean).join(" · ");
    if (q.id === "body") {
      if (!p.height) return "";
      const sz = E.sizeFor(C.req.gender || state.gender, p.height, p.weight);
      return E.faNum(p.height) + " سانت · " + E.faNum(p.weight) + " کیلو" + (sz ? " · سایز " + sz.letter + "\u200f" : "") + (p.age ? " · " + E.ageLabel(p.age) : "");
    }
    const v = q.id === "gender" ? C.req.gender : ["place", "weather", "budget"].includes(q.id) ? C.req[q.id] : p[q.id];
    return v == null ? "" : optLabel(q, v) || "";
  }

  function sizeTip(d) {
    const sz = E.sizeFor(C.req.gender || state.gender, d.height, d.weight);
    return sz ? `سایز پیشنهادی شما: <strong>${sz.letter}</strong>&rlm;${sz.waist ? " · شلوار " + sz.waist.map(E.faNum).join("–") : ""}` : "برای پیشنهاد سایز، اول خانم یا آقا را مشخص کنید.";
  }

  function optionsHtml(q, cur, attr) {
    const on = (v) => (Array.isArray(cur) ? cur.includes(v) : cur === v);
    return q.options.map((o, i) => `<button type="button" class="opt" style="--i:${i}" ${attr || "data-opt"}="${escapeHtml(o[0])}" aria-pressed="${on(o[0])}">${escapeHtml(o[1])}</button>`).join("");
  }

  function paintQuestion(dir) {
    const q = C.trail[C.pos];
    const rest = pending().filter((x) => !C.trail.some((t) => t.id === x.id));
    const total = C.trail.length + rest.length;
    consultEl.style.setProperty("--k", (C.pos / total).toFixed(3));
    consultEl.classList.remove("is-login");
    const raw = valueOf(q.id);
    const cur = (q.id === "fit" || q.id === "budget") && !q.extra ? raw.main : raw;
    C.draft = JSON.parse(JSON.stringify(cur == null ? null : cur));
    let inner = "", needsNext = false;
    if (q.extra) {
      // سؤال دوبخشی: «فرم و پوشش» یا «بودجه و اکسسوری»
      needsNext = true;
      inner = `<div class="q__options">${optionsHtml(q, cur.main)}</div><p class="q__sub">${escapeHtml(q.extra.title)}</p><div class="q__options">${optionsHtml(q.extra, cur.extra, "data-extra")}</div>`;
    } else if (q.kind === "single") inner = `<div class="q__options">${optionsHtml(q, cur)}</div>`;
    else if (q.kind === "multi") { needsNext = true; inner = `<div class="q__options">${optionsHtml(q, cur)}</div>`; }
    else if (q.kind === "colors") {
      needsNext = true;
      inner = `<div class="swatches">${q.options.map((o, i) => {
        const st = cur.like.includes(o[0]) ? "like" : cur.avoid.includes(o[0]) ? "avoid" : "";
        return `<button type="button" class="swatch" style="--i:${i};--c:${o[2]}" data-swatch="${o[0]}" data-state="${st}" aria-label="${escapeHtml(o[1])}"><span class="swatch__dot"></span><span class="swatch__name">${escapeHtml(o[1])}</span></button>`;
      }).join("")}</div><p class="q__legend"><span><i class="lg lg--like"></i>دوست دارم</span><span><i class="lg lg--avoid"></i>نمی‌پوشم</span></p>`;
    } else if (q.kind === "body") {
      needsNext = true;
      inner = `<div class="body-q">
        <label class="range"><span>قد</span><input type="range" min="140" max="205" step="1" value="${cur.height}" data-range="height"><output data-out="height">${E.faNum(cur.height)} سانتی‌متر</output></label>
        <label class="range"><span>وزن</span><input type="range" min="35" max="150" step="1" value="${cur.weight}" data-range="weight"><output data-out="weight">${E.faNum(cur.weight)} کیلوگرم</output></label>
        <p class="q__sub">سن</p>
        <div class="q__options">${q.ages.map((a, i) => `<button type="button" class="opt opt--sm" style="--i:${i}" data-age="${a[0]}" aria-pressed="${cur.age === a[0]}">${escapeHtml(a[1])}</button>`).join("")}</div>
        <p class="size-tip" data-size-tip>${sizeTip(cur)}</p>
      </div>`;
    }
    qEl.innerHTML = `
      <span class="q__step">${C.pos === 0 && !C.revisit ? "برای پیشنهاد دقیق‌تر، چند سؤال کوتاه · " : ""}${E.faNum(C.pos + 1)} از ${E.faNum(total)}</span>
      <h2 class="q__title">${escapeHtml(q.title)}</h2>
      ${q.hint ? `<p class="q__hint">${escapeHtml(q.hint)}</p>` : ""}
      ${inner}
      <div class="q__actions">
        ${C.pos > 0 ? `<button type="button" class="q__link" data-q-back>قبلی</button>` : ""}
        <button type="button" class="q__link" data-q-skip>${q.id === "colors" ? "فرقی نمی‌کنه" : q.scope === "me" ? "ترجیح می‌دم نگم" : "رد شدن"}</button>
        ${needsNext ? `<button type="button" class="btn btn--white" data-q-next>${rest.length || C.pos < C.trail.length - 1 ? "بعدی" : "نمایش پیشنهادها"}</button>` : ""}
      </div>`;
    qEl.classList.remove("is-fwd", "is-back");
    void qEl.offsetWidth;
    qEl.classList.add(dir < 0 ? "is-back" : "is-fwd");
    paintAnswers();
    const first = $(".opt[aria-pressed='true'], .opt, .swatch, input", qEl);
    if (first) first.focus({ preventScroll: true });
  }

  // پاسخ‌های داده‌شده (قابل کلیک برای برگشت) و مشخصاتی که از قبل یادمان مانده
  function paintAnswers() {
    const given = C.trail.slice(0, C.pos).map((q, i) => ({ q, i, label: answerLabel(q) })).filter((x) => x.label);
    let html = given.map((x) => `<button type="button" class="a-chip" data-answer-jump="${x.i}">${escapeHtml(x.label)}</button>`).join("");
    if (!C.revisit && !C.forOther) {
      const remembered = doneMe().filter((id) => !C.trail.some((t) => t.id === id))
        .map((id) => ({ id, q: E.QUESTIONS.find((x) => x.id === id) })).filter((x) => x.q).map((x) => answerLabel(x.q)).filter(Boolean);
      if (remembered.length) html += `<span class="a-memo">یادم مانده: ${escapeHtml(remembered.join(" · "))}</span><button type="button" class="a-chip a-chip--line" data-consult-revisit>ویرایش</button>`;
    }
    $("[data-consult-answers]").innerHTML = html;
  }

  function commit() {
    const q = C.trail[C.pos], d = C.draft, p = state.profile;
    if (q.id === "gender") { C.req.gender = d; if (!C.forOther && d) setGender(d); }
    else if (q.id === "budget") { if (q.extra) { C.req.budget = d.main; C.req.acc = d.extra; } else C.req.budget = d; }
    else if (["place", "weather"].includes(q.id)) C.req[q.id] = d;
    else if (q.id === "colors") {
      // رنگ مخصوص همین درخواست است؛ برای خود کاربر، پیش‌فرض دفعه‌ی بعد هم می‌شود
      C.req.colors = { like: d.like.slice(), avoid: d.avoid.slice() };
      if (!C.forOther) { p.likeColors = d.like; p.avoidColors = d.avoid; saveProfile(); }
    } else {
      if (q.id === "style") p.style = d || [];
      else if (q.id === "fit") { if (q.extra) { p.fit = d.main; p.cover = d.extra; } else p.fit = d; }
      else if (q.id === "body") { p.height = d.height; p.weight = d.weight; p.age = d.age; }
      else p[q.id] = d;
      markDone(q.id);
    }
    if (!C.done.includes(q.id)) C.done.push(q.id);
    C.trail = C.trail.slice(0, C.pos + 1); // پاسخ تازه ممکن است سؤال‌های بعدی را عوض کند
    advance(1);
  }
  function skip() {
    const q = C.trail[C.pos];
    if (q.scope === "me") markDone(q.id); else C.req[q.id] = C.req[q.id] || null;
    if (!C.done.includes(q.id)) C.done.push(q.id);
    C.trail = C.trail.slice(0, C.pos + 1);
    advance(1);
  }
  function advance(dir) {
    if (dir < 0) { if (C.pos > 0) { C.pos--; paintQuestion(-1); } return; }
    if (C.pos < C.trail.length - 1) { C.pos++; return paintQuestion(1); }
    const next = pending().filter((x) => !C.trail.some((t) => t.id === x.id))[0];
    if (!next) return finishConsult();
    C.trail.push(next);
    C.pos++;
    paintQuestion(1);
  }
  function finishConsult() {
    const c = C;
    C = null;
    state.req = c.req;
    state.drops = [];
    body.classList.remove("is-consult");
    runSearch(c.query, { prev: c.prev });
  }
  function leaveConsult() {
    const q = C.query;
    C = null;
    body.classList.remove("is-consult");
    body.classList.add(state.last ? "is-results" : "is-home");
    if (!state.last) wall.play();
    input.value = q;
    syncInput();
    input.focus();
  }

  consultEl.addEventListener("submit", async (e) => {
    const f = e.target.closest("[data-login-phone]");
    if (!f || !C || !C.login) return;
    e.preventDefault();
    const phone = normPhone(f.phone.value);
    if (!phone) return loginError("شماره‌ی موبایل درست نیست؛ مثلاً ۰۹۱۲۳۴۵۶۷۸۹");
    const btn = $("button", f);
    btn.disabled = true;
    try { await sendCode(phone); } catch (err) { btn.disabled = false; loginError(err.message); }
  });
  consultEl.addEventListener("input", async (e) => {
    const box = e.target.closest("[data-otp]");
    if (!box || !C || !C.login) return;
    const v = toLatin(box.value).replace(/\D/g, "").slice(0, 5);
    box.value = v;
    $$(".otp__boxes i", qEl).forEach((b, k) => { b.textContent = v[k] ? faDigits(v[k]) : ""; b.classList.toggle("is-on", k === v.length); });
    if (v.length < 5) return;
    box.disabled = true;
    try { auth.set(await auth.verify(C.login.phone, v)); afterLogin(); }
    catch (err) { box.disabled = false; box.value = ""; $$(".otp__boxes i", qEl).forEach((b) => (b.textContent = "")); loginError(err.message); box.focus(); }
  });
  consultEl.addEventListener("click", async (e) => {
    if (!C) return;
    const t = e.target;
    let el;
    if (C.login) {
      if (t.closest("[data-login-edit]")) { C.login.step = "phone"; return paintLogin(-1); }
      if (t.closest("[data-login-resend]")) { try { await sendCode(C.login.phone); } catch (err) { loginError(err.message); } return; }
      if (t.closest("[data-consult-edit]")) return leaveConsult();
      return;
    }
    const q = C.trail[C.pos];
    if ((el = t.closest("[data-opt]"))) {
      const v = q.id === "budget" ? +el.dataset.opt : el.dataset.opt;
      if (q.kind === "multi") {
        let d = C.draft || [];
        d = d.includes(v) ? d.filter((x) => x !== v) : d.concat(v);
        if (q.max && d.length > q.max) d = d.slice(-q.max);
        C.draft = d;
        $$("[data-opt]", qEl).forEach((b) => b.setAttribute("aria-pressed", String(d.includes(b.dataset.opt))));
        return;
      }
      if (q.extra) { C.draft.main = v; $$("[data-opt]", qEl).forEach((b) => b.setAttribute("aria-pressed", String(b === el))); return; }
      C.draft = v;
      $$("[data-opt]", qEl).forEach((b) => b.setAttribute("aria-pressed", String(b === el)));
      qEl.classList.add("is-picked");
      return setTimeout(() => { qEl.classList.remove("is-picked"); if (C) commit(); }, reduceMotion ? 0 : 280);
    }
    if ((el = t.closest("[data-extra]"))) { C.draft.extra = el.dataset.extra; $$("[data-extra]", qEl).forEach((b) => b.setAttribute("aria-pressed", String(b === el))); return; }
    if ((el = t.closest("[data-swatch]"))) {
      // یک بار: دوست دارم، دو بار: نمی‌پوشم، سه بار: هیچ‌کدام
      const f = el.dataset.swatch, d = C.draft;
      const next = { "": "like", like: "avoid", avoid: "" }[el.dataset.state || ""];
      d.like = d.like.filter((x) => x !== f); d.avoid = d.avoid.filter((x) => x !== f);
      if (next) d[next].push(f);
      el.dataset.state = next;
      return;
    }
    if ((el = t.closest("[data-age]"))) {
      const a = +el.dataset.age;
      C.draft.age = C.draft.age === a ? null : a;
      $$("[data-age]", qEl).forEach((b) => b.setAttribute("aria-pressed", String(+b.dataset.age === C.draft.age)));
      return;
    }
    if (t.closest("[data-q-next]")) return commit();
    if (t.closest("[data-q-skip]")) return skip();
    if (t.closest("[data-q-back]")) return advance(-1);
    if ((el = t.closest("[data-answer-jump]"))) { C.pos = +el.dataset.answerJump; return paintQuestion(-1); }
    if (t.closest("[data-consult-revisit]")) { const c = C; openConsult(c.query, { prev: c.prev, req: c.req, revisit: true }); return; }
    if (t.closest("[data-consult-done]")) return finishConsult();
    if (t.closest("[data-consult-edit]")) return leaveConsult();
  });
  consultEl.addEventListener("input", (e) => {
    const r = e.target.closest("[data-range]");
    if (!r || !C) return;
    C.draft[r.dataset.range] = +r.value;
    $(`[data-out="${r.dataset.range}"]`, qEl).textContent = E.faNum(+r.value) + (r.dataset.range === "height" ? " سانتی‌متر" : " کیلوگرم");
    $("[data-size-tip]", qEl).innerHTML = sizeTip(C.draft);
  });

  /* ============================================================ رندر نتایج */

  const resultsEl = $(".results");

  function render(res) {
    $("[data-results-title]").textContent = res.empty ? "" : res.title;
    const out = [];
    const lineWords = (res.line || "").split(" ");
    const words = lineWords.map((w, i) => `<span class="w" style="animation-delay:${150 + i * 55}ms">${escapeHtml(w)}</span>`).join(" ");
    const after = 350 + lineWords.length * 55;
    const chips = (res.understood || []).map((u) => `<span class="u-chip">${escapeHtml(u.label)}${u.fixed || !u.key ? "" : `<button type="button" data-drop="${escapeHtml(u.key)}" aria-label="حذف «${escapeHtml(u.label)}» و جست‌وجوی دوباره">×</button>`}</span>`).join("");
    out.push(`<section class="block editorial">
      <p class="editorial__line">${words}</p>
      ${chips ? `<div class="understood" style="animation-delay:${after}ms"><span class="understood__label">برداشت من از حرف شما</span>${chips}</div>` : ""}
      ${res.message ? `<p class="editorial__msg" style="animation-delay:${after + 120}ms">${escapeHtml(res.message)}</p>` : ""}
      <div class="chips" style="animation-delay:${after + 260}ms">${res.followups.slice(0, 3).map((f) => `<button type="button" class="chip chip--ink" data-ask="${escapeHtml(f)}">${escapeHtml(f)}</button>`).join("")}${state.lastQuery ? `<button type="button" class="chip chip--ink chip--edit" data-revisit>ویرایش پاسخ‌ها</button>` : ""}</div>
    </section>`);

    if (res.results.length) {
      const top = res.results.slice(0, 6);
      out.push(`<section class="block"><div class="bento${top.length < 6 ? " bento--short" : ""}">${top.map((it, i) => card(it, { i, hover: true, sizes: SIZES.bento })).join("")}</div></section>`);
    }

    state.story = (res.story || []).map((s) => Object.assign({}, s, { on: true, altIndex: -1, orig: s.item }));
    if (state.story.length >= 2) out.push(storyHtml(res));
    else if ((res.accessories || []).length) {
      out.push(`<section class="block" id="acc"><div class="block__head"><h2 class="block__title reveal-text">برای کامل‌کردن استایل</h2></div>
        <div class="rail">${res.accessories.slice(0, 5).map((it, i) => card(it, { i, under: true })).join("")}</div></section>`);
    }

    const rest = res.results.slice(6).concat(res.more || []).filter((x, i, a) => a.indexOf(x) === i);
    state.rest = rest;
    if (rest.length) {
      out.push(`<section class="block" id="more">
        <div class="block__head"><h2 class="block__title reveal-text">پیشنهادهای دیگر</h2></div>
        <div class="grid" data-more>${rest.slice(0, 8).map((it, i) => card(it, { i: i % 4, under: true, hover: true })).join("")}</div>
        ${rest.length > 8 ? `<button type="button" class="more-btn" data-more-btn>نمایش بیشتر</button>` : ""}
      </section>`);
    }
    if (!res.results.length && !res.empty) out.push(`<p class="empty">چیزی پیدا نشد. یک جور دیگر بنویسید؛ مثلاً «یه تی‌شرت سفید ساده برای تابستون».</p>`);
    if (!res.empty) out.push(`<section class="block tailor-cta"><h2 class="block__title">دقیقاً همانی که در ذهن دارید نبود؟</h2>
      <p class="block__sub">بنویسید چه لباسی می‌خواهید؛ از پینترست نمونه می‌آوریم و خیاط آن را در اندازه‌ی شما می‌دوزد. طراح لباس هم داریم.</p>
      <button type="button" class="btn btn--ink" data-open-tailor="">دوخت سفارشی</button></section>`);
    $(".results__inner").innerHTML = out.join("");
    activeStep = -1;
    observeReveals();
    if (state.story.length >= 2) { paintStory(0, true); setTimeout(preloadStory, 700); }
    onScroll();
  }

  /* ============================================================ داستان استایل (اسکرول‌محور) */

  const SLOT_LABEL = { outer: "لایه‌ی رویی", top: "بالاتنه", bottom: "پایین‌تنه" };
  function storyHtml(res) {
    const pieces = state.story.filter((s) => s.role === "piece").length;
    const steps = state.story.map((s, i) => {
      const divider = i === pieces && i > 0 ? `<li class="step step--divider"><span>و حالا اکسسوری‌ها</span><small>چیده‌شده با قواعد استایل ایرانی، از همان فروشگاه‌ها</small></li>` : "";
      return divider + stepHtml(s, i);
    }).join("");
    const tips = res.tips || [];
    return `<section class="block story" id="story">
      <div class="block__head"><h2 class="block__title reveal-text">استایل کامل</h2>${tips.length ? `<p class="block__sub reveal-text">${escapeHtml(tips[0])}</p>` : ""}</div>
      <div class="story__grid">
        <div class="story__stage">
          <div class="story__frame"><span class="story__tag"></span></div>
          <div class="story__board" role="list" aria-label="تکه‌های استایل"></div>
          <div class="story__total"><span>جمع استایل <strong data-story-total></strong></span><small class="story__hint">خرید هر تکه با «خرید از …» در سایت همان فروشگاه</small></div>
        </div>
        <ol class="story__steps">${steps}
          ${tips.slice(1, 3).map((t) => `<li class="step step--tip"><span class="step__kicker">نکته‌ی استایلیست</span><p>${escapeHtml(t)}</p></li>`).join("")}
        </ol>
      </div>
    </section>`;
  }

  function stepHtml(s, i) {
    const it = s.item;
    const kicker = s.role === "piece" ? (i === 0 ? "تکه‌ی اصلی" : SLOT_LABEL[s.slot] || E.typeLabel(it.type)) : E.typeLabel(it.type);
    return `<li class="step${s.on ? "" : " is-off"}" data-step="${i}">
      <span class="step__kicker">${E.faNum(String(i + 1).padStart(2, "0"))} · ${escapeHtml(kicker)}</span>
      <h3 class="step__name">${escapeHtml(it.title)}</h3>
      <p class="step__note">${escapeHtml(s.note || "")}</p>
      <p class="step__meta">${price(it)}${it.color ? " · " + escapeHtml(it.color) : ""}${sizeMeta(it)}</p>
      <div class="step__actions">
        <button type="button" class="pill-btn" data-step-toggle="${i}" aria-pressed="${s.on}">${s.on ? "✓ در استایل" : "+ اضافه به استایل"}</button>
        <button type="button" class="pill-btn" data-step-swap="${i}">گزینه‌ی دیگر</button>
        <button type="button" class="pill-btn pill-btn--ghost" data-open-item="${escapeHtml(it.id)}">جزئیات</button>
        ${buyLink(it, "pill-btn pill-btn--buy")}
      </div>
    </li>`;
  }

  function sizeMeta(it) {
    const sz = state.last && state.last.size;
    if (!it.sizes || !it.sizes.length || it.sizes.includes("تک سایز")) return "";
    if (sz && !it._acc) return E.hasSize(it, sz) ? ` · <span class="ok">سایز ${escapeHtml(sz.letter)}&rlm; شما موجود است</span>` : " · سایز شما تمام شده";
    return " · سایز " + escapeHtml(it.sizes.slice(0, 5).map((x) => (/^\d+$/.test(x) ? E.faNum(x) : x)).join("، "));
  }

  let activeStep = -1;
  function paintStory(i, force) {
    const sec = $("#story");
    if (!sec || !state.story[i]) return;
    if (i === activeStep && !force) return;
    activeStep = i;
    const s = state.story[i];
    $$(".step[data-step]", sec).forEach((el) => el.classList.toggle("is-active", +el.dataset.step === i));
    // عکس بزرگ همان لحظه عوض می‌شود: برای هر تکه یک <img> تازه (هیچ‌وقت عکس قبلی یا عکسِ دیررسیده‌ی تکه‌ی دیگری نشان داده نمی‌شود).
    // تا نسخه‌ی بزرگ برسد، نسخه‌ی کوچکِ همان عکس (که در تخته و کارت‌ها آمده) پس‌زمینه‌ی خودش است.
    const frame = $(".story__frame", sec);
    const cur = $(".story__img.is-on", frame);
    if (!cur || cur.dataset.id !== s.item.id) {
      const im = document.createElement("img");
      im.className = "story__img";
      im.alt = s.item.title;
      im.decoding = "async";
      im.dataset.id = s.item.id;
      im.dataset.raw = s.item._img;
      im.style.backgroundImage = `url("${E.imgUrl(s.item._img, Math.round(120 * DPR))}")`;
      im.src = frameUrl(s.item, frame);
      frame.insertBefore(im, $(".story__tag", frame));
      void im.offsetWidth; // تا محو شدن ورود دیده شود
      $$(".story__img", frame).forEach((x) => {
        const on = x === im;
        x.classList.toggle("is-on", on);
        if (!on) setTimeout(() => { if (!x.classList.contains("is-on")) x.remove(); }, 450);
      });
    }
    $(".story__tag", sec).textContent = E.faNum(String(i + 1).padStart(2, "0")) + " / " + E.faNum(String(state.story.length).padStart(2, "0"));
    // تخته‌ی تکه‌ها و جمع
    $(".story__board", sec).innerHTML = state.story.map((x, k) => `<button type="button" class="board__item${k === i ? " is-active" : ""}${x.on ? "" : " is-off"}" data-step-jump="${k}" role="listitem" aria-label="${escapeHtml(x.item.title)}">${img(x.item, "", "", SIZES.thumb)}</button>`).join("");
    const total = state.story.filter((x) => x.on).reduce((sum, x) => sum + x.item.price, 0);
    const budget = state.last && state.last.budget;
    $("[data-story-total]", sec).innerHTML = escapeHtml(E.fmtPrice(total)) + (budget ? ` <small class="${total > budget ? "over" : ""}">از ${E.faNum(Math.round(budget / 1e5) / 10)} میلیون بودجه</small>` : "");
  }

  // نسخه‌ی هم‌اندازه‌ی قاب بزرگ؛ و پیش‌بارگذاری عکس همه‌ی تکه‌ها تا با اسکرول بی‌درنگ عوض شوند
  function frameUrl(it, frame) {
    return E.imgUrl(it._img, Math.round(Math.max(frame.clientWidth || 440, frame.clientHeight || 550) * DPR));
  }
  function preloadStory() {
    const frame = $("#story .story__frame");
    if (!frame) return;
    state.story.forEach((x) => { const im = new Image(); im.decoding = "async"; im.src = frameUrl(x.item, frame); });
  }

  function swapStep(i) {
    const s = state.story[i];
    // جایگزین‌ها: هم‌جنسیت، غیرتکراری و نه چیزی که همین حالا در تکه‌های دیگر استایل هست
    const taken = new Set(state.story.filter((x, k) => k !== i).map((x) => x.item.id));
    const fits = (x) => x && x.id !== s.orig.id && !taken.has(x.id) && (x.gender === s.orig.gender || x.gender === "U" || s.orig.gender === "U");
    let pool = s.alts.map(E.get).filter(fits);
    if (pool.length < 3) pool = pool.concat(E.similar(s.orig, 8).filter((x) => fits(x) && !pool.includes(x)));
    if (!pool.length) return toast("گزینه‌ی دیگری برای این تکه نبود");
    s.pool = pool;
    const frame = $("#story .story__frame");
    if (frame) pool.slice(0, 3).forEach((x) => { const im = new Image(); im.src = frameUrl(x, frame); });
    s.altIndex = (s.altIndex + 1) % (pool.length + 1);
    s.item = s.altIndex === pool.length ? s.orig : pool[s.altIndex];
    if (s.item !== s.orig) s.note = s.role === "accessory" ? "جایگزین هم‌حس با بقیه‌ی استایل." : "گزینه‌ی هم‌نوع؛ با بقیه‌ی تکه‌ها هم جور می‌شود.";
    else s.note = (state.last.story[i] || {}).note || s.note;
    seen([s.item.id]);
    const old = $(`.step[data-step="${i}"]`);
    old.outerHTML = stepHtml(s, i);
    // کلاس نمایش (is-in) باید بماند؛ وگرنه متن و دکمه‌های این تکه ناپدید می‌شوند
    $(`.step[data-step="${i}"]`).classList.add("is-in", "is-swapped", "is-active");
    activeStep = -1;
    paintStory(i, true);
    saveView();
  }

  /* ============================================================ اسکرول: نمایش تدریجی، پارالاکس، پیشرفت */

  let io = null;
  function observeReveals() {
    if (io) io.disconnect();
    const els = $$(".reveal:not(.is-in), .reveal-text:not(.is-in), .step:not(.is-in)", resultsEl);
    if (reduceMotion || !("IntersectionObserver" in window)) { els.forEach((el) => el.classList.add("is-in")); return; }
    io = new IntersectionObserver((entries) => {
      entries.forEach((en) => { if (en.isIntersecting) { en.target.classList.add("is-in"); io.unobserve(en.target); } });
    }, { root: resultsEl, rootMargin: "0px 0px -6% 0px", threshold: 0.06 });
    els.forEach((el) => io.observe(el));
  }

  let scrollRaf = 0, lastSt = 0;
  function onScroll() {
    if (scrollRaf) return;
    scrollRaf = requestAnimationFrame(() => {
      scrollRaf = 0;
      const st = resultsEl.scrollTop, max = resultsEl.scrollHeight - resultsEl.clientHeight;
      body.style.setProperty("--p", max > 0 ? (st / max).toFixed(4) : 0);
      body.classList.toggle("is-scrolled", st > 40);
      // نوار پرامپت هنگام اسکرول به پایین کنار می‌رود و با اسکرول به بالا برمی‌گردد
      if (Math.abs(st - lastSt) > 6) { body.classList.toggle("is-reading", st > lastSt && st > 320); lastSt = st; }
      const vh = resultsEl.clientHeight, mid = vh * 0.5;
      // داستان: آخرین تکه‌ای که نامش به ناحیه‌ی خواندن رسیده؛ عکس همان وقتی عوض می‌شود که متن تکه می‌رسد.
      // دسکتاپ (عکس کنار متن): خط ۶۲٪ ارتفاع. موبایل (عکس چسبیده بالای متن): وسط بخشی از صفحه که زیر عکس دیده می‌شود
      const steps = $$(".step[data-step]", resultsEl);
      if (steps.length) {
        const stage = $(".story__stage", resultsEl), sr = stage && stage.getBoundingClientRect(), r0 = steps[0].getBoundingClientRect();
        const stacked = sr && r0.left < sr.right && r0.right > sr.left;
        const line = stacked ? sr.bottom + (vh - sr.bottom) * 0.45 : vh * 0.62;
        let best = +steps[0].dataset.step;
        steps.forEach((el) => { const n = $(".step__name", el) || el; if (n.getBoundingClientRect().top < line) best = +el.dataset.step; });
        paintStory(best);
      }
      if (reduceMotion) return;
      // ادیتوریال آرام عقب می‌رود
      const ed = $(".editorial", resultsEl);
      if (ed) { ed.style.transform = `translateY(${(Math.min(st, 700) * 0.25).toFixed(1)}px)`; ed.style.opacity = Math.max(0, 1 - st / 560).toFixed(3); }
      // پارالاکس عکس‌های گرید
      $$(".bento .card__img, .grid .card__img", resultsEl).forEach((box) => {
        const r = box.getBoundingClientRect();
        if (r.bottom < -50 || r.top > vh + 50) return;
        box.style.setProperty("--py", ((r.top + r.height / 2 - mid) * -0.045).toFixed(1) + "px");
      });
    });
  }
  resultsEl.addEventListener("scroll", onScroll, { passive: true });

  /* ============================================================ صفحه‌ی محصول */

  const pdp = $(".pdp");

  // پیوند خرید مستقیم در سایت همان فروشگاه (رگال سبد خرید ندارد)؛ در همان زبانه باز می‌شود تا Back به همین صفحه برگردد
  const buyLink = (it, cls) => `<a class="${cls}" href="${escapeHtml(it.url)}" rel="noopener" referrerpolicy="origin">خرید از ${escapeHtml(storeOf(it))} ↖</a>`;

  function openPdp(id, opts) {
    const it = E.get(id);
    if (!it) return;
    if (!(opts && opts.noPush)) {
      const st = hist.v === "pdp" ? Object.assign({}, history.state, { id }) : { v: "pdp", id, sid: body.classList.contains("is-results") ? state.sid : null };
      if (hist.v === "pdp") hist.replace(st); else hist.push(st);
    }
    const imgs = [it._img, it._img2].filter((x, i, a) => x && a.indexOf(x) === i);
    $(".pdp__media").innerHTML = imgs.map((src, i) => `<img src="${escapeHtml(E.imgUrl(src, 1600))}" data-raw="${escapeHtml(src)}" alt="${escapeHtml(it.title + (i ? " — نمای دیگر" : ""))}">`).join("");
    const f = it.features || {};
    const specs = ["استایل", "جنس پارچه", "مناسب برای فصول", "یقه", "آستین", "طرح", "قد", "ارتفاع فاق", "نحوه بسته‌شدن", "سایر توضیحات"]
      .filter((k) => f[k]).map((k) => `<dt>${escapeHtml(k)}</dt><dd>${escapeHtml(f[k])}</dd>`).join("");
    const pair = E.completeLook(it);
    const sim = E.similar(it, 8);
    const mini = (x) => `<button type="button" class="mini" data-open-item="${escapeHtml(x.id)}"><span class="card__img">${img(x, "", "", SIZES.thumb)}</span><span>${escapeHtml(x.title)}</span></button>`;
    $(".pdp__panel").innerHTML = `
      <div class="pdp__brand">${escapeHtml(storeOf(it))}${it.brand && it.brand !== storeOf(it) ? " · " + escapeHtml(it.brand) : ""}</div>
      <h2 class="pdp__name">${escapeHtml(it.title)}</h2>
      <div class="pdp__price"><span>${price(it)}</span>${it.discount ? `<s>${E.fmtPrice(it.basePrice)}</s><span class="off">${E.faNum(it.discount)}٪</span>` : ""}</div>
      <h3>رنگ: ${escapeHtml(it.color || "—")}</h3>
      ${it.sizes && it.sizes.length ? `<h3>سایزهای موجود</h3><div class="sizes">${it.sizes.map((s) => `<span class="size">${escapeHtml(s)}</span>`).join("")}</div>` : ""}
      <div class="cta">
        ${buyLink(it, "btn btn--ink")}
        <button type="button" class="btn btn--line" data-style-around="${escapeHtml(it.id)}">${sparkSvg} ست‌سازی با این</button>
      </div>
      <p class="cta__note">سایز، پرداخت و ارسال در سایت ${escapeHtml(storeOf(it))} انجام می‌شود.</p>
      ${specs ? `<h3>مشخصات</h3><dl class="specs">${specs}</dl>` : ""}
      ${pair.look.length + pair.accessories.length ? `<h3>ست کنید با</h3><div class="mini-rail">${pair.look.concat(pair.accessories).map(mini).join("")}</div>` : ""}
      ${sim.length ? `<h3>مشابه‌ها</h3><div class="mini-rail">${sim.map(mini).join("")}</div>` : ""}`;
    pdp.hidden = false;
    $(".pdp__panel").scrollTop = 0;
    $(".pdp__media").scrollLeft = 0;
    $(".pdp__back").focus();
  }
  function closePdp() { if (!pdp.hidden) pdp.hidden = true; }

  /* ============================================================ علاقه‌مندی و تاریخچه */

  function remember(q) {
    state.history = [q].concat(state.history.filter((x) => x !== q)).slice(0, 20);
    store.set("history", state.history);
  }
  function counts(bump) {
    const w = $('[data-count="wish"]');
    w.hidden = !state.wish.size; w.textContent = E.faNum(state.wish.size);
    if (bump) { w.classList.remove("bump"); void w.offsetWidth; w.classList.add("bump"); }
  }
  function toggleWish(id, btn) {
    if (state.wish.has(id)) state.wish.delete(id); else state.wish.add(id);
    store.set("wish", Array.from(state.wish));
    $$(`[data-wish="${CSS.escape(id)}"]`).forEach((b) => b.setAttribute("aria-pressed", String(state.wish.has(id))));
    if (btn) { btn.classList.remove("pop"); void btn.offsetWidth; btn.classList.add("pop"); }
    counts("wish");
  }
  let toastT;
  function toast(msg) {
    const t = $(".toast");
    t.textContent = msg; t.hidden = false;
    clearTimeout(toastT);
    toastT = setTimeout(() => { t.hidden = true; }, 2400);
  }

  const drawer = $("#drawer"), scrim = $(".scrim");
  let lastFocus = null;
  function openDrawer(kind) {
    lastFocus = document.activeElement;
    const title = { menu: "منو", account: "حساب کاربری", history: "جست‌وجوهای شما", wish: "علاقه‌مندی‌ها" }[kind];
    let html = "";
    if (kind === "menu") {
      const stores = Object.entries(E.stores());
      html = `<ul class="list"><li><button type="button" class="row" data-action="home">صفحه‌ی اول <span aria-hidden="true">←</span></button></li>
        <li><button type="button" class="row" data-open="history">جست‌وجوهای شما <span aria-hidden="true">←</span></button></li>
        <li><button type="button" class="row" data-open-tailor>دوخت سفارشی با الهام از پینترست <span aria-hidden="true">←</span></button></li></ul>
        <h3 class="drawer__sub">فروشگاه‌ها</h3>
        <ul class="list list--stores">${stores.map(([k, s]) => `<li>${s.domain ? `<a href="https://${escapeHtml(s.domain)}" target="_blank" rel="noopener">` : "<span class=\"row\">"}${escapeHtml(s.name)}<small>${E.faNum(s.count)} محصول</small>${s.domain ? "</a>" : "</span>"}</li>`).join("")}</ul>
        <p class="drawer__note" style="margin-top:22px">${escapeHtml(SITE.name)} فروشگاه نیست؛ استایلیست است. موقعیتتان را با یک جمله بنویسید، مثلاً «فردا مصاحبه‌ی کاری دارم و یه مانتو ساده می‌خوام که مشکی نباشه»؛ در ${E.faNum(state.total)} محصول از ${E.faNum(stores.length)} فروشگاه می‌گردیم، استایل کامل در سایز و بودجه‌ی شما می‌چینیم و خرید در سایت همان فروشگاه انجام می‌شود.</p>`;
    } else if (kind === "account") {
      html = auth.user ? `<p class="me-phone"><bdi dir="ltr">${prettyPhone(auth.user.phone)}</bdi></p>${profileCard() || `<p class="drawer__empty">هنوز مشخصات استایلی ثبت نکرده‌اید؛ با اولین درخواست پرسیده می‌شود.</p>`}
        ${ordersHtml()}
        <button type="button" class="btn btn--line" style="width:100%;margin-top:18px" data-action="logout">خروج از حساب</button>`
        : `<p class="drawer__empty">وارد نشده‌اید. با اولین درخواست، ورود با شماره موبایل خواسته می‌شود.</p><button type="button" class="btn btn--ink" style="width:100%" data-action="login">ورود یا ثبت‌نام</button>${ordersHtml()}`;
    } else if (kind === "history") {
      html = state.history.length ? `<ul class="list">${state.history.map((q) => `<li><button type="button" class="row" data-ask="${escapeHtml(q)}">${escapeHtml(q)}<span aria-hidden="true">←</span></button></li>`).join("")}</ul>` : `<p class="drawer__empty">هنوز چیزی نپرسیده‌اید.</p>`;
    } else if (kind === "wish") {
      const items = Array.from(state.wish).map(E.get).filter(Boolean);
      html = items.length ? `<div class="grid">${items.map((it, i) => card(it, { i, under: true }).replace("card reveal", "card")).join("")}</div>` : `<p class="drawer__empty">با زدن ♡ روی هر محصول، آن را این‌جا نگه دارید.</p>`;
    }
    $("#drawer-title").textContent = title;
    $(".drawer__body").innerHTML = html;
    drawer.hidden = false; scrim.hidden = false;
    $("[data-close]", drawer).focus();
  }
  function profileCard() {
    const p = state.profile, a = [];
    if ((p.style || []).length) a.push(p.style.map((v) => ({ classic: "کلاسیک", minimal: "مینیمال", casual: "کژوال", sport: "اسپرت", trendy: "ترند", street: "خیابانی" })[v]).join("، "));
    if ((p.likeColors || []).length) a.push("رنگ‌ها: " + p.likeColors.map(E.colorLabel).join("، "));
    if ((p.avoidColors || []).length) a.push("نه " + p.avoidColors.map(E.colorLabel).join("، "));
    if (p.height) { const sz = E.sizeFor(state.gender, p.height, p.weight); a.push(E.faNum(p.height) + " سانت · " + E.faNum(p.weight) + " کیلو" + (sz ? " · سایز " + sz.letter + "\u200f" : "")); }
    if (p.age) a.push(E.ageLabel(p.age));
    if (p.skin) a.push({ fair: "پوست روشن", tan: "پوست گندمی", olive: "پوست سبزه" }[p.skin]);
    if (!a.length) return "";
    return `<div class="me-card"><h3>مشخصات استایل من</h3><p>${a.map(escapeHtml).join(" · ")}</p><button type="button" class="q__link" data-action="forget-profile">پاک کردن</button></div>`;
  }
  function closeDrawer() { if (drawer.hidden) return; drawer.hidden = true; scrim.hidden = true; if (lastFocus) lastFocus.focus(); }

  /* ============================================================ دوخت سفارشی با الهام از پینترست */

  // کاربر دقیق می‌نویسد چه لباسی می‌خواهد ← نمونه‌ها از پینترست ← انتخاب ← «سفارش به خیاط» ← اندازه‌ها ← ثبت.
  // با سرور: جست‌وجوی زنده (api/pins، عکس‌ها از راه سرور) و ثبت سفارش روی سرور.
  // بدون سرور (فایل تک‌فایلی یا index.html): نمونه‌های ازپیش‌گرفته‌ی data/pins.js و ثبت در همین مرورگر.
  const tailorEl = $(".tailor");
  const T = { step: "ask", text: "", q: null, pins: [], pick: -1, designer: false, offline: false, busy: false, form: {}, order: null };
  const TAILOR_EXAMPLES = ["پیراهن مجلسی بلند یقه قایقی با آستین پفی، ساتن زرشکی", "مانتو کتی کرم از جنس لینن", "لباس مجلسی پوشیده با آستین بلند و گیپور",
    "کت و دامن طوسی برای محل کار", "پیراهن میدی گل‌دار با آستین پفی", "کت و شلوار مردانه سرمه‌ای"];
  const MEASURE_GROUPS = [
    ["کلی", [["height", "قد"], ["weight", "وزن", "کیلوگرم"], ["length", "قد لباس"]]],
    ["بالاتنه", [["shoulder", "عرض شانه"], ["chest", "دور سینه"], ["waist", "دور کمر"], ["hip", "دور باسن"], ["torso", "قد بالاتنه (تا کمر)"], ["neck", "دور یقه"]]],
    ["آستین", [["sleeve", "قد آستین"], ["arm", "دور بازو"], ["wrist", "دور مچ"]]],
    ["شلوار و دامن", [["rise", "فاق"], ["pants", "قد شلوار"], ["thigh", "دور ران"], ["hem", "دمپا"]]],
  ];
  const FABRICS = ["حریر", "ساتن", "کرپ", "مخمل", "گیپور و تور", "لینن", "نخی", "ابریشم", "تافته", "پشمی و فاستونی", "جین", "به پیشنهاد خیاط"];
  const FABRIC_OF = { "حریر": "حریر", "ساتن": "ساتن", "کرپ": "کرپ", "مخمل": "مخمل", "گیپور": "گیپور و تور", "تور": "گیپور و تور", "لینن": "لینن", "کتان": "لینن", "نخی": "نخی", "ابریشم": "ابریشم", "تافته": "تافته", "پشمی": "پشمی و فاستونی", "جین": "جین" };
  const COLOR_WORDS = ["مشکی", "سفید", "کرم", "طوسی", "سرمه ای", "آبی", "آبی آسمانی", "فیروزه ای", "قهوه ای", "شکلاتی", "سبز", "سبز یشمی", "زیتونی", "قرمز", "زرشکی", "صورتی", "گلبهی", "یاسی", "بنفش", "زرد", "خردلی", "طلایی", "نقره ای", "نارنجی"];
  const BUDGETS = [[0, "فرقی نمی‌کنه"], [3e6, "تا ۳ میلیون"], [6e6, "تا ۶ میلیون"], [10e6, "تا ۱۰ میلیون"], [20e6, "تا ۲۰ میلیون"], [40e6, "تا ۴۰ میلیون"]];
  const DELIVERY = ["یک هفته", "دو هفته", "سه هفته", "یک ماه", "فرقی نمی‌کند"];
  const ORDER_STATUS = { received: "ثبت شد؛ خیاط برای هماهنگی تماس می‌گیرد", sewing: "در حال دوخت", ready: "آماده‌ی تحویل", delivered: "تحویل شد" };

  const pinThumb = (p) => p.thumb || p.img;
  const orderThumb = (o) => o.thumb || (o.design && o.design.img ? (auth.server ? "api/pinimg?u=" + encodeURIComponent(o.design.img) : o.design.img) : "");

  function openTailor(text, opts) {
    closeDrawer(); closePdp(); toggleMenu(false);
    if (!(opts && opts.noPush) && hist.v !== "tailor") hist.push({ v: "tailor", sid: body.classList.contains("is-results") ? state.sid : null });
    if (text != null) { T.text = text; T.step = "ask"; }
    if (T.step === "done") Object.assign(T, { step: "ask", text: "", pins: [], pick: -1, designer: false, form: {}, order: null });
    tailorEl.hidden = false;
    body.classList.add("is-tailor");
    wall.pause();
    paintTailor();
  }
  function closeTailor() {
    if (tailorEl.hidden) return;
    readForm();
    tailorEl.hidden = true;
    body.classList.remove("is-tailor");
    if (body.classList.contains("is-home")) wall.play();
  }

  function paintTailor() {
    $$(".tailor__steps li", tailorEl).forEach((li) => {
      const order = ["ask", "pins", "form", "done"];
      li.classList.toggle("is-on", li.dataset.s === T.step);
      li.classList.toggle("is-done", order.indexOf(li.dataset.s) < order.indexOf(T.step));
    });
    const el = $("[data-tailor-body]", tailorEl);
    if (T.step === "ask") el.innerHTML = askHtml();
    else if (T.step === "pins") el.innerHTML = pinsHtml();
    else if (T.step === "form") el.innerHTML = formHtml();
    else el.innerHTML = doneHtml();
    tailorEl.scrollTop = 0;
    const f = $("textarea, input", el);
    if (T.step === "ask" && f) f.focus({ preventScroll: true });
  }

  function askHtml() {
    return `<div class="t-ask">
      <h2 class="t-title">لباس دلخواهت را دقیق بنویس</h2>
      <p class="t-lead">نوع لباس، یقه، آستین، قد، جنس، رنگ و مناسبت را بگو. چند نمونه از پینترست نشانت می‌دهیم؛ یکی را انتخاب کن تا خیاط همان را در اندازه‌ی تو بدوزد.</p>
      <form data-tailor-ask>
        <textarea class="t-input" name="text" rows="3" maxlength="400" placeholder="مثلاً: پیراهن مجلسی بلند یقه قایقی با آستین پفی، ساتن زرشکی برای عروسی">${escapeHtml(T.text)}</textarea>
        <div class="t-actions"><button type="submit" class="btn btn--ink">نمایش نمونه‌ها</button></div>
      </form>
      <p class="t-sub">چند نمونه برای شروع</p>
      <div class="chips">${TAILOR_EXAMPLES.map((x) => `<button type="button" class="chip chip--ink" data-tailor-example="${escapeHtml(x)}">${escapeHtml(x)}</button>`).join("")}</div>
    </div>`;
  }

  function pinsHtml() {
    const q = T.q || { labels: [], en: "" };
    const chips = q.labels.map((l) => `<span class="u-chip">${escapeHtml(l)}</span>`).join("");
    let grid;
    if (T.busy) grid = `<p class="t-wait"><span class="spinner spinner--ink"></span> در حال آوردن نمونه‌ها از پینترست…</p>`;
    else if (!T.pins.length) grid = `<p class="t-empty">نمونه‌ای پیدا نشد. توضیح را کمی ساده‌تر بنویسید (مثلاً فقط نوع لباس، یقه و آستین)، یا بدون نمونه با طراح ما سفارش بدهید.</p>`;
    else grid = `<div class="pins">${T.pins.map((p, i) => `<button type="button" class="pin${i === T.pick ? " is-on" : ""}" data-pin="${i}" aria-pressed="${i === T.pick}" aria-label="${escapeHtml(p.title || "نمونه‌ی " + E.faNum(i + 1))}">
        <img src="${escapeHtml(pinThumb(p))}" alt="" loading="lazy" decoding="async" style="${p.w && p.h ? `aspect-ratio:${p.w}/${p.h};` : ""}${p.color ? `background:${escapeHtml(p.color)}` : ""}">
        <span class="pin__check" aria-hidden="true">✓</span></button>`).join("")}</div>`;
    const ok = T.pick >= 0 || T.designer;
    return `<div class="t-pins">
      <div class="t-said"><span class="t-said__label">شما نوشتید</span><p class="t-said__text">«${escapeHtml(T.text)}»</p>
        ${chips ? `<div class="understood">${chips}</div>` : ""}
        <p class="t-said__q">جست‌وجو در پینترست: <bdi dir="ltr">${escapeHtml(q.en)}</bdi>${T.offline && T.pins.length ? ` · نمونه‌های آماده‌ی «${escapeHtml(T.pins[0].fromSet || "")}» (جست‌وجوی زنده فقط با سرور)` : ""}</p>
        <button type="button" class="q__link q__link--ink" data-tailor-step="ask">تغییر توضیح</button></div>
      ${grid}
      <div class="t-bar">
        <p class="t-bar__note">طراح لباس هم داریم که نزدیک‌تر به خواسته‌ی شما طراحی می‌کند.</p>
        <button type="button" class="pill-btn" data-tailor-designer aria-pressed="${T.designer}">${T.designer ? "✓ طراح هم روی طرح کار کند" : "+ طراح هم روی طرح کار کند"}</button>
        <button type="button" class="btn btn--ink" data-tailor-step="form"${ok ? "" : " disabled"}>سفارش به خیاط</button>
      </div>
    </div>`;
  }

  function formHtml() {
    const p = state.profile, f = T.form, pick = T.pins[T.pick];
    const m = Object.assign({ height: p.height || "", weight: p.weight || "" }, f.measures || {});
    const labels = (T.q && T.q.labels) || [];
    const fabric = f.fabric != null ? f.fabric : (labels.map((l) => FABRIC_OF[l]).find(Boolean) || "");
    const color = f.color != null ? f.color : (labels.find((l) => COLOR_WORDS.includes(l)) || "");
    const field = ([k, label, unit]) => `<label class="mfield"><span>${escapeHtml(label)}</span><input type="number" inputmode="decimal" min="1" max="299" step="0.5" name="m_${k}" value="${escapeHtml(m[k] == null ? "" : m[k])}"${k === "height" || k === "weight" ? " required" : ""}><small>${unit || "سانتی‌متر"}</small></label>`;
    return `<div class="t-form">
      <aside class="t-design">
        ${pick ? `<img src="${escapeHtml(pick.large || pinThumb(pick))}" alt="${escapeHtml(pick.title || "")}">` : `<div class="t-design__none">بدون نمونه؛ طراح ما بر اساس توضیح شما طرح می‌زند.</div>`}
        <p class="t-design__text">«${escapeHtml(T.text)}»</p>
        ${T.designer ? `<p class="t-design__tag">✓ طراح لباس هم روی طرح کار می‌کند</p>` : ""}
        <button type="button" class="q__link q__link--ink" data-tailor-step="pins">انتخاب نمونه‌ی دیگر</button>
      </aside>
      <form class="t-fields" data-tailor-form novalidate>
        <h2 class="t-title">اندازه‌ها برای خیاط</h2>
        <p class="t-lead">به سانتی‌متر. اندازه‌ای را که نمی‌دانید خالی بگذارید؛ خیاط برای اندازه‌گیری دقیق تماس می‌گیرد. قد و وزن لازم است.</p>
        ${MEASURE_GROUPS.map(([title, fields]) => `<fieldset class="mgroup"><legend>${escapeHtml(title)}</legend>${fields.map(field).join("")}</fieldset>`).join("")}
        <fieldset class="mgroup mgroup--wide"><legend>پارچه، بودجه و زمان</legend>
          <label class="ofield"><span>جنس پارچه</span><input name="fabric" list="t-fabrics" maxlength="80" value="${escapeHtml(fabric)}" placeholder="مثلاً ساتن"></label>
          <label class="ofield"><span>رنگ پارچه</span><input name="color" list="t-colors" maxlength="60" value="${escapeHtml(color)}" placeholder="مثلاً زرشکی"></label>
          <label class="ofield"><span>بودجه</span><select name="budget">${BUDGETS.map(([v, l]) => `<option value="${v}"${+f.budget === v ? " selected" : ""}>${l}</option>`).join("")}</select></label>
          <label class="ofield"><span>زمان تحویل</span><select name="deliver">${DELIVERY.map((d) => `<option${f.deliver === d ? " selected" : ""}>${d}</option>`).join("")}</select></label>
          <label class="ofield ofield--wide"><span>توضیحات برای خیاط</span><textarea name="notes" rows="3" maxlength="1000" placeholder="مثلاً آستین کمی بلندتر از نمونه، آستر داشته باشد…">${escapeHtml(f.notes || "")}</textarea></label>
        </fieldset>
        <datalist id="t-fabrics">${FABRICS.map((x) => `<option value="${x}">`).join("")}</datalist>
        <datalist id="t-colors">${COLOR_WORDS.map((x) => `<option value="${x}">`).join("")}</datalist>
        <p class="login__err t-err" data-tailor-err role="alert"></p>
        <div class="t-actions"><button type="submit" class="btn btn--ink">ثبت سفارش</button>${auth.user ? "" : `<small>برای ثبت، با شماره موبایل وارد می‌شوید.</small>`}</div>
      </form>
    </div>`;
  }

  function doneHtml() {
    const o = T.order;
    return `<div class="t-done">
      <span class="t-done__mark" aria-hidden="true">✓</span>
      <h2 class="t-title">سفارش شما ثبت شد</h2>
      <p class="t-lead">شماره‌ی سفارش: <bdi dir="ltr">${escapeHtml(o.id)}</bdi>. ${escapeHtml(ORDER_STATUS[o.status] || "")}${o.designer ? "؛ طراح لباس هم طرح نهایی را با شما هماهنگ می‌کند." : "."}</p>
      ${auth.server ? "" : `<p class="t-sub">این نسخه‌ی پیش‌نمایش است؛ سفارش فقط در همین مرورگر نگه داشته شد.</p>`}
      <div class="t-actions"><button type="button" class="btn btn--line" data-open="account">سفارش‌های من</button><button type="button" class="btn btn--ink" data-tailor-close>بازگشت</button></div>
    </div>`;
  }

  async function findPins() {
    const q = E.tailorQuery(T.text);
    Object.assign(T, { q, pins: [], pick: -1, offline: false, busy: true, step: "pins" });
    paintTailor();
    let items = null;
    if (location.protocol !== "file:") {
      try {
        const r = await fetch("api/pins?q=" + encodeURIComponent(q.en), { cache: "no-store" });
        if (r.ok) items = (await r.json()).items;
      } catch (e) { /* بدون سرور */ }
    }
    if (!items || !items.length) { items = offlinePins(q.en); T.offline = true; }
    T.pins = items || [];
    T.busy = false;
    if (T.step === "pins") paintTailor();
  }
  // نزدیک‌ترین دسته از نمونه‌های ازپیش‌گرفته (هم‌پوشانی واژه‌های انگلیسی)
  function offlinePins(en) {
    const sets = (window.RG_PINS && window.RG_PINS.sets) || [];
    const words = new Set(en.split(" ").concat(en.split(" ").join(" ").split(/\s+/)));
    let best = null, bestS = 0;
    for (const set of sets) {
      const w = set.en.split(/\s+/);
      const sc = w.filter((x) => words.has(x)).length / Math.sqrt(w.length);
      if (sc > bestS) { bestS = sc; best = set; }
    }
    return best ? best.items.map((p) => Object.assign({ fromSet: best.fa }, p)) : [];
  }

  function readForm() {
    const f = $("[data-tailor-form]", tailorEl);
    if (!f || T.step !== "form") return;
    const measures = {};
    MEASURE_GROUPS.forEach(([, fields]) => fields.forEach(([k]) => { const v = parseFloat(toLatin(f["m_" + k].value)); if (v > 0) measures[k] = v; }));
    T.form = { measures, fabric: f.fabric.value.trim(), color: f.color.value.trim(), budget: +f.budget.value, deliver: f.deliver.value, notes: f.notes.value.trim() };
  }

  async function submitOrder() {
    readForm();
    const m = T.form.measures || {};
    const err = $("[data-tailor-err]", tailorEl);
    if (!m.height || !m.weight) { if (err) err.textContent = "لطفاً قد و وزن را بنویسید."; return; }
    if (!auth.user) {
      // اول ورود؛ بعد همین فرم دوباره باز و سفارش ثبت می‌شود
      tailorEl.hidden = true; body.classList.remove("is-tailor");
      const back = state.last ? "is-results" : "is-home";
      return requireLogin("ثبت سفارش دوخت", () => { body.classList.add(back); openTailor(); submitOrder(); });
    }
    if (T.busy) return;
    T.busy = true;
    const pick = T.pins[T.pick];
    const order = {
      request: T.text, designer: T.designer, measures: m, fabric: T.form.fabric, color: T.form.color, budget: T.form.budget, deliver: T.form.deliver, notes: T.form.notes,
      design: pick ? { id: pick.id, title: pick.title, img: pick.img && /^https:/.test(pick.img) ? pick.img : null, big: pick.big || null, query: T.q.en, source: pick.source || null } : { query: T.q ? T.q.en : "" },
    };
    try {
      let saved;
      if (auth.server) saved = (await auth.post("api/orders", order)).order;
      else saved = Object.assign({ id: "RG-" + new Date().toISOString().slice(2, 10).replace(/-/g, "") + "-" + Math.floor(1000 + Math.random() * 9000), status: "received", createdAt: new Date().toISOString() }, order);
      saved.thumb = pick ? pinThumb(pick) : "";
      state.orders = [saved].concat(state.orders.filter((x) => x.id !== saved.id)).slice(0, 100);
      store.set("orders", state.orders);
      T.order = saved;
      T.step = "done";
      paintTailor();
    } catch (e) {
      if (err) err.textContent = e.message || "ثبت نشد؛ دوباره امتحان کنید.";
    } finally { T.busy = false; }
  }

  function ordersHtml() {
    if (!state.orders.length) return "";
    return `<h3 class="drawer__sub">سفارش‌های دوخت من</h3><ul class="orders">${state.orders.map((o) => `<li class="order">
      ${orderThumb(o) ? `<img src="${escapeHtml(orderThumb(o))}" alt="" loading="lazy">` : `<span class="order__none">✂</span>`}
      <div><b>${escapeHtml(o.request || (o.design && o.design.title) || "سفارش دوخت")}</b>
      <small>${escapeHtml(ORDER_STATUS[o.status] || o.status || "")}</small>
      <small><bdi dir="ltr">${escapeHtml(o.id)}</bdi> · ${escapeHtml(new Date(o.createdAt).toLocaleDateString("fa-IR"))}${o.designer ? " · با طراح" : ""}</small></div></li>`).join("")}</ul>`;
  }

  tailorEl.addEventListener("submit", (e) => {
    e.preventDefault();
    if (e.target.closest("[data-tailor-ask]")) {
      const text = e.target.text.value.trim();
      if (text.length < 3) return toast("اول بنویسید چه لباسی می‌خواهید");
      T.text = text;
      return findPins();
    }
    if (e.target.closest("[data-tailor-form]")) return submitOrder();
  });

  /* ============================================================ رویدادها */

  document.addEventListener("click", (e) => {
    const t = e.target;
    let el;
    if ((el = t.closest("[data-open-tailor]"))) { e.preventDefault(); return openTailor(el.dataset.openTailor || null); }
    if (t.closest("[data-tailor-close]")) return back("tailor", closeTailor);
    if ((el = t.closest("[data-tailor-example]"))) { T.text = el.dataset.tailorExample; return findPins(); }
    if ((el = t.closest("[data-pin]"))) {
      const i = +el.dataset.pin;
      T.pick = T.pick === i ? -1 : i;
      $$("[data-pin]", tailorEl).forEach((b) => { const on = +b.dataset.pin === T.pick; b.classList.toggle("is-on", on); b.setAttribute("aria-pressed", String(on)); });
      $("[data-tailor-step='form']", tailorEl).disabled = !(T.pick >= 0 || T.designer);
      return;
    }
    if ((el = t.closest("[data-tailor-designer]"))) {
      T.designer = !T.designer;
      el.setAttribute("aria-pressed", String(T.designer));
      el.textContent = (T.designer ? "✓" : "+") + " طراح هم روی طرح کار کند";
      $("[data-tailor-step='form']", tailorEl).disabled = !(T.pick >= 0 || T.designer);
      return;
    }
    if ((el = t.closest("[data-tailor-step]"))) { readForm(); T.step = el.dataset.tailorStep; return paintTailor(); }
    if ((el = t.closest("[data-wish]"))) { e.stopPropagation(); return toggleWish(el.dataset.wish, el); }
    if ((el = t.closest("[data-drop]"))) {
      const key = el.dataset.drop;
      state.drops.push(key);
      if (key === "gender") { state.gender = ""; store.set("gender", ""); paintGender(); }
      el.closest(".u-chip").classList.add("is-leaving");
      return ask(state.lastQuery || "", { rerun: true });
    }
    if (t.closest("[data-revisit]") && state.lastQuery) { if (!openConsult(state.lastQuery, { prev: state.basePrev, req: state.req, revisit: true })) toast("همه‌چیز را در جمله‌تان گفته بودید"); return; }
    if (t.closest("[data-action='forget-profile']")) { state.profile = { done: [] }; saveProfile(); toast("مشخصات استایل شما پاک شد"); return openDrawer("menu"); }
    if ((el = t.closest("[data-style-around]"))) {
      const id = el.dataset.styleAround, it = E.get(id);
      closeDrawer(); closePdp();
      return requireLogin("ست‌سازی با «" + (it ? E.shortName(it) : "") + "»", () => styleAround(id));
    }
    if (t.closest("[data-action='logout']")) { auth.logout(); toast("از حساب خارج شدید"); return closeDrawer(); }
    if (t.closest("[data-action='login']")) { closeDrawer(); return requireLogin("ورود به " + SITE.name, () => { if (!state.last) goHome(); else body.classList.add("is-results"); }); }
    if ((el = t.closest("[data-ask]"))) { closeDrawer(); state.drops = []; input.value = el.dataset.ask; syncInput(); return ask(el.dataset.ask); }
    if ((el = t.closest("[data-open-item]"))) { closeDrawer(); return openPdp(el.dataset.openItem); }
    if ((el = t.closest("[data-action='home']"))) { e.preventDefault(); closeDrawer(); return goHome(); }
    if ((el = t.closest("[data-open]"))) return openDrawer(el.dataset.open);
    if (t.closest("[data-close]") || t === scrim) return closeDrawer();
    if (t.closest("[data-close-pdp]")) return back("pdp", closePdp);
    if ((el = t.closest("[data-step-toggle]"))) {
      const i = +el.dataset.stepToggle, s = state.story[i];
      s.on = !s.on;
      $(`.step[data-step="${i}"]`).classList.toggle("is-off", !s.on);
      el.setAttribute("aria-pressed", String(s.on));
      el.textContent = s.on ? "✓ در استایل" : "+ اضافه به استایل";
      paintStory(i, true);
      return saveView();
    }
    if ((el = t.closest("[data-step-swap]"))) return swapStep(+el.dataset.stepSwap);
    if ((el = t.closest("[data-step-jump]"))) {
      const step = $(`.step[data-step="${el.dataset.stepJump}"]`);
      if (step) step.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "center" });
      return;
    }
    if (t.closest("[data-more-btn]")) {
      const grid = $("[data-more]");
      const shown = $$(".card", grid).length;
      grid.insertAdjacentHTML("beforeend", state.rest.slice(shown, shown + 8).map((it, i) => card(it, { i: i % 4, under: true, hover: true })).join(""));
      observeReveals();
      if (shown + 8 >= state.rest.length) t.closest("[data-more-btn]").remove();
      return;
    }
    if (!menu.hidden && !t.closest(".prompt-wrap")) toggleMenu(false);
  });

  document.addEventListener("keydown", (e) => {
    if (C && e.key === "Enter" && !e.target.closest("button")) { const n = $("[data-q-next]", qEl); if (n) { e.preventDefault(); n.click(); } return; }
    if (e.key === "Escape") {
      if (!drawer.hidden) return closeDrawer();
      if (!tailorEl.hidden) return back("tailor", closeTailor);
      if (!pdp.hidden) return back("pdp", closePdp);
      if (!menu.hidden) return toggleMenu(false);
    }
    if (e.key === "/" && document.activeElement !== input && !/INPUT|TEXTAREA/.test(document.activeElement.tagName)) { e.preventDefault(); input.focus(); }
  });

  /* ============================================================ شروع */

  // صفحه‌ی اول فقط نام سایت را دارد (روی دیوار محصولات)
  $$("[data-site-name]").forEach((el) => (el.textContent = SITE.name));
  $("[data-site-legal]").textContent = SITE.legal;
  wall.init(state.gender);
  paintWallCount(null, "");
  paintUser();
  renderIdeas();
  requestAnimationFrame(paintGender);
  counts();
  syncInput();
  // برگشت از سایت فروشگاه (Back) یا بارگذاری دوباره: همان صفحه‌ای که کاربر رویش بود
  const st0 = history.state;
  if (st0 && st0.v && st0.v !== "home") {
    // برگشت باید فوری باشد، بدون محو شدن پس‌زمینه‌ی تیره‌ی صفحه‌ی اول
    body.classList.add("is-instant");
    setTimeout(() => body.classList.remove("is-instant"), 700);
    if (showBase(st0)) {
      if (st0.v === "pdp") openPdp(st0.id, { noPush: true });
      if (st0.v === "tailor") openTailor(null, { noPush: true });
    } else hist.replace({ v: "home" });
    document.documentElement.classList.remove("is-returning");
  } else {
    hist.replace({ v: "home" });
    // پیوند مستقیم: index.html?q=…
    const qp = new URLSearchParams(location.search).get("q");
    if (qp) { input.value = qp; ask(qp); }
  }
})();
