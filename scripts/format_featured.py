"""data/featured.json を読みやすい形（1人1ブロック・転機1行ずつ）に整形する。
data/_new.json があれば末尾に取り込んでから消す。

    python scripts/format_featured.py
"""
import json
from pathlib import Path

DATA = Path(__file__).resolve().parent.parent / "data"
KEYS = ["id", "wiki", "ja", "en", "born", "died", "approx", "field", "country", "desc_ja", "desc_en", "verified"]


def dumps(v):
    return json.dumps(v, ensure_ascii=False)


def main():
    path = DATA / "featured.json"
    people = json.loads(path.read_text(encoding="utf-8"))
    new = DATA / "_new.json"
    if new.exists():
        ids = {p["id"] for p in people}
        people += [p for p in json.loads(new.read_text(encoding="utf-8")) if p["id"] not in ids]
        new.unlink()
    blocks = []
    for p in people:
        head = ",".join(f"{dumps(k)}:{dumps(p[k])}" for k in KEYS[:9] if k in p)
        desc = ",".join(f"{dumps(k)}:{dumps(p[k])}" for k in KEYS[9:] if k in p)
        ms = ",\n  ".join(dumps(m) for m in p["milestones"])
        blocks.append(f"{{{head},\n {desc},\n \"milestones\":[\n  {ms}]}}")
    path.write_text("[\n" + ",\n".join(blocks) + "\n]\n", encoding="utf-8")
    print(f"{len(people)} people")


if __name__ == "__main__":
    main()
