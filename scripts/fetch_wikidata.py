"""Wikidata から「背景の星」を取得して data/stars.json を作る。

    python scripts/fetch_wikidata.py            # 既定: sitelinks >= 60（約15〜25分）
    python scripts/fetch_wikidata.py --min 80
    python scripts/fetch_wikidata.py --refilter # exclude.txt / exclude_events.txt を直したあと（1〜3分）

正確さのための方針:
- 生没年は「年」以上の精度で確定しているものを採る。年・月までの人は画面で年齢を幅で出す（「51〜52歳で没」）
  捨てるもの: 世紀・年代まで／「頃」「推定」「異説あり」の注記(P1480)つき／値が食い違って満年齢が変わるもの
  （没日が4日か5日か、のように満年齢が変わらない食い違いは採る）。西暦1000年より前の生まれは伝承の日付が多いので外す
- 取得対象: 知名度（sitelinks）60以上の人物 ＋ 各分野の代表的人物（data/seed_vital.txt、英語版 Wikipedia の
  Vital articles レベル4）＋ 20歳以下で主要な賞を受けた人（知名度15以上）
- 出来事は2種類だけ
  - 開花(bloom): 主要な賞（ノーベル賞・五輪金メダルなど）
  - 転機(turning): よく知られた企業の創業。誤りが多いので条件を絞る
    （企業の知名度 sitelinks >= 40、教育・研究機関は除く、設立日が1つに定まる、
      本人が15歳以上で存命中）。後の社名があれば「（のちの〇〇）」を添える
  代表作(P800)は日付の意味（初演・出版・完成）が揺れるので使わない
- 分野は Wikidata の短い説明文から決める（scripts/fields.py）
- 存命の政治家・宗教指導者、テロ・犯罪で知られる人物、殺人・性犯罪・戦争犯罪などで有罪の人物、
  ナチ党員、15歳未満で没した人、data/exclude.txt の人物は除外

出力: 1人1オブジェクト
    {"q", "en", "ja", "b": 生年月日, "d": 没年月日|null, "f": 分野, "sl": sitelinks,
     "ev": [{"date", "p": 精度(9=年 10=月 11=日), "type", "kind": "bloom"|"turning", "en", "ja"}],
     "den", "dja": 説明, "ten", "tja": Wikipedia 記事名, "img": Commons のファイル名}
説明文は scripts/fetch_descriptions.py、知名度は scripts/fetch_fame.py で後から足す。
"""
import argparse
import json
import re
import sys
import time
from pathlib import Path

import requests

sys.path.insert(0, str(Path(__file__).resolve().parent))
from fields import classify  # noqa: E402

ENDPOINT = "https://query.wikidata.org/sparql"
HEADERS = {"User-Agent": "great-ages/0.1 (personal non-commercial project)"}
ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "data" / "stars.json"
RAW = ROOT / "data" / "_fetch_raw.json"  # 取得した生データ（後処理だけやり直すため）
EXCLUDE = ROOT / "data" / "exclude.txt"
EXCLUDE_EVENTS = ROOT / "data" / "exclude_events.txt"
BATCH = 300
DAY = 11  # wikibase:timePrecision の「日」
YEAR = 9
ORG_MIN_SITELINKS = 40
FOUNDINGS_PER_PERSON = 2

AWARDS = [
    "Q38104",   # ノーベル物理学賞
    "Q44585",   # ノーベル化学賞
    "Q80061",   # ノーベル生理学・医学賞
    "Q37922",   # ノーベル文学賞
    "Q35637",   # ノーベル平和賞
    "Q47170",   # ノーベル経済学賞
    "Q28835",   # フィールズ賞
    "Q185667",  # チューリング賞
    "Q208167",  # アーベル賞
    "Q103916",  # アカデミー主演男優賞
    "Q103618",  # アカデミー主演女優賞
    "Q103360",  # アカデミー監督賞
    "Q15243387",  # オリンピック金メダル
    "Q166177",  # バロンドール
    "Q106291",  # アカデミー助演男優賞
    "Q106301",  # アカデミー助演女優賞
    "Q489705",  # アカデミー子役賞
    "Q833633",  # ピュリッツァー賞 フィクション部門
    "Q1453643",  # グラミー賞最優秀新人賞
    "Q424160",  # 芥川賞
    "Q224573",  # 直木賞
    "Q915604",  # ウルフ賞数学部門
    "Q133160",  # プリツカー賞
]
SEED_VITAL = ROOT / "data" / "seed_vital.txt"
YOUNG_AWARD_AGE = 20       # この年齢以下で主要な賞を受けた人は、知名度が低くても入れる
YOUNG_AWARD_MIN_SITELINKS = 15
# 生没年の注記(P1480)のうち、値が不確かなことを表すもの（「暦が不明」などは不確かではない）
UNCERTAIN = re.compile(r"circa|presum|probab|possib|disput|uncertain|approximat|alleg|estimat|legend|"
                       r"misattribut|hypothe|doubt|conject|questionable|unconfirmed", re.I)

# 職業にこれが含まれる人物は載せない
# 語の途中では当てない（"psychotherapist" に "rapist" が当たってユングを外していた）
BAD_OCCUPATION = re.compile(
    r"(?<![a-z])(?:terrorist|serial killer|murderer|criminal|gangster|mobster|drug lord|drug trafficker|"
    r"war criminal|assassin|mass murderer|rapist|pirate|hitman|fraudster)(?![a-z])", re.I)
# 存命でこの職業を持つ人は、主な分野が政治でなくても載せない（国家元首・宗教指導者など）。
# 「政治家」の肩書きを副業で持つ俳優・選手などまで外さないよう、強い肩書きだけにする
LIVING_POLITICAL = re.compile(r"head of state|head of government|dictator|monarch|cleric|ayatollah", re.I)
# 主な分野が政治・社会の存命者のうち、これを職業に持つ人を外す（活動家だけの人＝マララ等は残す）
POLITICIAN = re.compile(r"politician|statesperson|diplomat|military officer|military leader|monarch", re.I)
# 有罪判決(P1399)のうち、これに当たる罪で有罪になった人は載せない。
# 反逆罪・異端・同性愛（チューリング、ガリレオ、ワイルド、ショル等）や脱税・交通違反は対象にしない
GRAVE_CONVICTION = re.compile(
    r"murder|homicide|killing|manslaughter|genocide|war crime|crime against humanity|"
    r"crime against peace|terror|bomb|rape|sexual|sex trafficking|indecent assault|child", re.I)
# 賞の記述に付く「重要な出来事」(P793) がこれなら、受賞していない（辞退・取り消し）
DECLINED = re.compile(r"declin|refus|reject|revok|rescind|withdr|stripped|forfeit", re.I)
MIN_DEATH_AGE = 15  # これより若く亡くなった人（幼い君主など）は業績で知られるわけではないので外す
MIN_FOUNDING_AGE = 15
# これより前に生まれた人は、日まで書かれていても伝承による日付が多い（ムハンマド、李白など）ので外す
MIN_BIRTH_YEAR = 1000


def sparql(query, retries=5, max_throttled=30):
    """回数制限（429）は Retry-After だけ待って失敗に数えない（連続で問い合わせると起きる）。
    それ以外の失敗は retries 回まで間隔を広げてやり直す"""
    failures = throttled = 0
    while True:
        try:
            r = requests.post(ENDPOINT, data={"query": query, "format": "json"},
                              headers=HEADERS, timeout=90)
            if r.status_code == 429 and throttled < max_throttled:
                throttled += 1
                time.sleep(int(r.headers.get("Retry-After", 10)) + 1)
                continue
            r.raise_for_status()
            return r.json()["results"]["bindings"]
        except (requests.RequestException, ValueError) as e:
            failures += 1
            print(f"  retry {failures}: {str(e)[:200]}", file=sys.stderr)
            if failures >= retries:
                raise RuntimeError("SPARQL failed") from e
            time.sleep(5 * failures)


def qid(uri):
    return uri.rsplit("/", 1)[-1]


def date(v):
    """'1811-10-25T00:00:00Z' / '-0355-07-20T00:00:00Z' -> '1811-10-25' / '-0355-07-20'"""
    m = re.match(r"^(-?\d+)-(\d\d)-(\d\d)", v)
    if not m:
        return None
    y = int(m.group(1))
    return f"{y:05d}-{m.group(2)}-{m.group(3)}" if y < 0 else f"{y:04d}-{m.group(2)}-{m.group(3)}"


def val(r, k):
    return (r.get(k) or {}).get("value")


def chunks(xs, n):
    for i in range(0, len(xs), n):
        yield xs[i:i + n]


def ymd(d):
    neg = d.startswith("-")
    y, m, dd = (int(x) for x in d.lstrip("-").split("-"))
    return (-y if neg else y), m, dd


def age_at(born, when):
    by, bm, bd = ymd(born)
    y, m, d = ymd(when)
    return y - by - (1 if (m, d) < (bm, bd) else 0)


def load_exclude():
    """exclude.txt: 1行に QID か英語名。# 以降はコメント"""
    ids, names = set(), set()
    if EXCLUDE.exists():
        for line in EXCLUDE.read_text(encoding="utf-8").splitlines():
            s = line.split("#", 1)[0].strip()
            if re.fullmatch(r"Q\d+", s):
                ids.add(s)
            elif s:
                names.add(s.lower())
    return ids, names


def load_exclude_events():
    """exclude_events.txt: 「人物の英語名 | 出来事の英語表記の先頭」"""
    out = []
    if EXCLUDE_EVENTS.exists():
        for line in EXCLUDE_EVENTS.read_text(encoding="utf-8").splitlines():
            s = line.split("#", 1)[0].strip()
            if "|" in s:
                who, what = (x.strip().lower() for x in s.split("|", 1))
                out.append((who, what))
    return out


def clean_events(name_en, field, events, ex_events):
    """国の機関・劇場などを君主や政治家が「創業」したことになっているものは起業の逸話ではないので外す。
    exclude_events.txt に書いた誤り・重複も外す"""
    out = []
    for e in events:
        if e["type"] == "founding" and field == "politics":
            continue
        if any(name_en.lower() == who and e["en"].lower().startswith(what) for who, what in ex_events):
            continue
        out.append(e)
    return out


def fetch_occupations(values):
    occ = {}
    for r in sparql(f"""
SELECT ?p ?occL WHERE {{
  VALUES ?p {{ {values} }}
  ?p wdt:P106 ?occ . ?occ rdfs:label ?occL FILTER(LANG(?occL) = "en")
}}"""):
        occ.setdefault(qid(val(r, "p")), set()).add(val(r, "occL"))
    return occ


def fetch_flags(values):
    """{qid: {"nazi", "convicted"}}"""
    flags = {}
    for r in sparql(f"""
SELECT ?p WHERE {{ VALUES ?p {{ {values} }} ?p wdt:P102 wd:Q7320 }}"""):
        flags.setdefault(qid(val(r, "p")), set()).add("nazi")
    for r in sparql(f"""
SELECT ?p ?cL WHERE {{
  VALUES ?p {{ {values} }}
  ?p wdt:P1399 ?c . ?c rdfs:label ?cL FILTER(LANG(?cL) = "en")
}}"""):
        if GRAVE_CONVICTION.search(val(r, "cL")):
            flags.setdefault(qid(val(r, "p")), set()).add("convicted")
    return flags


def fetch_foundings(values):
    """{qid: [(org_sitelinks, event)]}。設立日が食い違う・年を跨いで揺れるものは捨てる"""
    orgs = {}
    for r in sparql(f"""
SELECT ?p ?org ?t ?tp ?osl ?en ?ja ?repEn ?repJa WHERE {{
  VALUES ?p {{ {values} }}
  ?org wdt:P112 ?p ; wikibase:sitelinks ?osl .
  FILTER(?osl >= {ORG_MIN_SITELINKS})
  ?org p:P571 ?is . ?is a wikibase:BestRank ; psv:P571 ?iv .
  ?iv wikibase:timeValue ?t ; wikibase:timePrecision ?tp .
  ?org wdt:P31/wdt:P279* wd:Q4830453 .
  FILTER NOT EXISTS {{ ?org wdt:P31/wdt:P279* wd:Q2385804 }}
  OPTIONAL {{ ?org rdfs:label ?en FILTER(LANG(?en) = "en") }}
  OPTIONAL {{ ?org rdfs:label ?ja FILTER(LANG(?ja) = "ja") }}
  OPTIONAL {{
    ?org wdt:P1366 ?rep .
    OPTIONAL {{ ?rep rdfs:label ?repEn FILTER(LANG(?repEn) = "en") }}
    OPTIONAL {{ ?rep rdfs:label ?repJa FILTER(LANG(?repJa) = "ja") }}
  }}
}}"""):
        key = (qid(val(r, "p")), qid(val(r, "org")))
        o = orgs.setdefault(key, {"dates": set(), "sl": int(val(r, "osl")), "en": val(r, "en"),
                                  "ja": val(r, "ja"), "repEn": val(r, "repEn"), "repJa": val(r, "repJa")})
        o["dates"].add((date(val(r, "t")), int(val(r, "tp"))))
    out = {}
    for (p, _), o in orgs.items():
        if not o["en"] or not o["dates"]:
            continue
        years = {ymd(d)[0] for d, _ in o["dates"]}
        if len(years) != 1:
            continue  # 設立年が食い違う（Chanel: 1900/1909/2010 など）
        if len(o["dates"]) == 1:
            d, prec = next(iter(o["dates"]))
        else:
            d, prec = min(o["dates"])[0], YEAR  # 同じ年の中で日付が揺れるなら年までとする
        if prec < YEAR:
            continue
        en, ja = o["en"], o["ja"] or o["en"]
        if o["repEn"]:  # 社名が変わった・後継がある（X.com → PayPal など）
            en += f" (later {o['repEn']})"
            ja += f"（のちの{o['repJa'] or o['repEn']}）"
        out.setdefault(p, []).append((o["sl"], {"date": d, "p": prec, "type": "founding",
                                                "kind": "turning", "en": en, "ja": ja}))
    return out


def fetch_batch(batch, people):
    values = " ".join(f"wd:{i}" for i in batch)

    # 生没年月日（最良ランクの値・精度・「頃」）
    for r in sparql(f"""
SELECT ?p ?b ?bp ?bc ?d ?dp ?dc ?hasd WHERE {{
  VALUES ?p {{ {values} }}
  ?p p:P569 ?bs . ?bs a wikibase:BestRank ; psv:P569 ?bv .
  ?bv wikibase:timeValue ?b ; wikibase:timePrecision ?bp .
  OPTIONAL {{ ?bs pq:P1480 ?bcq . ?bcq rdfs:label ?bc FILTER(LANG(?bc) = "en") }}
  OPTIONAL {{
    ?p p:P570 ?ds . ?ds a wikibase:BestRank ; psv:P570 ?dv .
    ?dv wikibase:timeValue ?d ; wikibase:timePrecision ?dp .
    OPTIONAL {{ ?ds pq:P1480 ?dcq . ?dcq rdfs:label ?dc FILTER(LANG(?dc) = "en") }}
  }}
  BIND(EXISTS {{ ?p p:P570 [] }} AS ?hasd)
}}"""):
        p = people.setdefault(qid(val(r, "p")), {"births": set(), "deaths": set(), "hasd": False,
                                                 "occ": set(), "ev": {}, "found": [], "flags": set(),
                                                 "awards": set()})
        # 形の崩れた日付（date() が None）は候補に入れない
        if date(val(r, "b")):
            p["births"].add((date(val(r, "b")), int(val(r, "bp")), bool(UNCERTAIN.search(val(r, "bc") or ""))))
        if "d" in r and date(val(r, "d")):
            p["deaths"].add((date(val(r, "d")), int(val(r, "dp")), bool(UNCERTAIN.search(val(r, "dc") or ""))))
        p["hasd"] = p["hasd"] or val(r, "hasd") == "true"

    # 名前・Wikidata の短い説明・Wikipedia の記事名・写真
    for r in sparql(f"""
SELECT ?p ?en ?mul ?ja ?den ?dja ?ten ?tja ?img WHERE {{
  VALUES ?p {{ {values} }}
  OPTIONAL {{ ?p rdfs:label ?en FILTER(LANG(?en) = "en") }}
  OPTIONAL {{ ?p rdfs:label ?mul FILTER(LANG(?mul) = "mul") }}
  OPTIONAL {{ ?p rdfs:label ?ja FILTER(LANG(?ja) = "ja") }}
  OPTIONAL {{ ?p schema:description ?den FILTER(LANG(?den) = "en") }}
  OPTIONAL {{ ?p schema:description ?dja FILTER(LANG(?dja) = "ja") }}
  OPTIONAL {{ ?aen schema:about ?p ; schema:isPartOf <https://en.wikipedia.org/> ; schema:name ?ten }}
  OPTIONAL {{ ?aja schema:about ?p ; schema:isPartOf <https://ja.wikipedia.org/> ; schema:name ?tja }}
  OPTIONAL {{ ?p wdt:P18 ?img }}
}}"""):
        p = people.get(qid(val(r, "p")))
        if p is None:
            continue
        # 共通の名前は "mul"（多言語）ラベルに移されていて "en" が無いことがある
        for k, v in (("en", val(r, "en") or val(r, "mul")), ("ja", val(r, "ja")), ("den", val(r, "den")),
                     ("dja", val(r, "dja")), ("ten", val(r, "ten")), ("tja", val(r, "tja"))):
            p[k] = p.get(k) or v
        if val(r, "img") and not p.get("img"):
            # http://commons.wikimedia.org/wiki/Special:FilePath/Albert%20Einstein%20Head.jpg → ファイル名
            p["img"] = requests.utils.unquote(val(r, "img").rsplit("/", 1)[-1])

    for k, occ in fetch_occupations(values).items():
        if k in people:
            people[k]["occ"] |= occ
    for k, flag in fetch_flags(values).items():
        if k in people:
            people[k]["flags"] |= flag
    for k, fs in fetch_foundings(values).items():
        if k in people:
            people[k]["found"] += fs

    # 主要な賞（授与の時点と、その精度）
    award_values = " ".join(f"wd:{a}" for a in AWARDS)
    for r in sparql(f"""
SELECT ?p ?aw ?t ?tp ?en ?ja WHERE {{
  VALUES ?p {{ {values} }}
  VALUES ?aw {{ {award_values} }}
  ?p p:P166 ?st . ?st ps:P166 ?aw ; pqv:P585 ?tv .
  ?tv wikibase:timeValue ?t ; wikibase:timePrecision ?tp .
  FILTER NOT EXISTS {{
    ?st pq:P793 ?ev . ?ev rdfs:label ?evL FILTER(LANG(?evL) = "en")
    FILTER(REGEX(?evL, "{DECLINED.pattern}", "i"))
  }}
  OPTIONAL {{ ?aw rdfs:label ?en FILTER(LANG(?en) = "en") }}
  OPTIONAL {{ ?aw rdfs:label ?ja FILTER(LANG(?ja) = "ja") }}
}}"""):
        p = people.get(qid(val(r, "p")))
        t, tp = date(val(r, "t")), int(val(r, "tp"))
        if p is None or not t or tp < YEAR:
            continue
        aw = qid(val(r, "aw"))
        p["awards"].add(aw)
        en = val(r, "en") or aw
        cur = p["ev"].get(aw)
        if cur is None or t < cur["date"]:  # 同じ賞を何度も受けていれば最初の1回
            p["ev"][aw] = {"date": t, "p": tp, "type": "award", "kind": "bloom",
                           "en": en, "ja": val(r, "ja") or en}


def candidates(values):
    """最良ランクの値から、(候補の日付の一覧, 精度) か、採れない理由を返す。
    精度の粗い値（同じ日付を年だけで書いたもの等）は、細かい値と同じ年なら無視する"""
    if any(unc for _, _, unc in values):
        return "生没年が「頃」「推定」など不確か"
    prec = max(p for _, p, _ in values)
    if prec < YEAR:
        return "生没が世紀・年代まで"
    top = sorted({d for d, p, _ in values if p == prec})
    years = {ymd(d)[0] for d in top}
    if len(years) != 1 or any(ymd(d)[0] not in years for d, _, _ in values):
        return "生没年の値が食い違う"
    return top, prec


def resolve_dates(p):
    """(生年月日, 精度, 没年月日|None, 精度|None) か、採れない理由"""
    b = candidates(p["births"])
    if isinstance(b, str):
        return b
    d = candidates(p["deaths"]) if p["deaths"] else None
    if isinstance(d, str):
        return d
    if p["hasd"] and d is None:
        return "没年が不明（記録はあるが値がない）"
    (bs, bp), (ds, dp) = b, (d or ([None], None))
    if len(bs) > 1 or len(ds) > 1:
        # 日付の候補が複数あっても、満年齢が変わらなければ採る（モンローの没日が4日か5日か、など）
        if dp is None or bp < DAY or dp < DAY or len({age_at(x, y) for x in bs for y in ds}) != 1:
            return "生没年の値が食い違う"
    return bs[0], bp, ds[0], dp


def exclusion(k, name_en, occ, flags, field, died, ex_ids, ex_names):
    """載せない理由（載せてよければ None）"""
    if k in ex_ids or name_en.lower() in ex_names:
        return "除外リスト"
    if "nazi" in flags:
        return "ナチ党員"
    if "convicted" in flags:
        return "殺人・性犯罪・戦争犯罪などで有罪"
    if any(BAD_OCCUPATION.search(o) for o in occ):
        return "犯罪・テロで知られる"
    if not died and (any(LIVING_POLITICAL.search(o) for o in occ)
                     or (field == "politics" and any(POLITICIAN.search(o) for o in occ))):
        return "存命の政治家・宗教指導者"
    return None


def fetch_declined(values):
    """{(qid, 賞の英語名)}: 辞退・取り消しの注記がある受賞の記述"""
    out = set()
    award_values = " ".join(f"wd:{a}" for a in AWARDS)
    for r in sparql(f"""
SELECT ?p ?awL ?evL WHERE {{
  VALUES ?p {{ {values} }}
  VALUES ?aw {{ {award_values} }}
  ?p p:P166 ?st . ?st ps:P166 ?aw ; pq:P793 ?ev .
  ?ev rdfs:label ?evL FILTER(LANG(?evL) = "en")
  ?aw rdfs:label ?awL FILTER(LANG(?awL) = "en")
}}"""):
        if DECLINED.search(val(r, "evL")):
            out.add((qid(val(r, "p")), val(r, "awL")))
    return out


def refilter():
    """既存の stars.json に除外ルールを当て直す（職業などだけ取り直すので速い）。
    exclude.txt を編集したあとはこれで足りる。消すだけなので、ルールを緩めたときは全取得し直す"""
    ex_ids, ex_names = load_exclude()
    stars = json.loads(OUT.read_text(encoding="utf-8"))
    occ, flags, declined = {}, {}, set()
    for batch in chunks([s["q"] for s in stars], BATCH):
        values = " ".join(f"wd:{i}" for i in batch)
        occ.update(fetch_occupations(values))
        for small in chunks(batch, 100):  # 賞×人の組み合わせが重く、300人だとタイムアウトする
            declined |= fetch_declined(" ".join(f"wd:{i}" for i in small))
        for k, f in fetch_flags(values).items():
            flags.setdefault(k, set()).update(f)
    ex_events = load_exclude_events()
    kept, dropped, n_ev = [], {}, 0
    for s in stars:
        before = len(s["ev"])
        s["ev"] = [e for e in clean_events(s["en"], s["f"], s["ev"], ex_events)
                   if not (e["type"] == "award" and (s["q"], e["en"]) in declined)]
        n_ev += before - len(s["ev"])
        reason = exclusion(s["q"], s["en"], occ.get(s["q"], set()), flags.get(s["q"], set()), s["f"],
                           s["d"], ex_ids, ex_names)
        if not reason and s["d"] and age_at(s["b"], s["d"]) < MIN_DEATH_AGE:
            reason = f"{MIN_DEATH_AGE}歳未満で没"
        if not reason and ymd(s["b"])[0] < MIN_BIRTH_YEAR:
            reason = f"{MIN_BIRTH_YEAR}年より前の生まれ（日付が伝承）"
        if reason:
            dropped.setdefault(reason, []).append(s["en"])
        else:
            kept.append(s)
    OUT.write_text(json.dumps(kept, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    for reason, names in dropped.items():
        print(f"  除外 {len(names):4d}  {reason}: {', '.join(names[:12])}{' …' if len(names) > 12 else ''}")
    print(f"  外した出来事 {n_ev} 件")
    print(f"kept {len(kept)} stars")


def seed_people():
    """知名度の足切りで漏れる人を足す: 各分野の代表的人物と、若くして主要な賞を受けた人。{qid: sitelinks}"""
    out = {}
    if SEED_VITAL.exists():
        titles = [t.strip() for t in SEED_VITAL.read_text(encoding="utf-8").splitlines()
                  if t.strip() and not t.startswith("#")]
        for batch in chunks(titles, 150):
            v = " ".join('"%s"@en' % t.replace('"', '\\"') for t in batch)
            for r in sparql(f"""
SELECT ?p ?sl WHERE {{
  VALUES ?t {{ {v} }}
  ?a schema:name ?t ; schema:isPartOf <https://en.wikipedia.org/> ; schema:about ?p .
  ?p wdt:P31 wd:Q5 ; wikibase:sitelinks ?sl .
}}"""):
                out[qid(val(r, "p"))] = int(val(r, "sl"))
        print(f"  代表的人物（seed_vital.txt）: {len(out)}")
    award_values = " ".join(f"wd:{a}" for a in AWARDS)
    n = len(out)
    for r in sparql(f"""
SELECT DISTINCT ?p ?sl WHERE {{
  VALUES ?aw {{ {award_values} }}
  ?p p:P166 ?st . ?st ps:P166 ?aw ; pq:P585 ?t .
  ?p wdt:P569 ?b ; wikibase:sitelinks ?sl .
  FILTER(?sl >= {YOUNG_AWARD_MIN_SITELINKS})
  FILTER(YEAR(?t) - YEAR(?b) <= {YOUNG_AWARD_AGE})
}}"""):
        out.setdefault(qid(val(r, "p")), int(val(r, "sl")))
    print(f"  {YOUNG_AWARD_AGE}歳以下で主要な賞: +{len(out) - n}")
    return out


def fetch_all(min_sitelinks):
    print(f"people with sitelinks >= {min_sitelinks} ...")
    rows = sparql(f"""
SELECT ?p ?sl WHERE {{
  ?p wikibase:sitelinks ?sl . hint:Prior hint:rangeSafe true .
  FILTER(?sl >= {min_sitelinks})
  ?p wdt:P31 wd:Q5 .
}}""")
    sitelinks = {qid(r["p"]["value"]): int(r["sl"]["value"]) for r in rows}
    print(f"  {len(sitelinks)} people")
    for k, sl in seed_people().items():
        sitelinks.setdefault(k, sl)
    ids = list(sitelinks)
    print(f"  + seeds → {len(ids)} people")

    people = {}
    n_batches = (len(ids) + BATCH - 1) // BATCH
    for n, batch in enumerate(chunks(ids, BATCH)):
        print(f"batch {n + 1}/{n_batches}")
        fetch_batch(batch, people)
        time.sleep(1)
    RAW.write_text(json.dumps({"sitelinks": sitelinks, "people": people},
                              default=lambda o: sorted(o, key=str) if isinstance(o, set) else str(o),
                              ensure_ascii=False), encoding="utf-8")
    return sitelinks, people


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--min", type=int, default=60, help="sitelinks の下限（知名度の足切り）")
    ap.add_argument("--resume", action="store_true",
                    help="取得し直さず、前回の生データ（data/_fetch_raw.json）から後処理だけやり直す")
    ap.add_argument("--refilter", action="store_true",
                    help="取り直さずに、既存の stars.json へ除外ルールと exclude.txt を当て直す")
    args = ap.parse_args()
    if args.refilter:
        return refilter()
    ex_ids, ex_names = load_exclude()
    ex_events = load_exclude_events()

    if args.resume:
        raw = json.loads(RAW.read_text(encoding="utf-8"))
        sitelinks, people = raw["sitelinks"], raw["people"]
        for p in people.values():
            for k in ("births", "deaths", "occ", "flags", "awards"):
                p[k] = set(tuple(x) if isinstance(x, list) else x for x in p[k])
            p["found"] = [tuple(x) for x in p["found"]]
        print(f"resume: {len(people)} people")
    else:
        sitelinks, people = fetch_all(args.min)

    this_year = time.localtime().tm_year
    out, dropped, matched_names = [], {}, set()

    def drop(reason):
        dropped[reason] = dropped.get(reason, 0) + 1

    for k, p in people.items():
        if not p["births"]:
            drop("生年がない")
            continue
        r = resolve_dates(p)
        if isinstance(r, str):
            drop(r)
            continue
        born, bp, died, dp = r
        if not died and this_year - ymd(born)[0] > 110:
            drop("没年の記録漏れと思われる")
            continue
        if died and ymd(died) <= ymd(born):  # 文字列で比べると紀元前（"-0100" など）の順序を誤る
            drop("生没の前後が逆")
            continue
        name_en = p.get("en")
        if not name_en:
            drop("名前がない")
            continue
        if died and age_at(born, died) + 1 < MIN_DEATH_AGE:
            drop(f"{MIN_DEATH_AGE}歳未満で没")
            continue
        if ymd(born)[0] < MIN_BIRTH_YEAR:
            drop(f"{MIN_BIRTH_YEAR}年より前の生まれ（日付が伝承）")
            continue
        field = classify(p.get("den"), p["occ"], p["awards"])
        reason = exclusion(k, name_en, p["occ"], p["flags"], field, died, ex_ids, ex_names)
        if reason:
            if reason == "除外リスト":
                matched_names.add(name_en.lower())
            drop(reason)
            continue

        def alive_at(e):
            # 年までしか分からない日付は、その年の終わりでも生まれていて、年の初めでも存命だったもの
            y = ymd(e["date"])[0]
            if e["p"] >= DAY:
                return e["date"] > born and (not died or e["date"] <= died)
            return y > ymd(born)[0] and (not died or y <= ymd(died)[0])

        awards = [e for e in p["ev"].values() if alive_at(e)]
        foundings = [e for sl, e in sorted(p["found"], key=lambda x: -x[0])
                     if alive_at(e) and age_at(born, e["date"]) >= MIN_FOUNDING_AGE][:FOUNDINGS_PER_PERSON]
        events = clean_events(name_en, field, sorted(awards + foundings, key=lambda e: e["date"]), ex_events)[:5]
        out.append({"q": k, "en": name_en, "ja": p.get("ja") or name_en, "b": born, "bp": bp, "d": died, "dp": dp,
                    "f": field, "sl": sitelinks[k], "ev": events,
                    "den": p.get("den") or "", "dja": p.get("dja") or "",
                    "ten": p.get("ten") or "", "tja": p.get("tja") or "", "img": p.get("img") or ""})

    for name in sorted(ex_names - matched_names):
        print(f"  (exclude.txt の '{name}' は取得範囲に見当たらない)")
    out.sort(key=lambda x: -x["sl"])
    OUT.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    for reason, n in sorted(dropped.items(), key=lambda x: -x[1]):
        print(f"  除外 {n:5d}  {reason}")
    print(f"wrote {len(out)} stars -> {OUT} ({OUT.stat().st_size // 1024} KB)")


if __name__ == "__main__":
    main()
