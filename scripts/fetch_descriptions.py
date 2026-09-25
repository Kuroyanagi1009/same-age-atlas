"""data/stars.json の説明文を Wikipedia（日・英）の冒頭文で差し替える。

    python scripts/fetch_descriptions.py

- Wikipedia API は未ログインだと約10回/25秒で 429 になるので、3秒おきに取得する（約20〜30分）
- 取得結果は data/_desc_cache.json に貯めるので、中断しても続きから再開できる
- 冒頭文は括弧書き（読み・生没年）と「出身」「本名」などの文を除き、2文・約120字までに縮める
- Wikipedia の本文は CC BY-SA 4.0。画面では記事へのリンクを添える
"""
import json
import re
import time
from pathlib import Path

import requests

ROOT = Path(__file__).resolve().parent.parent
STARS = ROOT / "data" / "stars.json"
CACHE = ROOT / "data" / "_desc_cache.json"
HEADERS = {"User-Agent": "great-ages/0.1 (personal non-commercial research script)"}
PER_REQUEST = 20
INTERVAL = 3.0

JA_SKIP = re.compile(r"出身|本名|旧姓|通称|愛称|号は|字は|旧名|身長|血液型|所属事務所|位階|勲等|爵位|称号は|"
                     r"戒名|法名|諡|幼名|別名|筆名|ペンネーム|登録名|愛称は")


def strip_brackets(s):
    """（…）(…)〈…〉[…] を入れ子ごと消す"""
    prev = None
    while prev != s:
        prev = s
        # 全角・半角が混ざった括弧（「(…）」など）も対にして消す
        s = re.sub(r"[（(][^（）()]*[）)]|〈[^〈〉]*〉|\[[^\[\]]*\]|［[^［］]*］", "", s)
    return re.sub(r"\s+", " ", s).strip()


def clean_ja(text, name=""):
    text = strip_brackets(text.split("\n")[0])
    sents = [s.strip() + "。" for s in text.split("。") if s.strip()]
    if not sents:
        return ""
    # 主語を落とす:「〇〇は、日本の小説家。」「〇〇はアメリカの女優である。」→「日本の小説家。」「アメリカの女優。」
    first = sents[0]
    # 開き括弧が欠けて閉じ括弧だけ残ったとき（「…1855年11月26日）は、…」）は、そこまでを落とす
    if first.count("）") + first.count(")") > first.count("（") + first.count("("):
        first = re.sub(r"^.*?[）)]\s*(?:は、?)?", "", first, count=1)
    squashed = first.replace(" ", "")
    key = name.replace(" ", "")
    if key and squashed.startswith(key + "は"):
        first = re.sub(r"^は、?", "", squashed[len(key):])
    else:
        first = re.sub(r"^.{1,40}?は、", "", first, count=1)
    sents[0] = re.sub(r"である。$", "。", first)
    # 肩書きだけの短い1文目に、業績を述べた文を40字程度になるまで足す（最大4文目まで）
    out = ""
    for i, s in enumerate(sents[:4]):
        if i > 0 and JA_SKIP.search(s):
            continue
        if out and len(out) + len(s) > 120:
            break
        out += s
        if len(out) >= 40:
            break
    return out if len(out) <= 130 else out[:119] + "…"


def clean_en(text):
    text = strip_brackets(text.split("\n")[0])
    sents = re.split(r"(?<=[a-z0-9\)])\. (?=[A-Z])", text)
    if not sents:
        return ""
    first = re.sub(r"^.{1,80}? (?:was|is) (?:an? |the )?", "", sents[0], count=1)
    out = first[:1].upper() + first[1:]
    out = out.rstrip(".") + "."
    if len(sents) > 1 and len(out) < 90:
        nxt = sents[1].rstrip(".") + "."
        if len(out) + len(nxt) < 240:
            out += " " + nxt
    return out if len(out) <= 260 else out[:257] + "…"


def fetch_extracts(lang, titles):
    """{title: 冒頭の平文}。リダイレクト・表記ゆれは元の記事名に戻して返す"""
    while True:
        r = requests.get(f"https://{lang}.wikipedia.org/w/api.php", params={
            "action": "query", "prop": "extracts", "exintro": 1, "explaintext": 1,
            "exlimit": PER_REQUEST, "redirects": 1, "titles": "|".join(titles),
            "format": "json", "formatversion": 2}, headers=HEADERS, timeout=60)
        if r.status_code == 429:
            time.sleep(int(r.headers.get("Retry-After", 10)) + 1)
            continue
        r.raise_for_status()
        break
    q = r.json().get("query", {})
    back = {}
    for m in q.get("normalized", []) + q.get("redirects", []):
        back[m["to"]] = back.get(m["from"], m["from"])
    out = {}
    for p in q.get("pages", []):
        t = p.get("title")
        if t and p.get("extract"):
            out[back.get(t, t)] = p["extract"]
    return out


def main():
    stars = json.loads(STARS.read_text(encoding="utf-8"))
    cache = json.loads(CACHE.read_text(encoding="utf-8")) if CACHE.exists() else {"en": {}, "ja": {}}
    for lang, col in (("ja", "tja"), ("en", "ten")):
        todo = [s[col] for s in stars if s[col] and s[col] not in cache[lang]]
        print(f"{lang}: {len(todo)} articles to fetch")
        for i in range(0, len(todo), PER_REQUEST):
            batch = todo[i:i + PER_REQUEST]
            got = fetch_extracts(lang, batch)
            for t in batch:
                cache[lang][t] = got.get(t, "")
            CACHE.write_text(json.dumps(cache, ensure_ascii=False), encoding="utf-8")
            if (i // PER_REQUEST) % 20 == 0:
                print(f"  {lang} {i + len(batch)}/{len(todo)}")
            time.sleep(INTERVAL)

    # Wikidata の短い説明は、冒頭文が使えないときの予備として初回に控えておく
    # （stars.json の説明欄はこのスクリプトが上書きするので、2回目以降はここから戻す）
    wd = cache.setdefault("wikidata", {})
    for s in stars:
        wd.setdefault(s["q"], [s["den"], s["dja"]])
    CACHE.write_text(json.dumps(cache, ensure_ascii=False), encoding="utf-8")

    n = {"en": 0, "ja": 0}
    for s in stars:
        for lang, col, dcol, i in (("en", "ten", "den", 0), ("ja", "tja", "dja", 1)):
            text = cache[lang].get(s[col], "") if s[col] else ""
            d = (clean_en(text) if lang == "en" else clean_ja(text, s["ja"])) if text else ""
            if len(d) >= 10:
                s[dcol] = d
                n[lang] += 1
            else:
                s[dcol] = wd[s["q"]][i]
    STARS.write_text(json.dumps(stars, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"descriptions from Wikipedia: ja {n['ja']}, en {n['en']} / {len(stars)} stars")


if __name__ == "__main__":
    main()
