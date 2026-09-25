"""data/featured.json を検査する。

1. 生没年月日を Wikidata（英語版Wikipediaの記事経由）と照合
2. 転機の文中の「N歳」「at N」と、日付から計算した年齢が一致するか（日付が粗くて幅が出るものも NG）
3. 転機が没後になっていないか、説明文が欠けていないか

Wikidata 側の誤りを手で確かめた人は "verified" に根拠を書くと照合を飛ばす

    python scripts/check_featured.py
"""
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from fetch_wikidata import date, sparql  # noqa: E402

DATA = Path(__file__).resolve().parent.parent / "data" / "featured.json"


def ymd(s):
    m = re.match(r"^(-?\d+)(?:-(\d\d))?(?:-(\d\d))?$", s)
    return int(m.group(1)), int(m.group(2) or 0), int(m.group(3) or 0)


def age_range(born, when):
    """誕生日と（精度の粗いこともある）日付から、ありうる満年齢の範囲"""
    by, bm, bd = ymd(born)
    y, m, d = ymd(when)
    lo_m, hi_m = (m, m) if m else (1, 12)
    lo_d, hi_d = (d, d) if d else (1, 31)

    def age(mm, dd):
        return y - by - (1 if (mm, dd) < (bm, bd) else 0)
    return age(lo_m, lo_d), age(hi_m, hi_d)


def check_texts(p):
    bad = 0
    for k in ("desc_ja", "desc_en"):
        if not p.get(k):
            print(f"NG {p['id']}: {k} がない")
            bad += 1
    for m in p["milestones"]:
        lo, hi = (m["age"], m["age"]) if "age" in m else age_range(p["born"], m["date"])
        if p["died"] and m["date"] > p["died"] and not p["born"].startswith("-"):
            print(f"NG {p['id']} {m['date']}: 没後の転機")
            bad += 1
        stated = [int(x) for x in re.findall(r"(\d+)歳", m["ja"])]
        stated += [int(x) for x in re.findall(r"\bat (\d+)\b", m["en"])]
        stated += [int(x) for x in re.findall(r"\bAt (\d+)\b", m["en"])]
        for n in stated:
            # 「70歳を過ぎて」「50代」などの幅を持つ表現は除外して、明示の年齢だけを見る
            if not (lo <= n <= hi) and not p.get("approx"):
                print(f"NG {p['id']} {m['date']}: 文中 {n}歳 / 計算 {lo}〜{hi}歳  「{m['ja']}」")
                bad += 1
            elif lo != hi and "頃" not in m["ja"] and not p.get("approx"):
                # 画面に「23〜24歳頃」と出て、文の「24歳で」と食い違って見える。日付を月・日まで書くか "age" で固定する
                print(f"NG {p['id']} {m['date']}: 文中 {n}歳 だが日付が粗く {lo}〜{hi}歳 と表示される  「{m['ja']}」")
                bad += 1
    return bad


def main():
    people = json.loads(DATA.read_text(encoding="utf-8"))
    bad = sum(check_texts(p) for p in people)

    titles = " ".join('"%s"@en' % p["wiki"].replace('"', '\\"') for p in people)
    rows = sparql(f"""
SELECT ?title ?p ?b ?d WHERE {{
  VALUES ?title {{ {titles} }}
  ?a schema:name ?title ; schema:isPartOf <https://en.wikipedia.org/> ; schema:about ?p .
  OPTIONAL {{ ?p wdt:P569 ?b }}
  OPTIONAL {{ ?p wdt:P570 ?d }}
}}""")
    wd = {}
    for r in rows:
        e = wd.setdefault(r["title"]["value"], {"b": set(), "d": set()})
        if "b" in r:
            e["b"].add(date(r["b"]["value"]))
        if "d" in r:
            e["d"].add(date(r["d"]["value"]))

    for p in people:
        if p.get("verified"):
            print(f"OK {p['id']}: 手で確認済み — {p['verified']}")
            continue
        e = wd.get(p["wiki"])
        if not e:
            print(f"?? {p['id']}: 英語版Wikipedia '{p['wiki']}' が Wikidata で引けない（手で確認）")
            continue
        for key, mine in (("b", p["born"]), ("d", p["died"])):
            theirs = e[key]
            if mine is None and not theirs:
                continue
            if mine not in theirs:
                # 1582年以前はユリウス暦の慣用日付と Wikidata のグレゴリオ換算がずれるので参考扱い
                lenient = p.get("approx") or ymd(p["born"])[0] < 1582
                print(f"{'~ ' if lenient else 'NG'} {p['id']} {key}: mine={mine} wikidata={sorted(x for x in theirs if x)}")
                bad += 0 if lenient else 1
    print(f"{len(people)} people, {bad} problems")


if __name__ == "__main__":
    main()
