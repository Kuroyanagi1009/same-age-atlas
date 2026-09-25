# 同い年の星図 / Same-Age Atlas（プロトタイプ）

自分のつまみで年齢を選ぶと、その年齢で世を去った人、その年齢で転機・開花を迎えた人、
まだこの先に花開く人が一画面に並ぶ。

## 起動

```
python -m http.server 8795 --bind 127.0.0.1
```
→ http://127.0.0.1:8795/ （file:// では JSON を読めない）

または `同い年の星図を開く.cmd` をダブルクリック（サーバー起動とブラウザ表示をまとめて行う）。
`?age=45` を付けると45歳の画面で開く。

## ファイル

更新履歴は `CHANGELOG.md`。

| パス | 内容 |
|---|---|
| `index.html` / `style.css` / `app.js` | 画面。ビルド不要のバニラJS |
| `i18n.js` | 日英の文言 |
| `data/featured.json` | 主役（手作業・178人。うち早熟の天才47人）。生没年月日・人物説明・転機/開花（日英） |
| `data/seed_vital.txt` | 知名度に関係なく入れる各分野の代表的人物（英語版の記事名） |
| `data/stars.json` | 背景の星（Wikidata から自動取得＋説明文は Wikipedia 冒頭文） |
| `data/fame.json` | 知名度（日英 Wikipedia の直近30日の閲覧数）と、主役の日本語版記事名・写真 |
| `data/exclude.txt` | 背景の星から外す人物（QID か英語名） |
| `scripts/fetch_wikidata.py` | `stars.json` を作る（約20〜60分。Wikidata の混み具合による） |
| `scripts/fetch_descriptions.py` | `stars.json` の説明文を Wikipedia 冒頭文にする（中断再開可） |
| `scripts/fetch_fame.py` | `fame.json` を作る（約10分） |
| `scripts/fields.py` | 分野の判定（Wikidata の短い説明文から） |
| `scripts/check_featured.py` | `featured.json` の検査（生没年を Wikidata と照合、文中の「N歳」と計算年齢の一致） |
| `scripts/format_featured.py` | `featured.json` の整形。`data/_new.json` があれば取り込む |
| `scripts/test_app.js` | 画面の処理の自動テスト（`node scripts/test_app.js`） |
| `同い年の星図を開く.cmd` | ダブルクリックで起動してブラウザで開く |
| `ROADMAP.md` | 改善案と優先順位 |

データを作り直す手順: `fetch_wikidata.py` → `fetch_descriptions.py` → `fetch_fame.py`
（後処理だけ直したときは `fetch_wikidata.py --resume` で取得をやり直さずに済む）

## 転機と開花

出来事は2種類に分けて色を変える（見出し・欄・星図で共通）。
- **転機（緑）**: 道が変わった出来事。退職・移住・入学・創業・デビュー・始めたこと
- **開花（金）**: 成果が認められた出来事。代表作・記録・受賞・成功
- **没（青）**

「この先に花開く人」は開花だけを出す。`featured.json` では `type` から既定の種類が決まり
（turning / founding → 転機、それ以外 → 開花）、例外は各出来事に `"kind"` を書く。

## 並び順（知名度）

画面の言語の Wikipedia の直近30日の閲覧数で並べる（日本語なら日本での知名度）。
例: アインシュタイン 54,673 回、ドラジェン・ペトロヴィッチ 508 回（日本語版）。
手で選んだ人（✦）は少しだけ上げる。星図の星の明るさ・大きさも閲覧数による。

## 正確さの方針

- **背景の星の範囲**: 知名度（sitelinks）60以上 ＋ 各分野の代表的人物（`data/seed_vital.txt`、英語版 Wikipedia の
  Vital articles レベル4の人物1,925人。知名度を問わない）＋ 20歳以下で主要な賞を受けた人（知名度15以上）
- **生没年**: 「年」以上の精度で確定している人。年・月までの人は年齢を幅で出す（「51〜52歳で没」）。
  捨てるもの: 世紀・年代まで／「頃」「推定」「異説あり」の注記つき／値が食い違って満年齢が変わるもの。
  西暦1000年より前の生まれは、日まで書かれていても伝承の日付が多い（ムハンマド、李白など）ので外す。
  アルキメデス（前287年頃生）・プラトン・ティツィアーノなど生年が推定の人は入らない
- **背景の星の出来事**
  - 開花: 主要な賞（ノーベル賞各賞・フィールズ賞・チューリング賞・アーベル賞・アカデミー賞3部門・五輪金メダル・バロンドール）
  - 転機: よく知られた企業の創業。Wikidata の「創業者」には誤り（例: マスクを Hyperloop One の創業者とする、
    ダイムラーの没後の Mercedes-Benz 設立）があるため、企業の知名度 40 以上・教育研究機関を除く・設立年が1つに定まる・
    本人が15歳以上で存命中、に限る。社名が変わった企業は「（のちの〇〇）」と添える
  - 代表作は日付の意味（初演・出版・完成）が揺れるので使わない
- **分野**: Wikidata の短い説明文（"American physicist" など）で決める。職業一覧は副業まで並ぶので予備
- **年だけ分かる出来事**は「27〜28歳頃」と幅で表示し、その両方の年齢で出す
- **転機は亡くなる前の出来事だけ**

## 載せない人物

背景の星から自動で外す: 存命の政治家・宗教指導者／ナチ党員／殺人・性犯罪・戦争犯罪・テロで有罪（Wikidata P1399）／
職業がテロ・犯罪／15歳未満で没／`data/exclude.txt` の人物。
反逆罪・異端・同性愛での有罪（チューリング、ガリレオ等）は外さない。
`exclude.txt` を直したら `python scripts/fetch_wikidata.py --refilter`（取り直し不要。ただし消すだけ）。

## 今後の拡張の見通し（2026-09-25 に検証）

### 顔写真 — 実現できる
- Wikidata の画像(P18)が背景の星 5,037 人中 5,010 人（99.5%）にある。`stars.json` の `img`、`fame.json` の主役分に取得済み
- 表示は `https://commons.wikimedia.org/wiki/Special:FilePath/<ファイル名>?width=240` で縮小画像が得られる
- 課題はライセンス表記。古い人物はパブリックドメインが多いが、現代の人物は CC BY-SA などで、
  作者名とライセンスを画像ごとに添える必要がある。Commons API（`prop=imageinfo&iiprop=extmetadata`）で
  作者・ライセンスが取れるので、カードを開いたときに1件ずつ取りに行けばよい（未ログインの回数制限内に収まる）

### 年表 — 部分的に実現できる（人による差が大きい）
- Wikidata には日付つきの記述（学歴 P69・所属 P108・役職 P39・受賞 P166・配偶者 P26・会員 P463）がある
  - 例: アインシュタイン 68件、ホーキング 64件、ジョブズ 21件、ガロア 9件
- 学者・政治家は厚いが、芸術家・作家・スポーツ選手は薄い。「何を成し遂げたか」（作品・記録）は構造化されていないことが多い
- Wikidata には誤りもある（創業者・生年の例）ので、自動で年表を作るなら
  「Wikidata の構造化データのみ・出典つき」に限り、主役は今のように手で書くのが確実
- Wikipedia 本文から年表を起こすのは情報量が多いが、自動抽出は誤りの検査が要る（今回の方針と相容れない）

## featured.json の書き方

```json
{"id":"sanders","wiki":"Colonel Sanders","ja":"…","en":"…","born":"1890-09-09","died":"1980-12-16","field":"business","country":"US",
 "desc_ja":"ケンタッキーフライドチキン（KFC）の創業者","desc_en":"Founder of Kentucky Fried Chicken",
 "milestones":[
  {"date":"1952","age":61,"type":"founding","ja":"…","en":"…"}]}
```
- `wiki` は英語版 Wikipedia の記事名（検査・リンク・知名度に使う）
- `date` は `YYYY` / `YYYY-MM` / `YYYY-MM-DD`。紀元前は天文年（前356年 = `-0355`）
- 年・月までの日付は年齢を幅で出す。確かな年齢が分かっていれば `age` で固定
- `type`: debut / breakthrough / founding / masterpiece / award / turning。種類を変えたいときは `"kind": "turning"|"bloom"`
- `field`: science / arts / literature / business / politics / sports / other
- 生没年が不確かな人は `"approx": true`。Wikidata 側の誤りを手で確かめた人は `"verified"` に根拠
- 足したら `python scripts/check_featured.py` を通す
