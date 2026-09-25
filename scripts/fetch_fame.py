"""知名度（Wikipedia の閲覧数）と、主役の写真・日本語版記事名を集めて data/fame.json に書く。

    python scripts/fetch_fame.py       # 約10分

- 知名度は日本語版・英語版それぞれの直近30日の閲覧数（action API の prop=pageviews、1回50記事）。
  画面の言語に合わせて使い分ける（日本語版で夏目漱石 8万、アインシュタイン 5.5万、ペトロヴィッチ 508）
- 主役（featured.json）は英語版の記事名から Wikidata を引き、QID・日本語版の記事名・写真を得る
- 回数制限: action API は未ログインで約10回/25秒。Wikimedia REST API（1回1記事）は
  約50回で 429 になり1万記事に3時間かかるので使わない

出力:
    {"pv": {"ja": {記事名: 閲覧数}, "en": {...}},
     "featured": {id: {"q": QID, "tja": 日本語版の記事名, "img": Commons のファイル名}}}
"""
import json
import sys
import time
from pathlib import Path

import requests

sys.path.insert(0, str(Path(__file__).resolve().parent))
from fetch_wikidata import qid, sparql, val  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "data" / "fame.json"
HEADERS = {"User-Agent": "great-ages/0.1 (personal non-commercial research script)"}
PER_REQUEST = 50
INTERVAL = 2.6  # 未ログインの action API は約10回/25秒
DAYS = 30  # 60日にすると応答が分割され（continue）、回数が数倍になる


def featured_meta(featured):
    titles = " ".join('"%s"@en' % p["wiki"].replace('"', '\\"') for p in featured)
    by_title = {}
    for r in sparql(f"""
SELECT ?title ?p ?tja ?img WHERE {{
  VALUES ?title {{ {titles} }}
  ?a schema:name ?title ; schema:isPartOf <https://en.wikipedia.org/> ; schema:about ?p .
  OPTIONAL {{ ?aja schema:about ?p ; schema:isPartOf <https://ja.wikipedia.org/> ; schema:name ?tja }}
  OPTIONAL {{ ?p wdt:P18 ?img }}
}}"""):
        m = by_title.setdefault(val(r, "title"), {"q": qid(val(r, "p")), "tja": "", "img": ""})
        m["tja"] = m["tja"] or val(r, "tja") or ""
        if val(r, "img") and not m["img"]:
            m["img"] = requests.utils.unquote(val(r, "img").rsplit("/", 1)[-1])
    return {p["id"]: by_title[p["wiki"]] for p in featured if p["wiki"] in by_title}


def pageviews(lang, titles):
    """{記事名: 直近30日の閲覧数}。1回で50記事ずつ。
    記事名は Wikidata のサイトリンク（正規の記事名）なのでリダイレクトは辿らない"""
    titles = sorted(set(t for t in titles if t))
    out = {}
    for i in range(0, len(titles), PER_REQUEST):
        batch = titles[i:i + PER_REQUEST]
        cont = {}
        while True:  # 念のため "continue" が返れば続きを取る
            r = requests.get(f"https://{lang}.wikipedia.org/w/api.php", params={
                "action": "query", "prop": "pageviews", "pvipdays": DAYS, "titles": "|".join(batch),
                "format": "json", "formatversion": 2, **cont}, headers=HEADERS, timeout=60)
            if r.status_code == 429:
                time.sleep(int(r.headers.get("Retry-After", 10)) + 1)
                continue
            r.raise_for_status()
            data = r.json()
            for p in data.get("query", {}).get("pages", []):
                if "pageviews" in p:
                    out[p["title"]] = sum(v or 0 for v in p["pageviews"].values())
            time.sleep(INTERVAL)
            if "continue" not in data:
                break
            cont = data["continue"]
        if (i // PER_REQUEST) % 20 == 0:
            print(f"  {lang} {i + len(batch)}/{len(titles)}")
    missing = [t for t in titles if t not in out]
    if missing:
        print(f"  {lang}: {len(missing)} titles without data (例: {missing[:3]})")
    return {t: out.get(t, 0) for t in titles}


def main():
    featured = json.loads((ROOT / "data" / "featured.json").read_text(encoding="utf-8"))
    stars = json.loads((ROOT / "data" / "stars.json").read_text(encoding="utf-8"))
    meta = featured_meta(featured)
    print(f"featured: {len(meta)}/{len(featured)} resolved on Wikidata")
    ja = [s["tja"] for s in stars] + [m["tja"] for m in meta.values()]
    en = [s["ten"] for s in stars] + [p["wiki"] for p in featured]
    out = {"pv": {"ja": pageviews("ja", ja), "en": pageviews("en", en)}, "featured": meta}
    OUT.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"wrote {OUT} ({OUT.stat().st_size // 1024} KB)")


if __name__ == "__main__":
    main()
