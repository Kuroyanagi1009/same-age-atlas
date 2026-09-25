"""人物の分野（science / arts / literature / business / politics / sports / other）を判定する。

第一の手がかりは Wikidata の英語の短い説明（"American physicist", "40th president of the
United States" など）。人の手で「その人が何者か」を一言で書いたものなので、職業(P106)の
一覧より確か。職業の一覧は副業まで並ぶ（物理学者ケンドールに "mountaineer"、
化学者ポーターに一代貴族としての "politician"）ため、説明が無いときの予備にだけ使う。

説明の中で最も前に出てくる語で決める（"American actor and politician" → 俳優 → arts）。
"""
import re

KEYWORDS = {
    "sports": r"footballer|soccer|baseball|basketball|tennis|golfer|boxer|wrestler|swimmer|sprinter|"
              r"runner|athlete|cyclist|racing driver|formula one|skater|skier|gymnast|sumo|rikishi|"
              r"cricketer|rugby|hockey|volleyball|jockey|chess player|mountaineer|martial artist|"
              r"judoka|fencer|rower|sport shooter|marathon runner|olympian|olympic champion|coach|athletics|"
              r"racing cyclist|motorcycle racer|rally driver|driver|goalkeeper|pitcher|quarterback|player|"
              r"vaulter|pole-vaulter|jumper|thrower|hurdler|football manager|grandmaster|figure skater|"
              r"snowboarder|climber|surfer|decathlete|weightlifter|bullfighter|matador|karateka",
    "business": r"business(?:man|men|woman|women|person|people)?|entrepreneurs?|industrialist|banker|investor|"
                r"magnate|financier|merchant|executive|\bceo\b|founder of|tycoon|philanthropist|restaurateur",
    "science": r"physicist|mathematician|chemist|scientist|biologist|astronomer|engineer|inventor|"
               r"physician|botanist|zoologist|geologist|naturalist|economist|psychologist|psychiatrist|"
               r"computer|surgeon|anatomist|geographer|cartographer|explorer|astronaut|biochemist|"
               r"geneticist|neurologist|pharmacologist|physiologist|bacteriologist|microbiologist|"
               r"statistician|logician|crystallographer|meteorologist|oceanographer|aviator|pilot|"
               r"programmer|nurse|pathologist|virologist|immunologist|ecologist|entomologist|primatologist|"
               r"ethologist|polymath|doctor|chemists|physicists|researcher|professor|academic|educator|pedagogue|"
               r"[a-z]*ologist|[a-z]*physicist|cosmologist|palaeontologist|paleontologist|ophthalmologist",
    "literature": r"writer|poet|novelist|playwright|dramatist|author|philosopher|essayist|journalist|"
                  r"screenwriter|historian|theologian|translator|haiku|linguist|critic|lyricist|"
                  r"memoirist|diarist|sinologist|philologist|anthropologist|sociologist|scholar|"
                  r"literary|mangaka|manga artist|writers|poets|novelists|thinker|intellectual",
    "arts": r"painter|sculptor|composer|musician|singer|architect|photographer|actor|actress|"
            r"film ?maker|director|artist|pianist|violinist|cellist|conductor|dancer|ballet|comedian|"
            r"rapper|guitarist|designer|animator|illustrator|songwriter|drummer|band|rock|pop|"
            r"opera|television|film|filmmaker|producer|model|fashion|voice actor|seiyū|idol|"
            r"magician|cartoonist|printmaker|ukiyo-e|calligrapher|potter|youtuber|dj|ballerina|humorist|"
            r"entertainer|choreographer|ventriloquist|puppeteer|tenor|soprano|baritone",
    "politics": r"politician|president|prime minister|chancellor|monarch|emperor|empress|king|queen|"
                r"prince|princess|sultan|pharaoh|tsar|czar|shah|caliph|shōgun|shogun|daimyō|daimyo|"
                r"samurai|duke|duchess|count|countess|statesman|stateswoman|diplomat|military|general|"
                r"admiral|marshal|officer|soldier|revolutionary|activist|lawyer|judge|jurist|"
                r"governor|mayor|senator|minister|pope|saint|bishop|archbishop|cardinal|priest|monk|"
                r"nun|missionary|religious|prophet|preacher|rabbi|imam|cleric|lama|guru|reformer|"
                r"founder of the religion|civil rights|first lady|royal|ruler|leader|chief|warlord|"
                r"consul|dictator|noble|aristocrat|spy|explorer and colonial|secretary|congress|parliament|"
                r"congressman|congresswoman|agent|intelligence officer|daughter of|son of|wife of|consort|heir",
}
# 語の途中で当たらないよう前後に境界を置く（"Pope" に pop、"country" に count が当たらないように）
_COMPILED = {f: re.compile(rf"(?<![a-z])(?:{p})(?![a-z])", re.I) for f, p in KEYWORDS.items()}

# 職業一覧からの予備判定（同点のときの優先順）
_OCC_PRIORITY = ["politics", "sports", "science", "business", "arts", "literature"]


def field_from_text(text):
    """説明文の中で最も前に出てくる分野語で決める。当たらなければ None"""
    best, pos = None, None
    for f, rx in _COMPILED.items():
        m = rx.search(text or "")
        if m and (pos is None or m.start() < pos):
            best, pos = f, m.start()
    return best


def field_from_occupations(occupations):
    score = {}
    for occ in occupations:
        f = field_from_text(occ)
        if f:
            score[f] = score.get(f, 0) + 1
    if not score:
        return "other"
    return max(score, key=lambda f: (score[f], -_OCC_PRIORITY.index(f)))


def classify(description, occupations=(), awards=()):
    """説明文 → 受賞した賞（ノーベル物理学賞なら科学、など） → 職業一覧 の順に決める"""
    f = field_from_text(description)
    if f:
        return f
    for q, af in AWARD_FIELD.items():
        if q in awards:
            return af
    return field_from_occupations(occupations)


# 受けていれば分野が決まる賞（ノーベル平和賞は政治家以外も受けるので入れない）
AWARD_FIELD = {
    "Q38104": "science", "Q44585": "science", "Q80061": "science", "Q47170": "science",
    "Q28835": "science", "Q185667": "science", "Q208167": "science",
    "Q37922": "literature",
    "Q15243387": "sports", "Q166177": "sports",
}
