// 画面の処理をブラウザなしで検査する（Node.js で実行）
//
//     node scripts/test_app.js
//
// app.js をそのまま読み込み、最小限の DOM の代用品の上で動かす。データは data/ の実物を使う。
// 失敗があれば一覧を出して終了コード 1。変更のたびに流して、壊れていないことを確かめる。
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const ROOT = path.join(__dirname, "..");

// ---------- DOM の代用品 ----------
const noop = () => {};
const ctx2d = new Proxy({}, {
  get: (t, k) => (k === "measureText" ? () => ({ width: 50 }) : k === "createLinearGradient" ? () => ({ addColorStop: noop }) : noop),
  set: () => true,
});
const els = {};
function el(id) {
  if (!els[id]) {
    els[id] = {
      id, hidden: false, value: "", textContent: "", innerHTML: "", style: {}, dataset: {}, children: [],
      clientWidth: 900, clientHeight: 380, classList: { toggle: noop, add: noop },
      addEventListener: noop, append: noop, setAttribute: noop, focus: noop, scrollIntoView: noop, setPointerCapture: noop,
      querySelector: () => null, querySelectorAll: () => [],
      getContext: () => ctx2d, getBoundingClientRect: () => ({ left: 0, top: 0, width: 900, height: 380 }),
    };
  }
  return els[id];
}
const store = {};
let href = "http://127.0.0.1:8795/";
const sandbox = {
  console, Math, Date, JSON, Promise, Map, Set, Object, Array, String, Number, URL, URLSearchParams,
  parseInt, parseFloat, isNaN, encodeURIComponent,
  navigator: { language: "ja" },
  localStorage: { getItem: (k) => store[k] ?? null, setItem: (k, v) => (store[k] = String(v)), removeItem: (k) => delete store[k] },
  location: { get href() { return href; }, get search() { return new URL(href).search; } },
  history: { replaceState: (a, b, u) => { href = String(u); } },
  window: { addEventListener: noop, removeEventListener: noop, scrollBy: noop, devicePixelRatio: 1, innerWidth: 900, innerHeight: 800 },
  document: {
    getElementById: el, querySelector: el, querySelectorAll: () => [], addEventListener: noop, removeEventListener: noop,
    documentElement: {}, title: "", body: el("body"),
    createElement: () => ({
      onclick: null, style: {}, set innerHTML(v) { this._h = v; }, get textContent() { return (this._h || "").replace(/<[^>]+>/g, ""); },
      setAttribute: noop, addEventListener: noop, querySelector: () => null,
    }),
  },
  fetch: async (url) => {
    if (/^https?:/.test(url)) throw new Error("network disabled in test");
    const f = path.join(ROOT, url.split("?")[0]);
    return { ok: true, json: async () => JSON.parse(fs.readFileSync(f, "utf8")) };
  },
};
vm.createContext(sandbox);
for (const f of ["i18n.js", "app.js", "tour.js"]) vm.runInContext(fs.readFileSync(path.join(ROOT, f), "utf8"), sandbox, { filename: f });
const run = (code) => vm.runInContext(code, sandbox);

// ---------- 検査 ----------
const failures = [];
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "ok  " : "NG  "} ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures.push(name);
};

setTimeout(async () => {
  await new Promise((r) => setTimeout(r, 2500)); // loadData() の完了待ち
  const n = run("state.people.length");
  check("データを読み込める", n > 3000, `${n}人`);
  check("初期の年齢は30歳", run("state.myAge") === 30 && run("state.view") === 30);

  // ドラッグ中は見出しが変わらず、離すと変わる
  run("state.view = 30; commitAge();");
  const before = el("compare").innerHTML;
  run("setView(45);");
  check("ドラッグ中は見出しが変わらない", el("compare").innerHTML === before);
  check("ドラッグ中も欄は動く", el("colDied").innerHTML.includes("45歳で没"));
  run("commitAge();");
  check("離すと見出しが変わる", el("compare").innerHTML !== before);
  check("年齢を覚える", store["ga.age"] === "45");
  check("URL に年齢が入る", new URL(href).searchParams.get("age") === "45");

  // 全年齢で：この先は15年以内・開花だけ／同じ欄に同じ人が2度出ない／見出しの括弧が二重にならない
  const res = run(`(function () {
    const bad = [];
    for (let a = 0; a <= 100; a++) {
      state.view = a; commitAge();
      for (const m of $("colAhead").innerHTML.matchAll(/あと(\\d+)年/g)) if (+m[1] > AHEAD_YEARS || +m[1] < 1) bad.push("ahead " + a + ":" + m[1]);
      for (const id of ["colDied", "colNow", "colAhead"]) {
        const ids = [...$(id).innerHTML.matchAll(/data-person="([^"]+)"/g)].map((m) => m[1]);
        if (new Set(ids).size !== ids.length) bad.push("dup " + id + " " + a);
      }
      if (/「「|」」|は「を/.test($("compare").innerHTML)) bad.push("headline " + a);
    }
    return bad;
  })()`);
  check("全年齢: この先は1〜15年以内・同じ人が重複しない・見出しの括弧", res.length === 0, res.slice(0, 5).join(", "));

  const ahead = run(`(function () {
    const bad = [];
    for (let a = 0; a <= 100; a += 5) {
      state.view = a; renderColumns();
      if (/badge turning/.test($("colAhead").innerHTML)) bad.push(a);
    }
    return bad;
  })()`);
  check("「この先に花開く人」に転機が混ざらない", ahead.length === 0, ahead.join(","));

  // データの整合
  const data = run(`(function () {
    const bad = [];
    for (const p of state.people) {
      if (p.deathLo != null && (p.deathLo > p.deathHi || p.deathLo < 0)) bad.push("death " + p.name.en);
      for (const e of p.events) {
        if (e.lo > e.hi) bad.push("range " + p.name.en);
        if (p.deathHi != null && e.lo > p.deathHi) bad.push("after-death " + p.name.en + " " + e.text.ja);
      }
      if (!p.desc.ja && !p.desc.en) bad.push("no-desc " + p.name.en);
    }
    return bad;
  })()`);
  check("没年齢・出来事の年齢に矛盾がない、説明がある", data.length === 0, data.slice(0, 5).join(", "));

  // 年までしか分からない人は幅で出る
  const vermeer = run(`(function () { const p = state.people.find((x) => x.name.en === "Johannes Vermeer"); return p ? deathLabel(p) : null; })()`);
  check("生没が年までの人は幅で出る（フェルメール）", vermeer === null || /〜/.test(String(vermeer)), String(vermeer));

  // 見出しの「この先」：近い未来に誰かいるなら遠くを選ばない（39歳で14年後のノーラン、を防ぐ）。
  // その年齢に開花がある人がいれば見出しにも出す（7歳のアカデミー子役賞など）
  const head = run(`(function () {
    const bad = [];
    for (let a = 0; a <= 100; a++) {
      state.view = a; commitAge();
      const ppl = state.people.filter(visible);
      const m = $("compare").innerHTML.match(/(\\d+)年後の/);
      if (m) {
        const n = +m[1];
        const nearest = HEADLINE_WINDOWS.find((w) => firstEvents(ppl, (e) => e.kind === "bloom" && e.lo > a && e.lo <= a + w).length);
        if (nearest && n > nearest) bad.push(a + "歳: " + n + "年後（" + nearest + "年以内に候補あり）");
      }
      const hasBloomNow = firstEvents(ppl, (e) => e.kind === "bloom" && e.lo <= a && a <= e.hi).length > 0;
      if (hasBloomNow && !/class="bloom">\\d+歳で/.test($("compare").innerHTML)) bad.push(a + "歳: 同じ年齢の開花が見出しにない");
    }
    return bad;
  })()`);
  check("見出し: 近い未来を優先・同じ年齢の開花を出す", head.length === 0, head.slice(0, 4).join(", "));
  run("state.view = 39; commitAge();");
  console.log("     39歳の見出し: " + run("state.headLines.join(' / ')"));
  run("state.view = 7; commitAge();");
  console.log("     7歳の見出し: " + run("state.headLines.join(' / ')"));

  // 共有の文面：年齢と見出しの3行
  run("state.view = 30; commitAge();");
  const shared = run("shareText()");
  check("共有の文面に年齢と見出しが入る", shared.startsWith("30歳。") && shared.split("\n").length >= 3, shared.split("\n").slice(0, 2).join(" / "));

  // 検索
  const hit = run(`search("あいんしゅたいん").map((p) => p.name.en)`);
  check("検索（ひらがな）", hit.includes("Albert Einstein"), hit.slice(0, 3).join(","));
  check("検索（英語）", run(`search("einstein").length`) > 0);

  // URL で年齢を指定して開ける
  const age = run(`(function () { const s = location.search; history.replaceState(null, "", "http://x/?age=12"); state.myAge = 30; loadInputs(); const a = state.myAge; history.replaceState(null, "", "http://x/" + s); return a; })()`);
  check("URL の ?age= で年齢を開ける", age === 12, String(age));

  // 初回の使い方ガイド
  check("初回はガイドが開く", run("tourOpen") === true);
  run("endTour()");
  check("ガイドを閉じると覚える", store["ga.tour"] === "done" && run("tourOpen") === false);
  run("maybeStartTour()");
  check("2回目からは出ない", run("tourOpen") === false);
  const viaLink = run(`(function () {
    const s = location.search; localStorage.removeItem("ga.tour");
    history.replaceState(null, "", "http://x/?age=12"); loadInputs(); maybeStartTour();
    const r = { open: tourOpen, age: state.myAge }; endTour(); history.replaceState(null, "", "http://x/" + s); return r;
  })()`);
  check("共有リンク（?age=）でも初回は出て、年齢はそのまま", viaLink.open === true && viaLink.age === 12, JSON.stringify(viaLink));
  const missing = run(`(function () {
    const bad = []; const keep = LANG;
    for (const l of ["ja", "en"]) { LANG = l; for (const k of [...TOUR_STEPS.map((x) => x.key), "tour_next", "tour_back", "tour_skip", "tour_start", "help"]) if (t(k) === k) bad.push(l + ":" + k); }
    LANG = keep; return bad;
  })()`);
  check("ガイドの文言が日英ともある", missing.length === 0, missing.join(","));

  console.log(failures.length ? `\n${failures.length} 件の失敗` : "\nすべて通過");
  process.exit(failures.length ? 1 : 0);
}, 0);
