// 初回だけの使い方ガイド：部品を1つずつ照らし、吹き出しで説明する（4ステップ）
// 見終えるかスキップすると localStorage の ga.tour を "done" にして、次からは出さない。右上の「?」で見直せる
const TOUR_KEY = "ga.tour";
const TOUR_STEPS = [
  { key: "tour_1", targets: () => [document.querySelector(".slider"), $("sky")] },
  { key: "tour_2", targets: () => [$("sky")] },
  // 欄は縦に長く画面に収まらないので、見出しと1人目だけ照らす（スマホは1列に並ぶので先頭の欄だけ）
  { key: "tour_3", targets: () => {
    const col = window.innerWidth <= 760 ? ".col.died" : ".col";
    return [...document.querySelectorAll(`${col} h2`), ...document.querySelectorAll(`${col} li:first-child`)];
  } },
  { key: "tour_4", targets: () => [$("share")] },
];
let tourOpen = false, tourStep = 0;
const tourEls = {};

function maybeStartTour() {
  let seen = true; // 読めないときは出さない（毎回出てしまうのを防ぐ）
  try { seen = localStorage.getItem(TOUR_KEY) === "done"; } catch (e) {}
  if (!seen) startTour();
}

function buildTour() {
  // block: 下の画面の操作を受け止める透明な幕 / hole: 照らす枠（周りを影で暗くする） / pop: 吹き出し
  for (const k of ["block", "hole", "pop"]) {
    const d = document.createElement("div");
    d.className = `tour-${k}`;
    d.hidden = true;
    document.body.append(d);
    tourEls[k] = d;
  }
  tourEls.pop.setAttribute("role", "dialog");
  tourEls.pop.setAttribute("aria-modal", "true");
  tourEls.pop.addEventListener("click", (ev) => {
    const b = ev.target.closest("[data-act]");
    if (!b) return;
    const act = b.dataset.act;
    if (act === "skip") endTour();
    else if (act === "back") showStep(tourStep - 1);
    else if (tourStep === TOUR_STEPS.length - 1) endTour();
    else showStep(tourStep + 1);
  });
}

function startTour() {
  if (tourOpen) return;
  closeCard();
  $("hits").hidden = true;
  if (!tourEls.pop) buildTour();
  tourOpen = true;
  for (const k of ["block", "hole", "pop"]) tourEls[k].hidden = false;
  window.addEventListener("resize", placeTour);
  window.addEventListener("scroll", placeTour, { passive: true });
  document.addEventListener("keydown", onTourKey, true);
  showStep(0);
}

function endTour() {
  if (!tourOpen) return;
  tourOpen = false;
  for (const k of ["block", "hole", "pop"]) tourEls[k].hidden = true;
  window.removeEventListener("resize", placeTour);
  window.removeEventListener("scroll", placeTour);
  document.removeEventListener("keydown", onTourKey, true);
  try { localStorage.setItem(TOUR_KEY, "done"); } catch (e) {}
}

// scroll=false は文言と位置の更新だけ（データの読み込み後や言語の切り替え時）
function showStep(i, scroll = true) {
  tourStep = Math.max(0, Math.min(TOUR_STEPS.length - 1, i));
  const n = TOUR_STEPS.length, last = tourStep === n - 1;
  const btn = (act, label, cls = "") => `<button type="button" class="${cls}" data-act="${act}">${esc(label)}</button>`;
  tourEls.pop.innerHTML = `<p class="tour-n">${tourStep + 1} / ${n}</p>
    <p class="tour-text">${esc(t(TOUR_STEPS[tourStep].key))}</p>
    <div class="tour-btns">${last ? "<span></span>" : btn("skip", t("tour_skip"), "tour-skip")}
      <span>${tourStep ? btn("back", t("tour_back")) : ""}${btn("next", last ? t("tour_start") : `${t("tour_next")} →`, "tour-next")}</span></div>`;
  if (scroll) scrollToStep();
  placeTour();
  tourEls.pop.querySelector(".tour-next")?.focus({ preventScroll: true });
}
function tourRefresh() { if (tourOpen) showStep(tourStep, false); }

function tourRect() {
  const rs = TOUR_STEPS[tourStep].targets().filter(Boolean).map((e) => e.getBoundingClientRect());
  if (!rs.length) return null;
  const left = Math.min(...rs.map((r) => r.left)), top = Math.min(...rs.map((r) => r.top));
  const right = Math.max(...rs.map((r) => r.left + r.width)), bottom = Math.max(...rs.map((r) => r.top + r.height));
  return { left, top, width: right - left, height: bottom - top };
}

const TOUR_PAD = 8, TOUR_MARGIN = 16, TOUR_GAP = 12; // 枠の余白・画面端の余白・枠と吹き出しの間

// 照らす部品と吹き出しがまとめて画面の中ほどに来るようにスクロールする
function scrollToStep() {
  const r = tourRect();
  if (!r) return;
  const need = r.height + TOUR_PAD * 2 + TOUR_GAP + tourEls.pop.offsetHeight;
  const top = Math.max(TOUR_MARGIN, (window.innerHeight - need) / 2) + TOUR_PAD;
  window.scrollBy({ top: r.top - top, behavior: "smooth" });
}

function placeTour() {
  if (!tourOpen) return;
  const r = tourRect();
  if (!r) return;
  const hole = { left: r.left - TOUR_PAD, top: r.top - TOUR_PAD, width: r.width + TOUR_PAD * 2, height: r.height + TOUR_PAD * 2 };
  for (const k of ["left", "top", "width", "height"]) tourEls.hole.style[k] = `${hole[k]}px`;
  // 吹き出しは枠の下。入らなければ上、それも無理なら画面の下端に重ねる
  const pop = tourEls.pop;
  const vw = document.documentElement.clientWidth || window.innerWidth, vh = window.innerHeight;
  const pw = pop.offsetWidth, ph = pop.offsetHeight;
  let top = hole.top + hole.height + TOUR_GAP;
  if (top + ph > vh - TOUR_MARGIN) {
    const above = hole.top - TOUR_GAP - ph;
    top = above >= TOUR_MARGIN ? above : Math.max(TOUR_MARGIN, vh - TOUR_MARGIN - ph);
  }
  const left = Math.max(TOUR_MARGIN, Math.min(vw - TOUR_MARGIN - pw, hole.left + hole.width / 2 - pw / 2));
  pop.style.top = `${top}px`;
  pop.style.left = `${left}px`;
}

function onTourKey(ev) {
  if (ev.key === "Escape") { ev.preventDefault(); endTour(); }
  else if (ev.key === "ArrowRight") { ev.preventDefault(); if (tourStep < TOUR_STEPS.length - 1) showStep(tourStep + 1); }
  else if (ev.key === "ArrowLeft") { ev.preventDefault(); if (tourStep > 0) showStep(tourStep - 1); }
  else if (ev.key === "Tab") {
    // フォーカスを吹き出しのボタンの中で回す（後ろのつまみで年齢が変わらないように）
    const bs = [...tourEls.pop.querySelectorAll("button")];
    if (!bs.length) return;
    ev.preventDefault();
    const i = bs.indexOf(document.activeElement);
    bs[(i + (ev.shiftKey ? bs.length - 1 : 1)) % bs.length].focus();
  }
}

$("help").addEventListener("click", startTour);
