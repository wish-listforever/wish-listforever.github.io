"use strict";

const SB_DIRECT = "https://xzoroyjvrvhmlxbuvoje.supabase.co";
const SB_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inh6b3JveWp2cnZobWx4YnV2b2plIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTMyNTk2OTgsImV4cCI6MjEwODgzNTY5OH0.fr8o0kwYtPt5gxKInJVWfo4N2a_HNBt5SkoJIh5YoQE";
// With netlify.toml deployed, requests can go through /sb; set window.SB_PROXY to use it.
const sb = supabase.createClient(window.SB_PROXY ? location.origin + "/sb" : SB_DIRECT, SB_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
  realtime: { params: { eventsPerSecond: 1 } },
});

const CATS = [
  { k: "gift", tab: "Подарки", one: "Подарок", done: "Куплено" },
  { k: "food", tab: "Покушать", one: "Покушать", done: "Сходили" },
  { k: "walk", tab: "Погулять", one: "Погулять", done: "Сходили" },
  { k: "event", tab: "Мероприятия", one: "Мероприятие", done: "Сходили" },
];
const CAT = Object.fromEntries(CATS.map(c => [c.k, c]));
const IMP = { 3: "очень хочу", 2: "хочу", 1: "было бы неплохо" };
const AV_COLORS = ["#c2185b", "#e0567a", "#4f74a8", "#7b5ea7", "#2e7d5b", "#d9822b", "#00838f"];

const S = {
  me: null, profile: null, friendships: [], people: {}, sel: null,
  cat: "all", min: null, max: null, wishes: [], loadingWishes: false,
};

const $app = document.getElementById("app");
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const rub = n => Number(n).toLocaleString("ru-RU") + " ₽";
const initial = name => (name || "?").trim().charAt(0).toUpperCase() || "?";
function avColor(id) { let h = 0; for (const c of String(id)) h = (h * 31 + c.charCodeAt(0)) >>> 0; return AV_COLORS[h % AV_COLORS.length]; }
function safeUrl(u) {
  u = (u || "").trim(); if (!u) return "";
  if (!/^https?:\/\//i.test(u)) u = "https://" + u;
  try { const x = new URL(u); return /^https?:$/.test(x.protocol) ? x.href : ""; } catch { return ""; }
}
function nameOf(id) { if (id === S.me?.id) return S.profile?.name || "Я"; return S.people[id]?.name || "Друг"; }
function friendIds() {
  return S.friendships.filter(f => f.status === "accepted").map(f => f.requester === S.me.id ? f.addressee : f.requester);
}

let toastTimer;
function toast(msg) {
  document.querySelector(".toast")?.remove();
  const t = document.createElement("div"); t.className = "toast"; t.textContent = msg; t.setAttribute("role", "status");
  document.body.appendChild(t); clearTimeout(toastTimer); toastTimer = setTimeout(() => t.remove(), 3500);
}
function ruError(e) {
  const m = (e && (e.message || e.error_description || e)) + "";
  if (/Invalid login credentials/i.test(m)) return "Неверная почта или пароль.";
  if (/already registered|already exists/i.test(m)) return "Эта почта уже зарегистрирована. Попробуй войти.";
  if (/Password should be at least/i.test(m)) return "Пароль должен быть не короче 6 символов.";
  if (/rate limit|too many/i.test(m)) return "Слишком много попыток. Подожди минуту и попробуй снова.";
  if (/Email not confirmed/i.test(m)) return "Почта ещё не подтверждена. Открой письмо и нажми на ссылку.";
  if (/valid email|invalid.*email/i.test(m)) return "Проверь адрес почты.";
  if (/Failed to fetch|NetworkError|Load failed/i.test(m)) return "Нет связи с сервером. Проверь интернет и попробуй ещё раз.";
  return "Что-то пошло не так: " + m;
}

// ---------- boot ----------
(function rememberAddCode() {
  const code = new URLSearchParams(location.search).get("add");
  if (code) { try { sessionStorage.setItem("pendingAdd", code); } catch {} history.replaceState(null, "", location.pathname); }
})();

function rememberLogin() { try { localStorage.setItem("hadLogin", "1"); } catch {} }
async function boot() {
  const { data } = await sb.auth.getSession();
  if (data.session) { S.me = data.session.user; rememberLogin(); await loadAll(); }
  else renderAuth();
}
sb.auth.onAuthStateChange((ev, session) => {
  if (ev === "SIGNED_OUT") { S.me = null; S.profile = null; renderAuth(); }
  if (ev === "SIGNED_IN" && session && S.me?.id !== session.user.id) { S.me = session.user; rememberLogin(); loadAll(); }
});

async function loadAll() {
  $app.innerHTML = `<div class="loading">Загружаю…</div>`;
  try {
    let { data: prof, error } = await sb.from("profiles").select("*").eq("id", S.me.id).maybeSingle();
    if (error) throw error;
    S.profile = prof;
    await loadFriends();
    S.sel = S.sel && (S.sel === S.me.id || friendIds().includes(S.sel)) ? S.sel : S.me.id;
    renderMain();
    await loadWishes();
    let pending = null; try { pending = sessionStorage.getItem("pendingAdd"); sessionStorage.removeItem("pendingAdd"); } catch {}
    if (pending && pending.toUpperCase() !== S.profile.code) await addByCode(pending, true);
    if (S.profile && !S.profile.onboarded) { seenNews(); openGift(openTour); }
    else if (!seenNews()) openNews();
  } catch (e) {
    $app.innerHTML = `<div class="auth"><div class="auth-box"><div class="logo">Наши хотелки</div><p class="err">${esc(ruError(e))}</p><button class="btn" id="retry">Попробовать снова</button></div></div>`;
    document.getElementById("retry").onclick = loadAll;
  }
}

async function loadFriends() {
  const { data: fr, error } = await sb.from("friendships").select("*");
  if (error) throw error;
  S.friendships = fr || [];
  const { data: ps, error: e2 } = await sb.from("profiles").select("id,name");
  if (e2) throw e2;
  S.people = Object.fromEntries((ps || []).map(p => [p.id, p]));
}

async function loadWishes() {
  const who = S.sel;
  S.loadingWishes = true; renderGrid();
  const { data, error } = await sb.from("wishes").select("*").eq("owner", who).order("created_at", { ascending: false });
  if (who !== S.sel) return;
  S.loadingWishes = false;
  if (error) { toast(ruError(error)); S.wishes = []; }
  else S.wishes = data || [];
  const own = S.wishes.filter(w => w.owner === S.me.id && w.visibility === "some");
  if (own.length) {
    const ids = own.map(w => w.id);
    const { data: v } = await sb.from("wish_viewers").select("wish_id,user_id").in("wish_id", ids);
    const by = {}; (v || []).forEach(r => (by[r.wish_id] ||= []).push(r.user_id));
    S.wishes.forEach(w => { w._viewers = by[w.id] || []; });
  }
  renderGrid();
}

// ---------- auth screen ----------
function knownUser() { try { return !!localStorage.getItem("hadLogin"); } catch { return false; } }
function renderAuth(mode = knownUser() ? "login" : "signup") {
  $app.innerHTML = `
  <div class="auth"><form class="auth-box" id="authForm" method="post" action="#" novalidate>
    <div class="logo">Наши хотелки</div>
    <p>Виш-листы для тебя и твоих близких: подарки, куда сходить покушать, погулять и на какие мероприятия.</p>
    <div class="seg" role="tablist">
      <button type="button" id="m-signup" class="${mode === "signup" ? "on" : ""}">Регистрация</button>
      <button type="button" id="m-login" class="${mode === "login" ? "on" : ""}">Вход</button>
    </div>
    ${mode === "signup" ? `<div class="field"><label for="a-name">Как тебя подписать</label><input id="a-name" name="name" type="text" maxlength="40" autocomplete="nickname" placeholder="Например, Яся" required></div>` : ""}
    <div class="field"><label for="a-email">Почта</label><input id="a-email" name="email" type="email" autocomplete="username" inputmode="email" autocapitalize="off" autocorrect="off" spellcheck="false" placeholder="you@mail.ru" required></div>
    <div class="field"><label for="a-pass">Пароль</label><input id="a-pass" name="password" type="password" autocomplete="${mode === "signup" ? "new-password" : "current-password"}" minlength="6" placeholder="Не меньше 6 символов" required></div>
    <div class="err" id="a-err" aria-live="polite"></div>
    <button class="btn" type="submit" id="a-go">${mode === "signup" ? "Зарегистрироваться" : "Войти"}</button>
  </form></div>`;
  document.getElementById("m-signup").onclick = () => renderAuth("signup");
  document.getElementById("m-login").onclick = () => renderAuth("login");
  document.getElementById("authForm").onsubmit = async ev => {
    ev.preventDefault();
    const err = document.getElementById("a-err"), go = document.getElementById("a-go");
    const email = document.getElementById("a-email").value.trim();
    const password = document.getElementById("a-pass").value;
    const name = mode === "signup" ? document.getElementById("a-name").value.trim() : "";
    err.textContent = "";
    if (mode === "signup" && !name) { err.textContent = "Напиши, как тебя подписать."; return; }
    if (!email || !password) { err.textContent = "Заполни почту и пароль."; return; }
    go.disabled = true;
    try {
      if (mode === "signup") {
        const { data, error } = await sb.auth.signUp({ email, password, options: { data: { name } } });
        if (error) throw error;
        if (!data.session) {
          // Accounts are confirmed on the server right away, so sign in straight after.
          const { error: e2 } = await sb.auth.signInWithPassword({ email, password });
          if (e2) { err.style.color = "var(--ok)"; err.textContent = "Аккаунт создан. Теперь войди с этой почтой и паролем."; go.disabled = false; return; }
        }
      } else {
        const { error } = await sb.auth.signInWithPassword({ email, password });
        if (error) throw error;
      }
    } catch (e) { err.textContent = ruError(e); go.disabled = false; }
  };
}

// ---------- main screen ----------
function renderMain() {
  const incoming = S.friendships.filter(f => f.status === "pending" && f.addressee === S.me.id).length;
  const ids = [S.me.id, ...friendIds()];
  $app.innerHTML = `
  <header class="bar"><div class="wrap">
    <div class="logo">Наши хотелки</div>
    <div class="bar-actions">
      <button class="icon-btn" id="b-friends" type="button">Друзья${incoming ? `<span class="badge">${incoming}</span>` : ""}</button>
      <button class="icon-btn" id="b-help" type="button" aria-label="Подсказки">?</button>
      <button class="icon-btn" id="b-me" type="button" aria-label="Мой профиль" style="padding:0;width:38px"><span class="av" style="background:${avColor(S.me.id)}">${esc(initial(S.profile?.name))}</span></button>
    </div>
  </div></header>
  <main class="wrap">
    ${installHint() ? `<div class="install-hint" id="ih"><span>📱 Поставь «Хотелки» на экран телефона, как приложение</span><button class="btn small" type="button" id="ih-how">Как?</button><button class="x" type="button" id="ih-x" aria-label="Скрыть">×</button></div>` : ""}
    <nav class="people" id="people" aria-label="Чьи хотелки">
      ${ids.map(id => `<button type="button" class="person${id === S.sel ? " on" : ""}" data-p="${id}"><span class="av" style="background:${avColor(id)}">${esc(initial(nameOf(id)))}</span>${id === S.me.id ? "Мои" : esc(nameOf(id))}</button>`).join("")}
      <button type="button" class="person add" id="p-add">+ Добавить друга</button>
    </nav>
    <div class="ctrl">
      <div class="tabs" id="tabs"><button type="button" class="tab all${S.cat === "all" ? " on" : ""}" data-k="all">Все</button>${CATS.map(c => `<button type="button" class="tab${c.k === S.cat ? " on" : ""}" data-k="${c.k}">${c.tab}</button>`).join("")}</div>
      <div class="budget" id="bud"><b>Бюджет</b><label>от<input type="number" inputmode="numeric" min="0" step="100" id="bud-min" placeholder="0" value="${S.min ?? ""}"></label><label>до<input type="number" inputmode="numeric" min="0" step="100" id="bud-max" placeholder="любой" value="${S.max ?? ""}"></label><span>₽</span></div>
    </div>
    <div class="head"><h1 id="title"></h1><span id="sub"></span></div>
    <section class="grid" id="grid" aria-live="polite"></section>
  </main>
  <button class="fab" id="fab" type="button" aria-label="Добавить хотелку">+</button>`;
  document.getElementById("b-friends").onclick = openFriends;
  document.getElementById("p-add").onclick = openFriends;
  document.getElementById("b-help").onclick = openTour;
  document.getElementById("b-me").onclick = openProfile;
  document.getElementById("ih-how")?.addEventListener("click", openInstall);
  document.getElementById("ih-x")?.addEventListener("click", () => { try { localStorage.setItem("ihHidden", "1"); } catch {} document.getElementById("ih").remove(); });
  document.getElementById("fab").onclick = () => openWishForm();
  document.getElementById("people").onclick = e => {
    const b = e.target.closest("[data-p]"); if (!b || b.dataset.p === S.sel) return;
    S.sel = b.dataset.p; S.wishes = [];
    document.querySelectorAll(".person[data-p]").forEach(x => x.classList.toggle("on", x === b));
    loadWishes();
  };
  document.getElementById("tabs").onclick = e => {
    const b = e.target.closest(".tab"); if (!b) return;
    S.cat = b.dataset.k; document.querySelectorAll(".tab").forEach(x => x.classList.toggle("on", x === b)); renderGrid();
  };
  document.getElementById("bud").oninput = () => {
    const num = id => { const v = document.getElementById(id).value.trim(); return v === "" ? null : Math.max(0, +v); };
    S.min = num("bud-min"); S.max = num("bud-max"); renderGrid();
  };
  document.getElementById("grid").onclick = onGridClick;
  renderGrid();
}

function renderGrid() {
  const grid = document.getElementById("grid"); if (!grid) return;
  const mine = S.sel === S.me.id;
  const c = CAT[S.cat] || { tab: "Все" };
  document.getElementById("fab").hidden = !mine;
  document.getElementById("title").textContent = mine ? "Мои хотелки" : "Хотелки: " + nameOf(S.sel);
  if (S.loadingWishes) { document.getElementById("sub").textContent = ""; grid.innerHTML = `<div class="empty">Загружаю…</div>`; return; }
  const inTab = w => S.cat === "all" || w.category === S.cat;
  const list = S.wishes.filter(w => inTab(w) && (w.price == null || ((S.min == null || w.price >= S.min) && (S.max == null || w.price <= S.max))));
  const inCat = S.wishes.filter(inTab).length;
  document.getElementById("sub").textContent = c.tab + " · " + list.length + " шт.";
  let html = mine ? `<button type="button" class="add-card" data-add="1"><big>+</big>Добавить хотелку</button>` : "";
  html += list.map(cardHtml).join("");
  if (!list.length) {
    if (inCat && !list.length) html += `<div class="empty"><b>В этом бюджете ничего нет</b>Поменяй суммы в бюджете.</div>`;
    else if (!mine) html += `<div class="empty"><b>Здесь пока пусто</b>${esc(nameOf(S.sel))} ещё ничего не добавил(а) в «${c.tab}».</div>`;
  }
  grid.innerHTML = html;
}

function cardHtml(w) {
  const c = CAT[w.category];
  const nv = (w._viewers || []).length;
  const lock = w.owner === S.me.id && w.visibility === "some" ? `<span class="lock">${nv ? "видят: " + nv : "🔒 только я"}</span>` : "";
  return `<article class="card${w.done ? " done" : ""}">
    <button type="button" class="open" data-open="${w.id}">
      <div class="ph">${w.photo ? `<img class="bg" src="${esc(w.photo)}" alt="" aria-hidden="true" loading="lazy"><img class="fg" src="${esc(w.photo)}" alt="" loading="lazy">` : esc(initial(w.title))}<span class="imp">${IMP[w.importance] || ""}</span>${lock}</div>
      <div class="t">${esc(w.title)}</div>
      <div class="d">${esc(w.category === "gift" ? w.description : (w.address || w.description))}</div>
    </button>
    <div class="row"><span class="price">${w.price != null ? (w.category === "gift" ? "" : "~") + rub(w.price) : ""}</span>
      <button type="button" class="done-btn" data-done="${w.id}">${c.done}${w.done ? " ✓" : ""}</button></div>
  </article>`;
}

async function onGridClick(e) {
  if (e.target.closest("[data-add]")) return openWishForm();
  const d = e.target.closest("[data-done]");
  if (d) return toggleDone(S.wishes.find(w => w.id === d.dataset.done), d);
  const o = e.target.closest("[data-open]");
  if (o) { const w = S.wishes.find(x => x.id === o.dataset.open); if (!w) return; w.owner === S.me.id ? openWishForm(w) : openDetail(w); }
}

async function toggleDone(w, btn) {
  if (!w) return;
  if (btn) btn.disabled = true;
  const next = !w.done;
  const { error } = await sb.rpc("set_wish_done", { p_wish: w.id, p_done: next });
  if (error) { toast(ruError(error)); if (btn) btn.disabled = false; return false; }
  w.done = next; w.done_by = next ? S.me.id : null;
  renderGrid();
  toast(next ? (w.category === "gift" ? "Отмечено: куплено" : "Отмечено: сходили") : "Отметка снята");
  return true;
}

// ---------- sheets ----------
let lastFocus = null;
function openSheet(html, onClose) {
  closeSheet();
  lastFocus = document.activeElement;
  const ov = document.createElement("div");
  ov.className = "overlay"; ov.id = "overlay";
  ov.innerHTML = `<div class="sheet" role="dialog" aria-modal="true">${html}</div>`;
  ov.addEventListener("click", e => { if (e.target === ov) closeSheet(); });
  ov._onClose = onClose;
  document.body.appendChild(ov);
  ov.querySelector(".x")?.addEventListener("click", closeSheet);
  setTimeout(() => (ov.querySelector("[autofocus]") || ov.querySelector(".x"))?.focus(), 30);
  return ov.querySelector(".sheet");
}
function closeSheet() {
  const ov = document.getElementById("overlay"); if (!ov) return;
  const cb = ov._onClose; ov.remove(); cb && cb(); lastFocus?.focus?.();
}
document.addEventListener("keydown", e => { if (e.key === "Escape") closeSheet(); });

// wish details (someone else's)
function openPhoto(src) {
  const lb = document.createElement("div");
  lb.className = "lightbox"; lb.setAttribute("role", "dialog"); lb.setAttribute("aria-label", "Фото крупно");
  lb.innerHTML = `<img src="${esc(src)}" alt=""><button class="x" type="button" aria-label="Закрыть">×</button>`;
  const close = () => { lb.remove(); document.removeEventListener("keydown", onKey, true); };
  const onKey = e => { if (e.key === "Escape") { e.stopPropagation(); close(); } };
  lb.onclick = close;
  document.addEventListener("keydown", onKey, true);
  document.body.appendChild(lb);
  lb.querySelector(".x").focus();
}
function openDetail(w) {
  const c = CAT[w.category];
  const link = safeUrl(w.link);
  const by = w.done && w.done_by ? nameOf(w.done_by) : "";
  const sh = openSheet(`
    <div class="sheet-head"><h2>${esc(c.one)}</h2><button class="x" type="button" aria-label="Закрыть">×</button></div>
    ${w.photo ? `<img class="detail-photo" src="${esc(w.photo)}" alt="">` : ""}
    <h2 style="margin:0;font-size:22px;word-break:break-word">${esc(w.title)}</h2>
    <div class="meta"><span>Чья: <b>${esc(nameOf(w.owner))}</b></span>${w.price != null ? `<span>Цена: <b>${rub(w.price)}</b></span>` : ""}<span>Важность: <b>${IMP[w.importance]}</b></span></div>
    ${w.description ? `<p class="desc">${esc(w.description)}</p>` : ""}
    ${w.address ? `<p class="desc"><b>Адрес:</b> ${esc(w.address)} · <a href="https://yandex.ru/maps/?text=${encodeURIComponent(w.address)}" target="_blank" rel="noopener">на карте</a></p>` : ""}
    ${link ? `<a class="btn ghost" style="text-align:center;text-decoration:none" href="${esc(link)}" target="_blank" rel="noopener noreferrer">Открыть ссылку</a>` : ""}
    ${by ? `<p class="meta" style="margin:0">Отметил(а): <b>${esc(by)}</b></p>` : ""}
    <button class="btn" type="button" id="d-done">${w.done ? "Снять отметку «" + c.done + "»" : c.done}</button>`);
  sh.querySelector("#d-done").onclick = async () => { if (await toggleDone(w)) closeSheet(); };
  sh.querySelector(".detail-photo")?.addEventListener("click", () => openPhoto(w.photo));
}

// add / edit own wish
function openWishForm(w) {
  const editing = !!w;
  const f = w ? { ...w, _viewers: [...(w._viewers || [])] } : { category: CAT[S.cat] ? S.cat : "gift", title: "", description: "", link: "", address: "", price: null, importance: 2, photo: "", visibility: "all", _viewers: [] };
  const friends = friendIds();
  let vis = f.visibility === "all" ? "all" : f._viewers.length ? "some" : "me";
  const sh = openSheet(`
    <div class="sheet-head"><h2>${editing ? "Изменить хотелку" : "Новая хотелка"}</h2><button class="x" type="button" aria-label="Закрыть">×</button></div>
    <form id="wf" class="list" novalidate style="gap:14px">
      <div class="field"><span class="lbl">Что это</span><div class="chips" id="wf-cat">${CATS.map(c => `<button type="button" class="chip${c.k === f.category ? " on" : ""}" data-k="${c.k}">${c.one}</button>`).join("")}</div></div>
      <div class="field"><label for="wf-link">Ссылка</label>
        <div class="link-row"><input id="wf-link" type="url" inputmode="url" maxlength="1000" value="${esc(f.link)}" placeholder="Вставь ссылку на товар или место"><button type="button" class="btn small" id="wf-fill">✨ Заполнить</button></div>
        <small id="wf-fill-st" style="color:var(--muted)">Вставь ссылку, и фото, название, описание и цена подставятся сами.</small></div>
      <div class="field"><span class="lbl">Фото</span>
        <div class="photo-pick"><div class="ph" id="wf-ph">${f.photo ? `<img src="${esc(f.photo)}" alt="">` : "нет фото"}</div>
        <div class="list"><label class="btn ghost small" for="wf-file" style="text-align:center">${f.photo ? "Заменить фото" : "Выбрать фото"}</label>
        <input id="wf-file" type="file" accept="image/*" hidden>
        <button type="button" class="btn danger small" id="wf-nophoto" ${f.photo ? "" : "hidden"}>Убрать фото</button></div></div></div>
      <div class="field"><label for="wf-title">Название</label><input id="wf-title" type="text" maxlength="120" value="${esc(f.title)}" placeholder="Например, плёночный фотоаппарат" autofocus></div>
      <div class="field"><label for="wf-desc">Описание</label><textarea id="wf-desc" maxlength="1000" placeholder="Размер, цвет, модель, с кем пойти…">${esc(f.description)}</textarea></div>
      <div class="field" id="wf-addr-f"><label for="wf-addr">Адрес</label><input id="wf-addr" type="text" maxlength="300" value="${esc(f.address)}" placeholder="Улица, дом или название места"></div>
      <div class="field"><label for="wf-price" id="wf-price-l">Цена, ₽</label><input id="wf-price" type="number" inputmode="numeric" min="0" step="1" value="${f.price ?? ""}" placeholder="Можно оставить пустым"></div>
      <div class="field"><span class="lbl">Как сильно хочется</span><div class="chips" id="wf-imp">${[3, 2, 1].map(i => `<button type="button" class="chip${i === f.importance ? " on" : ""}" data-i="${i}">${IMP[i]}</button>`).join("")}</div></div>
      <div class="field"><span class="lbl">Кто видит</span>
        <div class="chips" id="wf-vis">${[["all", "👥 Все друзья"], ["some", "✅ Выбрать"], ["me", "🔒 Только я"]].filter(([k]) => friends.length || k !== "some").map(([k, t]) => `<button type="button" class="chip${k === vis ? " on" : ""}" data-v="${k}">${t}</button>`).join("")}</div>
        ${friends.length ? `<div class="list" id="wf-who" style="padding-left:6px" ${vis === "some" ? "" : "hidden"}>${friends.map(id => `<label class="check"><input type="checkbox" value="${id}" ${f._viewers.includes(id) ? "checked" : ""}><span class="av" style="background:${avColor(id)};width:24px;height:24px;font-size:11px">${esc(initial(nameOf(id)))}</span>${esc(nameOf(id))}</label>`).join("")}</div>`
        : ""}
      </div>
      <div class="err" id="wf-err" aria-live="polite"></div>
      <div class="actions"><button class="btn" type="submit" id="wf-save">${editing ? "Сохранить" : "Добавить"}</button></div>
      ${editing ? `<div class="actions" id="wf-delbox"><button class="btn danger" type="button" id="wf-del">Удалить хотелку</button></div>` : ""}
    </form>`);
  const q = s => sh.querySelector(s);
  const syncCat = () => {
    q("#wf-addr-f").hidden = f.category === "gift";
    q("#wf-price-l").textContent = f.category === "gift" ? "Цена, ₽" : "Примерно на человека, ₽";
  };
  syncCat();
  q("#wf-cat").onclick = e => { const b = e.target.closest("[data-k]"); if (!b) return; f.category = b.dataset.k; q("#wf-cat").querySelectorAll(".chip").forEach(x => x.classList.toggle("on", x === b)); syncCat(); };
  q("#wf-imp").onclick = e => { const b = e.target.closest("[data-i]"); if (!b) return; f.importance = +b.dataset.i; q("#wf-imp").querySelectorAll(".chip").forEach(x => x.classList.toggle("on", x === b)); };
  q("#wf-vis").onclick = e => {
    const b = e.target.closest("[data-v]"); if (!b) return; vis = b.dataset.v;
    q("#wf-vis").querySelectorAll(".chip").forEach(x => x.classList.toggle("on", x === b));
    if (q("#wf-who")) q("#wf-who").hidden = vis !== "some";
  };
  q("#wf-file").onchange = async e => {
    const file = e.target.files[0]; if (!file) return;
    q("#wf-ph").textContent = "…";
    try { f.photo = await shrinkPhoto(file); q("#wf-ph").innerHTML = `<img src="${f.photo}" alt="">`; q("#wf-nophoto").hidden = false; }
    catch { q("#wf-ph").textContent = "нет фото"; q("#wf-err").textContent = "Не получилось открыть это фото. Попробуй другое."; }
    e.target.value = "";
  };
  const fill = async () => {
    const st = q("#wf-fill-st"), btn = q("#wf-fill");
    const url = safeUrl(q("#wf-link").value.trim());
    if (!url) { st.textContent = "Сначала вставь ссылку."; return; }
    btn.disabled = true; st.style.color = "var(--muted)"; st.textContent = "Смотрю, что по ссылке…";
    try {
      const { data, error } = await sb.functions.invoke("parse-link", { body: { url } });
      if (error || !data || data.error) throw error || new Error(data?.error || "empty");
      const put = (sel, v) => { const el = q(sel); if (v && !el.value.trim()) el.value = v; };
      put("#wf-title", data.title); put("#wf-desc", data.description);
      if (data.price && !q("#wf-price").value.trim()) q("#wf-price").value = data.price;
      if (data.address && f.category !== "gift") put("#wf-addr", data.address);
      if (data.photo && !f.photo) { f.photo = data.photo; q("#wf-ph").innerHTML = `<img src="${esc(f.photo)}" alt="">`; q("#wf-nophoto").hidden = false; }
      st.style.color = "var(--ok)"; st.textContent = "Готово! Проверь и поправь, если нужно.";
    } catch {
      st.style.color = "var(--danger)"; st.textContent = "Этот сайт не дал прочитать страницу. Заполни вручную или попробуй другую ссылку.";
    }
    btn.disabled = false;
  };
  q("#wf-fill").onclick = fill;
  q("#wf-link").addEventListener("paste", () => setTimeout(() => { if (!q("#wf-title").value.trim()) fill(); }, 50));
  q("#wf-ph").onclick = () => { if (f.photo) openPhoto(f.photo); };
  q("#wf-nophoto").onclick = () => { f.photo = ""; q("#wf-ph").textContent = "нет фото"; q("#wf-nophoto").hidden = true; };
  if (editing) q("#wf-del").onclick = () => {
    q("#wf-delbox").innerHTML = `<span style="align-self:center;font-weight:700">Точно удалить?</span><button class="btn danger" type="button" id="wf-del2">Да, удалить</button><button class="btn ghost" type="button" id="wf-del0">Нет</button>`;
    q("#wf-del0").onclick = () => openWishForm(w);
    q("#wf-del2").onclick = async () => {
      const { error } = await sb.from("wishes").delete().eq("id", w.id);
      if (error) return (q("#wf-err").textContent = ruError(error));
      S.wishes = S.wishes.filter(x => x.id !== w.id); closeSheet(); renderGrid(); toast("Хотелка удалена");
    };
  };
  q("#wf").onsubmit = async ev => {
    ev.preventDefault();
    const err = q("#wf-err"), save = q("#wf-save"); err.textContent = "";
    const title = q("#wf-title").value.trim();
    if (!title) { err.textContent = "Напиши название."; q("#wf-title").focus(); return; }
    const priceRaw = q("#wf-price").value.trim();
    const price = priceRaw === "" ? null : Math.max(0, Math.round(+priceRaw));
    if (priceRaw !== "" && !Number.isFinite(price)) { err.textContent = "Цена должна быть числом."; return; }
    const linkRaw = q("#wf-link").value.trim();
    const link = linkRaw ? safeUrl(linkRaw) : "";
    if (linkRaw && !link) { err.textContent = "Ссылка выглядит странно. Скопируй её из адресной строки браузера."; return; }
    const all = vis === "all";
    const viewers = vis === "some" && q("#wf-who") ? [...q("#wf-who").querySelectorAll("input:checked")].map(i => i.value) : [];
    const row = {
      category: f.category, title, description: q("#wf-desc").value.trim(), link,
      address: f.category === "gift" ? "" : q("#wf-addr").value.trim(),
      price, importance: f.importance, photo: f.photo || "", visibility: all ? "all" : "some",
    };
    save.disabled = true;
    try {
      let id = w?.id;
      if (editing) { const { error } = await sb.from("wishes").update(row).eq("id", id); if (error) throw error; }
      else { const { data, error } = await sb.from("wishes").insert(row).select("id").single(); if (error) throw error; id = data.id; }
      if (editing) { const { error } = await sb.from("wish_viewers").delete().eq("wish_id", id); if (error) throw error; }
      if (!all && viewers.length) { const { error } = await sb.from("wish_viewers").insert(viewers.map(u => ({ wish_id: id, user_id: u }))); if (error) throw error; }
      closeSheet();
      if (S.cat !== "all") S.cat = row.category;
      document.querySelectorAll(".tab").forEach(x => x.classList.toggle("on", x.dataset.k === S.cat));
      toast(editing ? "Сохранено" : "Хотелка добавлена");
      loadWishes();
    } catch (e) { err.textContent = ruError(e); save.disabled = false; }
  };
}

function shrinkPhoto(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      let size = 900, quality = 0.8, out = "";
      for (let i = 0; i < 6; i++) {
        const k = Math.min(1, size / Math.max(img.width, img.height));
        const cv = document.createElement("canvas");
        cv.width = Math.round(img.width * k); cv.height = Math.round(img.height * k);
        cv.getContext("2d").drawImage(img, 0, 0, cv.width, cv.height);
        out = cv.toDataURL("image/jpeg", quality);
        if (out.length < 380000) return resolve(out);
        size = Math.round(size * 0.8); quality = Math.max(0.5, quality - 0.08);
      }
      out.length < 400000 ? resolve(out) : reject(new Error("too big"));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("bad image")); };
    img.src = url;
  });
}

// friends
async function addByCode(code, silent) {
  const { data, error } = await sb.rpc("add_friend_by_code", { p_code: code });
  if (error) { toast(ruError(error)); return; }
  if (!data.ok) { if (!silent || data.reason !== "self") toast(data.reason === "self" ? "Это твой собственный код." : "Такого кода нет. Проверь буквы и цифры."); return; }
  const n = data.name || "друг";
  toast(data.status === "accepted" ? `Вы с «${n}» теперь друзья` : `Заявка отправлена «${n}». Когда примет, вы увидите хотелки друг друга.`);
  await loadFriends(); renderMain(); loadWishes();
  if (document.getElementById("overlay")) openFriends();
}

function openFriends() {
  const link = location.origin + "/?add=" + S.profile.code;
  const inc = S.friendships.filter(f => f.status === "pending" && f.addressee === S.me.id);
  const out = S.friendships.filter(f => f.status === "pending" && f.requester === S.me.id);
  const fr = friendIds();
  const person = id => `<div class="who"><span class="av" style="background:${avColor(id)}">${esc(initial(nameOf(id)))}</span><span>${esc(nameOf(id))}</span></div>`;
  const sh = openSheet(`
    <div class="sheet-head"><h2>Друзья</h2><button class="x" type="button" aria-label="Закрыть">×</button></div>
    <div class="field"><span class="lbl">Пригласи друга</span><small>Отправь ему ссылку. Когда он зарегистрируется и откроет её, тебе придёт заявка в друзья.</small>
      <div class="code-box"><div><small>Твой код</small><br><b>${esc(S.profile.code)}</b></div><button class="btn small" type="button" id="f-copy">Скопировать ссылку</button></div>
      <input type="text" id="f-link" value="${esc(link)}" readonly aria-label="Твоя ссылка" style="font-size:13px"></div>
    <form class="field" id="f-add"><label for="f-code">Добавить по коду друга</label>
      <div style="display:flex;gap:8px"><input id="f-code" type="text" maxlength="12" placeholder="Например, 4F2A9C" style="text-transform:uppercase" autocomplete="off"><button class="btn small" type="submit">Добавить</button></div></form>
    ${inc.length ? `<div class="field"><span class="lbl">Хотят дружить</span><div class="list">${inc.map(f => `<div class="li">${person(f.requester)}<div class="btns"><button class="btn small" data-acc="${f.id}" type="button">Принять</button><button class="btn ghost small" data-rm="${f.id}" type="button">Нет</button></div></div>`).join("")}</div></div>` : ""}
    <div class="field"><span class="lbl">Мои друзья</span>${fr.length ? `<div class="list">${S.friendships.filter(f => f.status === "accepted").map(f => { const id = f.requester === S.me.id ? f.addressee : f.requester; return `<div class="li">${person(id)}<div class="btns"><button class="btn danger small" data-del="${f.id}" type="button">Удалить</button></div></div>`; }).join("")}</div>` : `<small>Пока никого. Отправь ссылку выше.</small>`}</div>
    ${out.length ? `<div class="field"><span class="lbl">Ждут ответа</span><div class="list">${out.map(f => `<div class="li">${person(f.addressee)}<div class="btns"><button class="btn ghost small" data-rm="${f.id}" type="button">Отменить</button></div></div>`).join("")}</div></div>` : ""}`);
  const q = s => sh.querySelector(s);
  q("#f-copy").onclick = async () => {
    try { await navigator.clipboard.writeText(link); toast("Ссылка скопирована. Отправь её другу."); }
    catch { const i = q("#f-link"); i.focus(); i.select(); toast("Выдели ссылку и скопируй её."); }
  };
  q("#f-add").onsubmit = e => { e.preventDefault(); const v = q("#f-code").value.trim(); if (v) addByCode(v); };
  sh.addEventListener("click", async e => {
    const acc = e.target.closest("[data-acc]"), rm = e.target.closest("[data-rm]"), del = e.target.closest("[data-del]");
    if (acc) {
      const { error } = await sb.from("friendships").update({ status: "accepted" }).eq("id", acc.dataset.acc);
      if (error) return toast(ruError(error));
      toast("Теперь вы друзья"); await loadFriends(); renderMain(); loadWishes(); openFriends();
    }
    if (rm) {
      const { error } = await sb.from("friendships").delete().eq("id", rm.dataset.rm);
      if (error) return toast(ruError(error));
      await loadFriends(); renderMain(); loadWishes(); openFriends();
    }
    if (del) {
      if (del.dataset.sure !== "1") { del.dataset.sure = "1"; del.textContent = "Точно удалить?"; return; }
      const { error } = await sb.from("friendships").delete().eq("id", del.dataset.del);
      if (error) return toast(ruError(error));
      toast("Удалено из друзей"); await loadFriends(); if (!friendIds().includes(S.sel)) S.sel = S.me.id; renderMain(); loadWishes(); openFriends();
    }
  });
}

// profile
function openProfile() {
  const sh = openSheet(`
    <div class="sheet-head"><h2>Мой профиль</h2><button class="x" type="button" aria-label="Закрыть">×</button></div>
    <form class="field" id="pf"><label for="pf-name">Как тебя подписать</label>
      <div style="display:flex;gap:8px"><input id="pf-name" type="text" maxlength="40" value="${esc(S.profile.name)}"><button class="btn small" type="submit">Сохранить</button></div></form>
    <small style="color:var(--muted)">Почта: ${esc(S.me.email || "")}</small>
    <button class="btn ghost" type="button" id="pf-install">📱 Как поставить на экран телефона</button>
    <button class="btn ghost" type="button" id="pf-news">✨ Как добавить хотелку по ссылке</button>
    <button class="btn ghost" type="button" id="pf-gift">🎁 Подарок-приветствие</button>
    <button class="btn ghost" type="button" id="pf-tour">Показать подсказки</button>
    <button class="btn danger" type="button" id="pf-out">Выйти</button>`);
  sh.querySelector("#pf").onsubmit = async e => {
    e.preventDefault();
    const name = sh.querySelector("#pf-name").value.trim(); if (!name) return;
    const { error } = await sb.from("profiles").update({ name }).eq("id", S.me.id);
    if (error) return toast(ruError(error));
    S.profile.name = name; closeSheet(); renderMain(); renderGrid(); toast("Имя сохранено");
  };
  sh.querySelector("#pf-tour").onclick = openTour;
  sh.querySelector("#pf-install").onclick = openInstall;
  sh.querySelector("#pf-news").onclick = openNews;
  sh.querySelector("#pf-gift").onclick = () => { closeSheet(); openGift(); };
  sh.querySelector("#pf-out").onclick = async () => { closeSheet(); await sb.auth.signOut(); };
}

// tour
function isStandalone() { return matchMedia("(display-mode: standalone)").matches || navigator.standalone === true; }
function installHint() {
  if (isStandalone() || !matchMedia("(max-width: 900px)").matches) return false;
  try { return !localStorage.getItem("ihHidden"); } catch { return true; }
}
function openInstall() {
  const ua = navigator.userAgent;
  const ios = /iPhone|iPad|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const notSafari = ios && /CriOS|FxiOS|YaBrowser|EdgiOS|OPiOS/.test(ua);
  const iphone = `<div class="how"><h3>iPhone</h3>
    ${notSafari ? `<p class="warn">Сначала открой этот сайт в <b>Safari</b>: из других браузеров на iPhone так не получится.</p>` : ""}
    <ol><li>Открой сайт в <b>Safari</b>.</li>
      <li>Нажми кнопку <b>«Поделиться»</b> внизу экрана (квадрат со стрелкой вверх).</li>
      <li>Пролистай вниз и выбери <b>«На экран „Домой“»</b>.</li>
      <li>Нажми <b>«Добавить»</b>. На экране появится иконка с сердечком.</li></ol></div>`;
  const android = `<div class="how"><h3>Android</h3>
    <ol><li>Открой сайт в <b>Chrome</b>.</li>
      <li>Нажми <b>⋮</b> справа вверху.</li>
      <li>Выбери <b>«Добавить на главный экран»</b> или <b>«Установить приложение»</b>.</li>
      <li>Нажми <b>«Добавить»</b>.</li></ol></div>`;
  openSheet(`
    <div class="sheet-head"><h2>Хотелки как приложение</h2><button class="x" type="button" aria-label="Закрыть">×</button></div>
    ${isStandalone() ? `<p class="ok">Уже готово: сайт открыт с иконки на экране телефона.</p>` : ""}
    <p style="margin:0">Иконка откроет сайт на весь экран, без адресной строки, как обычное приложение. Ничего скачивать не нужно.</p>
    ${ios ? iphone + android : android + iphone}
    <div class="actions"><button class="btn" type="button" id="in-ok" autofocus>Понятно</button></div>`).querySelector("#in-ok").onclick = closeSheet;
}
const NEWS_ID = "link-fill-1";
function seenNews() {
  try { const was = localStorage.getItem("news") === NEWS_ID; localStorage.setItem("news", NEWS_ID); return was; } catch { return true; }
}
function openNews() {
  openSheet(`
    <div class="sheet-head"><h2>✨ Новое: хотелка по ссылке</h2><button class="x" type="button" aria-label="Закрыть">×</button></div>
    <div class="how"><ol>
      <li>Нажми <b>«+»</b> внизу справа.</li>
      <li>В самое верхнее поле <b>«Ссылка»</b> вставь ссылку на товар из интернет-магазина (например, Wildberries) или на место.</li>
      <li>Нажми <b>«✨ Заполнить»</b>. Фото, название, описание и цена подставятся сами.</li>
      <li>Проверь, поправь, если нужно, и нажми <b>«Добавить»</b>.</li></ol></div>
    <p style="margin:0;color:var(--muted)">Если какой-то сайт не даст прочитать страницу, заполни поля вручную. А нажатие на фото в хотелке открывает его крупно.</p>
    <div class="actions"><button class="btn" type="button" id="nw-add">Попробовать</button><button class="btn ghost" type="button" id="nw-ok">Понятно</button></div>`);
  document.getElementById("nw-ok").onclick = closeSheet;
  document.getElementById("nw-add").onclick = () => { closeSheet(); openWishForm(); setTimeout(() => document.getElementById("wf-link")?.focus(), 60); };
}
function openGift(then) {
  const el = document.createElement("div");
  el.className = "gift-intro"; el.setAttribute("role", "dialog"); el.setAttribute("aria-modal", "true"); el.setAttribute("aria-label", "Подарок от Яси");
  const faces = ["front", "back", "left", "right", "bottom"].map(f => `<i class="f ${f}"></i>`).join("");
  const hearts = Array.from({ length: 18 }, (_, i) => `<b style="--a:${i * 20}deg;--d:${(i % 3) * 0.08}s;--r:${110 + (i % 4) * 40}px">${["💗", "✨", "🎀"][i % 3]}</b>`).join("");
  el.innerHTML = `
    <button type="button" class="gi-scene" id="gi-open" aria-label="Открыть подарок">
      <div class="gi-box"><div class="gi-body">${faces}</div><div class="gi-lid"><i class="f top"></i><i class="f front"></i><i class="f back"></i><i class="f left"></i><i class="f right"></i><span class="gi-bow">🎀</span></div></div>
      <div class="gi-burst" aria-hidden="true">${hearts}</div>
    </button>
    <p class="gi-tap">Тебе подарок! Нажми, чтобы открыть</p>
    <div class="gi-card" hidden>
      <p class="gi-hi">Привет! Это Яся 💝</p>
      <p>Я сделала этот сайт, чтобы собрать все наши хотелки в одном месте.</p>
      <p>Теперь мы всегда знаем, о чём мечтает близкий человек, куда ему хочется сходить, что попробовать и чем он увлекается. И больше никаких «не знаю, что тебе подарить»!</p>
      <p>Добавляй свои хотелки, зови друзей, и пусть мечты сбываются ✨</p>
      <p class="gi-sign">С любовью, Яся</p>
      <button class="btn" type="button" id="gi-go">Начать</button>
    </div>`;
  document.body.appendChild(el);
  const btn = el.querySelector("#gi-open");

  btn.onclick = () => {
    if (el.classList.contains("open")) return;
    el.classList.add("open");
    setTimeout(() => { el.querySelector(".gi-card").hidden = false; el.querySelector("#gi-go").focus(); }, 750);
  };
  el.querySelector("#gi-go").onclick = () => { el.remove(); then?.(); };
}
function openTour() {
  const steps = [
    ["Привет, " + (S.profile?.name || "друг") + "!", "Здесь хранятся хотелки: подарки, куда сходить покушать, где погулять и на какие мероприятия хочется."],
    ["Добавь свою хотелку", "Нажми «+» и просто вставь ссылку на товар или место, потом нажми «✨ Заполнить». Фото, название, описание и цену сайт подставит сам. Можно и вручную. А ещё можно выбрать, кто из друзей её увидит."],
    ["Позови близких", "Нажми «Друзья» и отправь свою ссылку. Когда друг её откроет и зарегистрируется, вы будете видеть хотелки друг друга."],
    ["Смотри хотелки друзей", "Сверху переключайся между людьми, внизу выбирай раздел и бюджет. Подарили подарок или сходили вместе? Нажми «Куплено» или «Сходили»."],
  ];
  let i = 0;
  const finish = async () => {
    if (S.profile && !S.profile.onboarded) { S.profile.onboarded = true; await sb.from("profiles").update({ onboarded: true }).eq("id", S.me.id); }
  };
  const draw = () => {
    const sh = openSheet(`
      <div class="sheet-head"><h2>${esc(steps[i][0])}</h2><button class="x" type="button" aria-label="Закрыть">×</button></div>
      <p style="margin:0;font-size:16px">${esc(steps[i][1])}</p>
      <div class="tour-dots">${steps.map((_, j) => `<i class="${j === i ? "on" : ""}"></i>`).join("")}</div>
      <div class="actions">${i < steps.length - 1 ? `<button class="btn ghost" type="button" id="t-skip">Пропустить</button><button class="btn" type="button" id="t-next" autofocus>Дальше</button>` : `<button class="btn" type="button" id="t-next" autofocus>Понятно</button>`}</div>`, finish);
    sh.querySelector("#t-next").onclick = () => { if (i < steps.length - 1) { i++; draw(); } else closeSheet(); };
    sh.querySelector("#t-skip")?.addEventListener("click", closeSheet);
  };
  draw();
}

document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && S.me && !document.getElementById("overlay")) loadFriends().then(() => { renderMain(); loadWishes(); }).catch(() => {}); });

boot();
