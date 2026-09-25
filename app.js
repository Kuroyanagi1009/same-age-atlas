// 同い年の星図 — プロトタイプ
const MAX_AGE = 100;          // 選べる年齢の上限
const AXIS_MAX = MAX_AGE + 1; // 横軸の右端（100歳の帯 [100, 101) まで描く）
const THUMB = 18;             // スライダーのつまみの幅（style.css と合わせる）
const DEFAULT_AGE = 30;       // 初めて開いたときの年齢
const AHEAD_YEARS = 15;       // 「この先に花開く人」は最長この年数先まで
const V = 13;                  // データのキャッシュよけ
const state = {
  people: [], byId: new Map(), pv: { ja: {}, en: {} },
  // view: 表示中の年齢（ドラッグ中も動く） / myAge: 確定した年齢（離したとき。見出しはこちらで作る）
  myAge: DEFAULT_AGE, view: DEFAULT_AGE, field: "all", hover: null, dragging: false,
};
const $ = (id) => document.getElementById(id);

// 出来事の種類 → 転機（道が変わった）か開花（成果が認められた）か。featured.json の "kind" で個別に上書きできる
const KIND_OF_TYPE = { turning: "turning", founding: "turning", debut: "bloom", breakthrough: "bloom", masterpiece: "bloom", award: "bloom" };
const COLOR = { died: "143,180,255", turning: "127,224,196", bloom: "243,201,105" };

// ---------- 日付と年齢 ----------
// "1811-10-25" / "1829-04" / "1761" / "-0355-07-20" を {y, m, d, prec}（prec: 9=年 10=月 11=日）に
function parseDate(s) {
  const m = /^(-?\d+)(?:-(\d\d))?(?:-(\d\d))?/.exec(s);
  if (!m) return null;
  return { y: +m[1], m: m[2] ? +m[2] : 0, d: m[3] ? +m[3] : 0, prec: m[3] ? 11 : m[2] ? 10 : 9 };
}
// a から b までの満年齢（小数つき）。b は日まで確定している前提
function ageBetween(a, b) {
  let years = b.y - a.y;
  if (b.m < a.m || (b.m === a.m && b.d < a.d)) years--;
  const last = { y: a.y + years, m: a.m, d: a.d };
  const days = (utc(b) - utc(last)) / 864e5;
  return years + Math.max(0, Math.min(0.999, days / 365.25));
}
function utc(p) {
  const dt = new Date(Date.UTC(2000, (p.m || 1) - 1, p.d || 1));
  dt.setUTCFullYear(p.y);
  return dt.getTime();
}
function today() {
  const n = new Date();
  return { y: n.getFullYear(), m: n.getMonth() + 1, d: n.getDate(), prec: 11 };
}
// 日付の精度に応じた「最も早い日」「最も遅い日」
function earliest(p) { return { y: p.y, m: p.m || 1, d: p.d || 1 }; }
function latest(p) { return { y: p.y, m: p.m || 12, d: p.d || new Date(Date.UTC(2001, p.m || 12, 0)).getUTCDate() }; }
function fullAge(b, w) { return w.y - b.y - ((w.m < b.m || (w.m === b.m && w.d < b.d)) ? 1 : 0); }
// 生年・出来事の日付のどちらかが年・月までしか分からなくても、ありうる満年齢の範囲 [lo, hi] を返す
function ageRange(born, when) {
  return [fullAge(latest(born), earliest(when)), fullAge(earliest(born), latest(when))];
}

// ---------- データ ----------
function makePerson(p) {
  const born = parseDate(p.born);
  const died = p.died ? parseDate(p.died) : null;
  const person = {
    id: p.id, featured: !!p.featured, name: { ja: p.ja, en: p.en }, field: p.field,
    born, died, sl: p.sl || 0,
    deathAge: null, deathLo: null, deathHi: null,
    desc: { ja: p.desc_ja || "", en: p.desc_en || "" },
    wiki: p.wiki || {},
    img: p.img || "",
    events: [],
  };
  // 星の位置（決定的な擬似乱数）
  let h = 0;
  for (const c of p.id) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const rand = () => ((h = (h * 1103515245 + 12345) >>> 0) / 4294967296);
  person.y1 = rand();
  person.y2 = rand();
  if (died) {
    // 没年齢：日まで分かれば小数つき、年・月までなら幅（「51〜52歳で没」）
    [person.deathLo, person.deathHi] = ageRange(born, died);
    person.deathAge = born.prec === 11 && died.prec === 11
      ? ageBetween(born, died) : person.deathLo + rand() * (person.deathHi - person.deathLo + 1);
  }
  for (const e of p.milestones || []) {
    const d = parseDate(e.date);
    const [lo, hi] = e.age != null ? [e.age, e.age] : ageRange(born, d);
    if (lo < 0 || lo > 110) continue;
    // 亡くなった日以降の出来事は扱わない
    if (died && utc(d) >= utc(died) && e.age == null) continue;
    // 星図上の位置：日付が確定していればその年齢、年・月までなら幅の中に散らす（整数年齢に縦一列に並ばないように）
    const age = d.prec === 11 && e.age == null ? ageBetween(born, d) : lo + rand() * (hi - lo + 1);
    person.events.push({
      lo, hi, age, type: e.type, kind: e.kind || KIND_OF_TYPE[e.type] || "bloom",
      text: { ja: e.ja, en: e.en }, year: d.y,
    });
  }
  person.events.sort((a, b) => a.age - b.age);
  person.key = `|${normalize(p.ja)}|${normalize(p.en)}`;
  return person;
}

function starEventText(e) {
  if (e.type === "founding") {
    return { ja: I18N.ja.ev_founding.replace("{x}", e.ja), en: I18N.en.ev_founding.replace("{x}", e.en) };
  }
  if (e.en === "Olympic gold medal") return { ja: "オリンピックで金メダル", en: "Wins Olympic gold" };
  return { ja: I18N.ja.ev_award.replace("{x}", e.ja), en: I18N.en.ev_award.replace("{x}", e.en) };
}
// 精度が年・月までなら、その精度の日付文字列にする（年齢を幅で出すため）
function datePrec(date, p) {
  if (p >= 11) return date;
  const neg = date.startsWith("-");
  const parts = date.replace(/^-/, "").split("-");
  return (neg ? "-" : "") + (p === 10 ? `${parts[0]}-${parts[1]}` : parts[0]);
}

function addPeople(list) {
  for (const p of list) {
    state.people.push(p);
    state.byId.set(p.id, p);
  }
}

async function getJSON(path) {
  const r = await fetch(`${path}?v=${V}`);
  if (!r.ok) throw new Error(`${path}: ${r.status}`);
  return r.json();
}

async function loadData() {
  const [featured, fame] = await Promise.all([getJSON("data/featured.json"), getJSON("data/fame.json").catch(() => null)]);
  if (fame) state.pv = fame.pv;
  const meta = (fame && fame.featured) || {};
  addPeople(featured.map((p) => makePerson({
    ...p, featured: true, wiki: { en: p.wiki, ja: meta[p.id]?.tja || "" }, img: meta[p.id]?.img || "",
  })));
  const knownQ = new Set(Object.values(meta).map((m) => m.q));
  const knownTitles = new Set(featured.map((p) => p.wiki));
  render();
  try {
    $("starCount").textContent = t("stars_loading");
    const stars = await getJSON("data/stars.json");
    addPeople(stars.filter((s) => !knownQ.has(s.q) && !knownTitles.has(s.ten)).map((s) => makePerson({
      id: s.q, en: s.en, ja: s.ja, born: datePrec(s.b, s.bp ?? 11), died: s.d && datePrec(s.d, s.dp ?? 11), field: s.f, sl: s.sl,
      desc_en: s.den, desc_ja: s.dja, wiki: { en: s.ten, ja: s.tja }, img: s.img,
      milestones: s.ev.map((e) => {
        const tx = starEventText(e);
        return { date: datePrec(e.date, e.p), type: e.type, kind: e.kind, ja: tx.ja, en: tx.en };
      }),
    })));
  } catch (e) {
    console.warn("stars.json not loaded", e);
  }
  render();
}

// ---------- 知名度 ----------
// 画面の言語の Wikipedia の直近60日の閲覧数。日本語なら日本での知名度で並ぶ
function views(p, lang = LANG) {
  const title = p.wiki[lang];
  return title ? state.pv[lang]?.[title] || 0 : 0;
}
// 並べ替え用の点数：閲覧数の対数。手で選んだ人は少しだけ上げる（物語があるので）
function score(p) {
  return Math.log10(views(p) + 10) + (p.featured ? 0.3 : 0);
}
const byScore = (x, y) => score(y) - score(x);

// ---------- 入力 ----------
// 年齢は前回選んだものを覚えておく（初回は30歳）
// 年齢の決め方：URL の ?age= が最優先（人に送ったリンクで同じ年齢を開ける）→ 前回の年齢 → 30歳
function loadInputs() {
  const ok = (a) => Number.isInteger(a) && a >= 0 && a <= MAX_AGE;
  const fromUrl = parseInt(new URLSearchParams(location.search).get("age"), 10);
  if (ok(fromUrl)) { state.myAge = state.view = fromUrl; return; }
  try {
    const a = parseInt(localStorage.getItem("ga.age"), 10);
    if (ok(a)) state.myAge = state.view = a;
  } catch (e) {}
}
// アドレス欄の ?age= を今の年齢に合わせる（履歴は増やさない）
function syncUrl() {
  try {
    const u = new URL(location.href);
    u.searchParams.set("age", state.myAge);
    history.replaceState(null, "", u);
  } catch (e) {}
}

// ドラッグ中：欄と星図だけ動かす
function setView(a) {
  const v = Math.max(0, Math.min(MAX_AGE, Math.floor(a)));
  if (v !== state.view) { state.view = v; render(false); }
}
// 離したとき：その年齢で確定し、見出しも作り直す
function commitAge() {
  state.myAge = state.view;
  try { localStorage.setItem("ga.age", String(state.myAge)); } catch (e) {}
  syncUrl();
  render();
}

function bindInputs() {
  // input はつまみを動かしている間、change は離したとき（キーボード操作でも発生する）
  $("view").addEventListener("change", commitAge);
  $("view").addEventListener("input", () => setView(+$("view").value));
  $("lang").addEventListener("click", () => {
    LANG = LANG === "ja" ? "en" : "ja";
    try { localStorage.setItem("ga.lang", LANG); } catch (e) {}
    render();
  });
  window.addEventListener("resize", () => { layoutSlider(); drawSky(); drawLifebars(); });

  // 星図の上をなぞる・クリックすると、その年齢に移る
  const sky = $("sky");
  const ageAt = (ev) => {
    const r = sky.getBoundingClientRect();
    return xToAge(ev.clientX - r.left, r.width);
  };
  sky.addEventListener("pointerdown", (ev) => {
    state.dragging = true;
    sky.setPointerCapture(ev.pointerId);
    setView(ageAt(ev));
  });
  sky.addEventListener("pointermove", (ev) => {
    if (state.dragging) setView(ageAt(ev));
    else onSkyHover(ev);
  });
  const end = () => { if (state.dragging) { state.dragging = false; commitAge(); } };
  sky.addEventListener("pointerup", end);
  sky.addEventListener("pointercancel", end);
  sky.addEventListener("pointerleave", () => { if (!state.dragging) { state.hover = null; $("tip").hidden = true; drawSky(); } });

  // 名前をクリックすると人物カード
  document.addEventListener("click", (ev) => {
    const b = ev.target.closest("[data-person]");
    if (b) { ev.preventDefault(); openCard(b.dataset.person); }
    const v = ev.target.closest("[data-age]");
    if (v) { closeCard(); setView(+v.dataset.age); commitAge(); $("sky").scrollIntoView({ behavior: "smooth", block: "center" }); }
  });
  $("cardClose").addEventListener("click", closeCard);
  $("card").addEventListener("click", (ev) => { if (ev.target === $("card")) closeCard(); });
  document.addEventListener("keydown", (ev) => { if (ev.key === "Escape") { closeCard(); $("hits").hidden = true; } });
  bindSearch();
  $("share").addEventListener("click", share);
}

// ---------- 表示 ----------
const nm = (p) => p.name[LANG];
const visible = (p) => state.field === "all" || p.field === state.field;
const fmtAge = (a) => Math.floor(a);
const descOf = (p) => p.desc[LANG] || p.desc[LANG === "ja" ? "en" : "ja"];

// 没年齢が幅を持つ人（生没が年までしか分からない人）も含め、その年齢で亡くなった可能性があるか
function diedAt(p, A) { return p.deathLo != null && p.deathLo <= A && A <= p.deathHi; }
function deathLabel(p) { return p.deathLo === p.deathHi ? p.deathLo : (LANG === "ja" ? `${p.deathLo}〜${p.deathHi}` : `${p.deathLo}–${p.deathHi}`); }

function ageLabel(e) {
  return e.lo === e.hi ? t("at_age", { n: e.lo }) : t("age_range", { a: e.lo, b: e.hi });
}
function yearLabel(y) {
  if (y < 0) return LANG === "ja" ? `前${-y + 1}年` : `${-y + 1} BC`;
  return LANG === "ja" ? `${y}年` : `${y}`;
}
function wikiUrl(p) {
  if (LANG === "ja" && p.wiki.ja) return `https://ja.wikipedia.org/wiki/${encodeURIComponent(p.wiki.ja)}`;
  return p.wiki.en ? `https://en.wikipedia.org/wiki/${encodeURIComponent(p.wiki.en)}` : null;
}
function short(s, n = 26) { return s.length > n ? s.slice(0, n - 1) + "…" : s; }
function esc(s) { return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]); }
function lifeSpan(p) {
  const y = (v) => (v < 0 ? (LANG === "ja" ? `前${-v + 1}` : `${-v + 1} BC`) : v);
  return `${y(p.born.y)}–${p.died ? y(p.died.y) : ""}`;
}
function kindBadge(kind) {
  return `<span class="badge ${kind}">${esc(t(`kinds.${kind}`))}</span>`;
}
function nameLink(p) {
  return `<a href="#" class="pname" data-person="${esc(p.id)}">${esc(nm(p))}</a>`;
}

function render(headline = true) {
  document.documentElement.lang = LANG;
  document.title = `${t("title")} — ${LANG === "ja" ? I18N.en.title : I18N.ja.title}`;
  document.querySelectorAll("[data-i18n]").forEach((el) => (el.textContent = t(el.dataset.i18n)));
  document.querySelectorAll("[data-i18n-ph]").forEach((el) => (el.placeholder = t(el.dataset.i18nPh)));
  $("lang").textContent = LANG === "ja" ? "EN" : "日本語";
  $("view").value = state.view;
  const n = state.people.length;
  $("starCount").textContent = n > 200 ? t("stars_count", { n: n.toLocaleString() }) : "";
  renderChips();
  if (headline) renderHeadline();
  renderColumns();
  layoutSlider();
  drawSky();
  drawLifebars();
  if (!$("card").hidden && state.cardId) openCard(state.cardId);
}

function renderChips() {
  const fields = ["all", "science", "arts", "literature", "business", "politics", "sports", "other"];
  $("fields").innerHTML = "";
  for (const f of fields) {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = f === "all" ? t("all") : t(`fields.${f}`);
    b.className = state.field === f ? "on" : "";
    b.onclick = () => { state.field = f; render(); };
    $("fields").append(b);
  }
}

// 1人につき1件：条件に合う最初の出来事
function firstEvents(ppl, test) {
  const out = [];
  for (const p of ppl) {
    const e = p.events.find(test);
    if (e) out.push({ p, e });
  }
  return out;
}
const best = (arr, key = (x) => x) => arr.reduce((b, x) => (!b || score(key(x)) > score(key(b)) ? x : b), null);

// 見出し：同じ年齢で亡くなった人（青）／同じ年齢の転機（緑）／この先の開花（金）。色は下の欄・星図と揃える
function renderHeadline() {
  const A = state.myAge;
  $("bigAge").textContent = A;
  $("bigUnit").textContent = LANG === "ja" ? "歳" : ` ${t("years")}`;

  const ppl = state.people.filter(visible);
  const li = [];
  state.headLines = []; // 共有の文面にも使う
  const line = (cls, text, p) => {
    state.headLines.push(text);
    const d = descOf(p);
    li.push(`<li class="${cls}">${esc(text)}${d ? `<span class="hd">${esc(short(d, 44))}</span>` : ""}</li>`);
  };
  // 満年齢どうしで比べる（28歳没と30歳なら「2年先」）
  const same = best(ppl.filter((p) => diedAt(p, A)));
  if (same) {
    line("died", t("died_same", { a: A, name: nm(same) }), same);
  } else {
    const before = best(ppl.filter((p) => p.deathHi != null && A - p.deathHi >= 1 && A - p.deathHi <= 5));
    if (before) line("died", t("died_before", { name: nm(before), d: deathLabel(before), n: A - before.deathHi }), before);
  }
  // 見出しで年齢を言うので、出来事の文頭の「30歳、」「30歳で」「At 30, 」は落とす
  // （「70歳を過ぎて」のように年齢が文の一部になっているものは残す）
  const what = (e) => short(e.text[LANG].replace(/^\d+歳(?:頃)?(?:[、,]|で、?)\s*|^At \d+,\s*/, ""), 38);
  const turn = best(firstEvents(ppl, (e) => e.kind === "turning" && e.lo <= A && A <= e.hi), (x) => x.p);
  if (turn) line("turning", t("turning_same", { a: A, name: nm(turn.p), what: what(turn.e) }), turn.p);
  const next = best(firstEvents(ppl, (e) => e.kind === "bloom" && e.lo > A && e.lo <= A + AHEAD_YEARS), (x) => x.p);
  if (next) line("bloom", t("bloom_next", { n: next.e.lo - A, b: next.e.lo, name: nm(next.p), what: what(next.e) }), next.p);
  $("compare").innerHTML = li.join("");
}

function renderColumns() {
  const A = state.view;
  const ppl = state.people.filter(visible);

  const died = ppl.filter((p) => diedAt(p, A)).sort(byScore);
  $("colDied").innerHTML = listHTML(died, (p) => item(p, t("died_at", { n: deathLabel(p) }), null));

  const now = firstEvents(ppl, (e) => e.lo <= A && A <= e.hi).sort((x, y) => byScore(x.p, y.p));
  $("colNow").innerHTML = listHTML(now, ({ p, e }) =>
    item(p, `${yearLabel(e.year)} · ${ageLabel(e)}`, e.text[LANG], null, e.kind));

  // この先に花開く人：開花（成果）だけ。知名度の高い10人を選び、年齢順に並べる
  // 遠すぎる未来（14歳に「30年後」など）は関連が薄いので AHEAD_YEARS 年以内に限る
  const later = firstEvents(ppl, (e) => e.kind === "bloom" && e.lo > A && e.lo <= A + AHEAD_YEARS).sort((x, y) => byScore(x.p, y.p));
  const ahead = later.slice(0, 10).sort((x, y) => (x.e.lo - y.e.lo) || byScore(x.p, y.p));
  $("colAhead").innerHTML = listHTML(ahead, ({ p, e }) =>
    item(p, `${yearLabel(e.year)} · ${ageLabel(e)}`, e.text[LANG], t("in_years", { n: e.lo - A })), 10, later.length - ahead.length);
}

function listHTML(arr, fn, limit = 10, extra = 0) {
  if (!arr.length) return `<li class="more">${t("none")}</li>`;
  let h = arr.slice(0, limit).map(fn).join("");
  const more = Math.max(0, arr.length - limit) + extra;
  if (more > 0) h += `<li class="more">${t("more", { n: more })}</li>`;
  return h;
}

function item(p, meta, text, when, kind) {
  const desc = descOf(p);
  return `<li>${when ? `<span class="when">${esc(when)}</span>` : ""}
    <div class="name">${p.featured ? '<span class="feat">✦</span>' : ""}${nameLink(p)}</div>
    <div class="meta">${esc(t(`fields.${p.field}`))} · ${lifeSpan(p)} · ${esc(meta)}</div>
    ${text ? `<div class="text">${kind ? kindBadge(kind) : ""}${esc(text)}</div>` : ""}
    ${desc ? `<div class="desc">${esc(desc)}</div>` : ""}</li>`;
}

// ---------- 検索 ----------
// ひらがな→カタカナ、全角英数→半角、中黒・空白・記号を除いて小文字に
function normalize(s) {
  return (s || "").normalize("NFKC").toLowerCase()
    .replace(/[ぁ-ゖ]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0x60))
    .replace(/[\s・･=＝\-‐.,'’"()（）]/g, "")
    .normalize("NFD").replace(/[̀-ͯ]/g, "");
}

function search(q) {
  const k = normalize(q);
  if (!k) return [];
  const hits = [];
  for (const p of state.people) {
    // 名前の先頭で当たるものを優先し、同じなら知名度順
    if (p.key.includes(k)) hits.push({ p, head: p.key.includes("|" + k) });
  }
  return hits.sort((x, y) => (y.head - x.head) || byScore(x.p, y.p)).slice(0, 8).map((h) => h.p);
}

function bindSearch() {
  const box = $("q"), list = $("hits");
  let cur = -1, results = [];
  const show = () => {
    results = search(box.value);
    cur = results.length ? 0 : -1;
    if (!box.value.trim()) { list.hidden = true; return; }
    list.innerHTML = results.length
      ? results.map((p, i) => `<li class="${i === cur ? "on" : ""}" data-person="${esc(p.id)}">
          <b>${esc(nm(p))}</b><span class="muted"> ${esc(LANG === "ja" ? p.name.en : p.name.ja)} · ${lifeSpan(p)}</span>
          ${descOf(p) ? `<div class="muted small">${esc(short(descOf(p), 50))}</div>` : ""}</li>`).join("")
      : `<li class="muted">${t("no_hit")}</li>`;
    list.hidden = false;
  };
  box.addEventListener("input", show);
  box.addEventListener("focus", () => { if (box.value.trim()) show(); });
  box.addEventListener("keydown", (ev) => {
    if (!results.length) return;
    if (ev.key === "ArrowDown" || ev.key === "ArrowUp") {
      ev.preventDefault();
      cur = (cur + (ev.key === "ArrowDown" ? 1 : results.length - 1)) % results.length;
      [...list.children].forEach((li, i) => li.classList.toggle("on", i === cur));
    } else if (ev.key === "Enter" && cur >= 0) {
      ev.preventDefault();
      openCard(results[cur].id);
    }
  });
  document.addEventListener("click", (ev) => { if (!ev.target.closest(".search")) list.hidden = true; });
}

// ---------- 人物カード ----------
function openCard(id) {
  const p = state.byId.get(id);
  if (!p) return;
  state.cardId = id;
  $("hits").hidden = true;
  const rows = p.events.map((e) => `<li>${kindBadge(e.kind)}<span class="when-l">${esc(yearLabel(e.year))} · ${esc(ageLabel(e))}</span>
      <span>${esc(e.text[LANG])}</span><button type="button" class="go" data-age="${e.lo}">${esc(t("see_age"))}</button></li>`);
  if (p.deathAge != null) {
    rows.push(`<li><span class="badge died">${esc(LANG === "ja" ? "没" : "Died")}</span><span class="when-l">${esc(yearLabel(p.died.y))} · ${esc(t("at_age", { n: deathLabel(p) }))}</span>
      <span></span><button type="button" class="go" data-age="${p.deathLo}">${esc(t("see_age"))}</button></li>`);
  }
  const url = wikiUrl(p);
  const v = views(p);
  const photo = p.img ? `<figure class="photo">
      <img src="${esc(commonsThumb(p.img))}" alt="${esc(nm(p))}" loading="lazy" onerror="this.closest('figure').remove()">
      <figcaption id="credit"><a href="${esc(commonsPage(p.img))}" target="_blank" rel="noopener">Wikimedia Commons</a></figcaption>
    </figure>` : "";
  $("cardBody").innerHTML = photo + `
    <h3>${p.featured ? '<span class="feat">✦</span>' : ""}${esc(nm(p))}</h3>
    <div class="sub">${esc(LANG === "ja" ? p.name.en : p.name.ja)}</div>
    <div class="meta">${esc(t(`fields.${p.field}`))} · ${lifeSpan(p)}${p.deathAge != null ? ` · ${esc(t("died_at", { n: deathLabel(p) }))}` : ` · ${esc(t("living"))}`}</div>
    ${descOf(p) ? `<p class="cdesc">${esc(descOf(p))}</p>` : ""}
    <h4>${esc(t("life"))}</h4>
    <ul class="tl">${rows.join("") || `<li class="muted">${t("none")}</li>`}</ul>
    <div class="cfoot">${url ? `<a href="${esc(url)}" target="_blank" rel="noopener">${esc(t("wiki"))} ↗</a>` : ""}
      ${v ? `<span class="muted small">${esc(t("fame"))}: ${v.toLocaleString()}</span>` : ""}</div>`;
  $("card").hidden = false;
  if (p.img) loadCredit(p.img);
}
// ---------- 共有 ----------
// 見出しの3行と、この年齢で開けるURLをまとめる。共有メニューがあればそれを、なければクリップボードへ
function shareText() {
  const head = LANG === "ja" ? `${state.myAge}歳。` : `Age ${state.myAge}.`;
  return [head, ...(state.headLines || [])].join("\n");
}
async function share() {
  syncUrl();
  const url = location.href;
  const text = shareText();
  try {
    if (navigator.share) {
      await navigator.share({ title: t("title"), text, url });
      return;
    }
    await navigator.clipboard.writeText(`${text}\n${url}`);
    $("shareMsg").textContent = t("copied");
  } catch (e) {
    $("shareMsg").textContent = "";
  }
  setTimeout(() => { $("shareMsg").textContent = ""; }, 2500);
}

// ---------- 写真（Wikimedia Commons） ----------
// 画像は Commons の縮小版を直接読む。作者とライセンスは画像ごとに違うので、カードを開いたときに取りに行って添える
const commonsThumb = (f) => `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(f)}?width=240`;
const commonsPage = (f) => `https://commons.wikimedia.org/wiki/File:${encodeURIComponent(f)}`;
const creditCache = new Map();
async function loadCredit(file) {
  let c = creditCache.get(file);
  if (!c) {
    try {
      const url = "https://commons.wikimedia.org/w/api.php?action=query&format=json&formatversion=2&origin=*"
        + "&prop=imageinfo&iiprop=extmetadata&iiextmetadatafilter=Artist|LicenseShortName&titles="
        + encodeURIComponent(`File:${file}`);
      const m = (await (await fetch(url)).json()).query.pages[0].imageinfo[0].extmetadata;
      const plain = (h) => { const d = document.createElement("div"); d.innerHTML = h || ""; return d.textContent.trim(); };
      c = { artist: plain(m.Artist?.value), license: plain(m.LicenseShortName?.value) };
      creditCache.set(file, c);
    } catch (e) {
      return; // 取れなくても Commons へのリンクは出ている
    }
  }
  const el = $("credit");
  if (!el) return;
  const who = [c.artist && short(c.artist, 40), c.license].filter(Boolean).join(" / ");
  el.innerHTML = `${t("photo")}: ${esc(who || "")} · <a href="${esc(commonsPage(file))}" target="_blank" rel="noopener">Wikimedia Commons</a>`;
}

function closeCard() { $("card").hidden = true; state.cardId = null; }

// ---------- 星空 ----------
const PAD = 28;
const ageToX = (a, w) => PAD + (a / AXIS_MAX) * (w - PAD * 2);
const xToAge = (x, w) => Math.max(0, Math.min(MAX_AGE, ((x - PAD) / (w - PAD * 2)) * AXIS_MAX));
let skyPoints = [];

// スライダーのつまみの中心が、星図上の「その年齢の帯」の中心に来るように置く
function layoutSlider() {
  const w = $("sky").clientWidth;
  if (!w) return;
  const x0 = ageToX(0.5, w), x1 = ageToX(MAX_AGE + 0.5, w);
  const s = $("view");
  s.style.marginLeft = `${x0 - THUMB / 2}px`;
  s.style.width = `${x1 - x0 + THUMB}px`;
}

function drawSky() {
  const c = $("sky");
  const dpr = window.devicePixelRatio || 1;
  const w = c.clientWidth, h = c.clientHeight;
  c.width = w * dpr; c.height = h * dpr;
  const g = c.getContext("2d");
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, w, h);
  const horizon = h * 0.55;
  const A = state.view;

  // 「今見ている年齢」の光の帯 [A, A+1)
  const bx0 = ageToX(A, w), bx1 = ageToX(A + 1, w);
  const grad = g.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, "rgba(255,255,255,0.02)");
  grad.addColorStop(0.55, "rgba(255,255,255,0.16)");
  grad.addColorStop(1, "rgba(255,255,255,0.02)");
  g.fillStyle = grad;
  g.fillRect(bx0, 0, Math.max(2, bx1 - bx0), h);

  // 地平線と目盛り
  g.strokeStyle = "rgba(255,255,255,0.12)";
  g.beginPath(); g.moveTo(PAD, horizon); g.lineTo(w - PAD, horizon); g.stroke();
  g.fillStyle = "rgba(255,255,255,0.35)";
  g.font = "10px system-ui";
  g.textAlign = "center";
  for (let a = 0; a <= MAX_AGE; a += 10) {
    const x = ageToX(a, w);
    g.fillRect(x, horizon - 3, 1, 6);
    g.fillText(a, x, horizon + 16);
  }

  skyPoints = [];
  const add = (p, age, above, e) => {
    const x = ageToX(age, w);
    const r = above ? p.y1 : p.y2;
    const y = above ? 22 + r * (horizon - 38) : horizon + 26 + r * (h - horizon - 36);
    const near = e ? e.lo <= A && A <= e.hi : diedAt(p, A);
    skyPoints.push({ x, y, p, age, above, e, near, col: e ? COLOR[e.kind] : COLOR.died, s: score(p) });
  };
  for (const p of state.people) {
    if (!visible(p)) continue;
    if (p.deathAge != null && p.deathAge < AXIS_MAX) add(p, p.deathAge, false, null);
    for (const e of p.events) if (e.age < AXIS_MAX) add(p, e.age, true, e);
  }
  skyPoints.sort((a, b) => a.s - b.s); // 有名な星ほど手前に

  // 明るさと大きさは知名度で（閲覧数の対数 1〜6 を 0〜1 に）
  for (const s of skyPoints) {
    const f = Math.max(0, Math.min(1, (s.s - 1.5) / 4));
    const alpha = s.near ? 0.95 : 0.18 + 0.6 * f;
    const rad = (s.near ? 1.6 : 0.9) + 2.2 * f;
    if (s.near || f > 0.7) {
      g.shadowColor = `rgba(${s.col},0.9)`;
      g.shadowBlur = 4 + 8 * f;
    }
    g.fillStyle = `rgba(${s.col},${alpha})`;
    g.beginPath(); g.arc(s.x, s.y, rad, 0, Math.PI * 2); g.fill();
    g.shadowBlur = 0;
  }
  // 選んだ年齢の、知名度の高い人に名前（重なるときは縦にずらす）
  g.font = "11px 'Noto Sans JP', system-ui";
  g.textAlign = "left";
  const placed = [];
  const labeled = skyPoints.filter((s) => s.near).sort((a, b) => b.s - a.s).slice(0, 14);
  for (const s of labeled) {
    const label = nm(s.p);
    const lw = g.measureText(label).width;
    const tx = s.x + 7 + lw > w ? s.x - 7 - lw : s.x + 7;
    let ty = s.y + 4;
    while (placed.some((b) => Math.abs(b.y - ty) < 13 && tx < b.x + b.w && b.x < tx + lw)) ty += 13;
    // 地平線（下の星なら下端）を越えるほど押し出された名前は描かない。下の欄に一覧がある
    if (ty > (s.above ? horizon - 4 : h - 18)) continue;
    placed.push({ x: tx, y: ty, w: lw });
    g.fillStyle = `rgba(${s.col},0.95)`;
    g.fillText(label, tx, ty);
  }

  // 帯の上に年齢
  g.fillStyle = "#fff";
  g.font = "600 13px 'Shippori Mincho', serif";
  g.textAlign = "center";
  g.fillText(LANG === "ja" ? `${A}歳` : `${A}`, Math.min(w - 20, Math.max(20, (bx0 + bx1) / 2)), 14);

  // 自分の実年齢
  if (state.myAge < AXIS_MAX) {
    const mx = ageToX(state.myAge + 0.5, w);
    g.strokeStyle = "rgba(255,255,255,0.85)";
    g.setLineDash([3, 4]);
    g.beginPath(); g.moveTo(mx, 20); g.lineTo(mx, h - 16); g.stroke();
    g.setLineDash([]);
    g.font = "11px system-ui";
    g.fillText(t("you"), mx, h - 4);
  }

  if (state.hover) {
    const s = state.hover;
    g.strokeStyle = "#fff";
    g.beginPath(); g.arc(s.x, s.y, 6, 0, Math.PI * 2); g.stroke();
  }
}

function onSkyHover(ev) {
  const c = $("sky");
  const r = c.getBoundingClientRect();
  const x = ev.clientX - r.left, y = ev.clientY - r.top;
  let bestPt = null, bd = 144;
  for (const s of skyPoints) {
    const d = (s.x - x) ** 2 + (s.y - y) ** 2 - s.s * 8;
    if (d < bd) { bd = d; bestPt = s; }
  }
  state.hover = bestPt;
  const tip = $("tip");
  if (!bestPt) { tip.hidden = true; drawSky(); return; }
  const p = bestPt.p;
  const head = bestPt.e ? `${yearLabel(bestPt.e.year)} · ${ageLabel(bestPt.e)}` : t("died_at", { n: deathLabel(p) });
  const body = bestPt.e ? `${t(`kinds.${bestPt.e.kind}`)}: ${bestPt.e.text[LANG]}` : "";
  const desc = descOf(p);
  tip.innerHTML = `<b>${esc(nm(p))}</b><span class="muted">${lifeSpan(p)} · ${esc(head)}</span>`
    + (body ? `<br>${esc(body)}` : "") + (desc ? `<br><span class="muted">${esc(short(desc, 60))}</span>` : "");
  tip.hidden = false;
  tip.style.left = `${Math.max(0, Math.min(bestPt.x + 12, r.width - 270))}px`;
  tip.style.top = `${bestPt.y + 12}px`;
  drawSky();
}

// ---------- ライフバー ----------
function drawLifebars() {
  const svg = $("lifebars");
  const w = svg.clientWidth || 800;
  const A = state.view;
  // 表示する人：この年齢で没した人・この年齢の転機/開花・この先に花開く人から、知名度の高い順に
  const ppl = state.people.filter(visible);
  const pick = [];
  const push = (p) => { if (p && !pick.includes(p) && pick.length < 8) pick.push(p); };
  ppl.filter((p) => diedAt(p, A)).sort(byScore).slice(0, 3).forEach(push);
  firstEvents(ppl, (e) => e.lo <= A && A <= e.hi).sort((x, y) => byScore(x.p, y.p)).slice(0, 3).forEach((x) => push(x.p));
  firstEvents(ppl, (e) => e.kind === "bloom" && e.lo > A && e.lo <= A + AHEAD_YEARS).sort((x, y) => byScore(x.p, y.p)).slice(0, 2).forEach((x) => push(x.p));

  const labelW = Math.min(170, w * 0.3);
  const x = (a) => labelW + (a / AXIS_MAX) * (w - labelW - 12);
  const rowH = 26;
  const rows = [{ you: true }, ...pick.map((p) => ({ p }))];
  const H = rows.length * rowH + 28;
  svg.setAttribute("viewBox", `0 0 ${w} ${H}`);
  svg.setAttribute("height", H);

  let s = `<g class="axis">`;
  for (let a = 0; a <= MAX_AGE; a += 10) s += `<text x="${x(a)}" y="${H - 6}" text-anchor="middle">${a}</text><line x1="${x(a)}" x2="${x(a)}" y1="0" y2="${H - 18}" stroke="rgba(255,255,255,0.06)"/>`;
  s += `</g>`;
  s += `<rect x="${x(A)}" y="0" width="${x(A + 1) - x(A)}" height="${H - 18}" fill="rgba(255,255,255,0.10)"/>`;
  rows.forEach((r, i) => {
    const y = i * rowH + 14;
    if (r.you) {
      const a = state.myAge + 0.5;
      s += `<text x="0" y="${y + 4}" font-weight="500">${esc(t("you"))}</text>`;
      s += `<rect x="${x(0)}" y="${y - 4}" width="${x(Math.min(a, AXIS_MAX)) - x(0)}" height="8" rx="4" fill="rgba(255,255,255,0.85)"/>`;
      return;
    }
    const p = r.p;
    const end = p.deathAge ?? ageBetween(p.born, today());
    s += `<text x="0" y="${y + 4}">${esc(short(nm(p), 18))}</text>`;
    s += `<rect x="${x(0)}" y="${y - 3}" width="${x(Math.min(end, AXIS_MAX)) - x(0)}" height="6" rx="3" fill="rgba(255,255,255,0.18)"/>`;
    if (p.deathAge != null) s += `<circle cx="${x(Math.min(end, AXIS_MAX))}" cy="${y}" r="4" fill="rgb(${COLOR.died})"><title>${esc(t("died_at", { n: deathLabel(p) }))}</title></circle>`;
    else s += `<text x="${x(Math.min(end, AXIS_MAX)) + 4}" y="${y + 4}" fill="#8b90a6" font-size="10">${esc(t("living"))}</text>`;
    for (const e of p.events) s += `<circle cx="${x(Math.min(e.age, AXIS_MAX))}" cy="${y}" r="4" fill="rgb(${COLOR[e.kind]})"><title>${esc(ageLabel(e) + " — " + e.text[LANG])}</title></circle>`;
  });
  svg.innerHTML = s;
}

// ---------- 起動 ----------
bindInputs();
loadInputs();
render();
loadData();
