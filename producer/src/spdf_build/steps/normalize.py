"""Modernized-spelling layer (`fragments.search_text`), search only.

Port of Scholaris `@scholaris/normalizacion`. The literal text that gets cited
is never touched. Next to it, each fragment of an old text carries a SHADOW
text in which «aſsi», «Què», «coraçon», «q̃», «muger», «dixo», «aora» or «fee»
are reduced to a key that the modern query also produces. It is not modern
spelling word by word but an orthographic-phonetic key applied EQUALLY to the
text and to the query (b/v, mute h, g/j and c/z before e/i…), plus lists for
what really changed shape (dixo → dijo, agora → ahora, desta → de esta).

- `search_text(text, language, epoch)`: what goes into `fragments.search_text`:
  '' when the layer adds nothing over FTS5 folding (modern texts, English…).
- `document_epoch(sample, language, year)`: old or modern, by year or by the
  signals in the text (ſ, q̃, -sse, witness words).
- `query_variants(word)`: keys of a query word in Spanish, Latin, French and
  Italian (to search only in `search_text`).

Rules are documented in Scholaris `packages/normalizacion/RESULTADOS.md`.
"""
from __future__ import annotations

import re
import unicodedata
from functools import lru_cache
from typing import Optional

L = r"[^\W\d_]"  # one letter
NOT_L_BEFORE = r"(?<![^\W\d_])"
NOT_L_AFTER = r"(?![^\W\d_])"

VERSION = "1"

CODIGOS_ANTIGUOS = {"osp", "fro", "frm", "ita-old", "es-old"}
MODERN_THRESHOLD = {"es": 1830, "fr": 1800, "it": 1800, "la": 0, "other": 0}


def language_of(code: Optional[str]) -> str:
    i = (code or "").lower().strip()
    if not i:
        return "other"
    base = re.split(r"[-_\s]", i)[0]
    if base in ("es", "spa", "esp", "osp", "castellano", "espanol", "español", "spanish"):
        return "es"
    if base in ("la", "lat", "latin", "latín"):
        return "la"
    if base in ("fr", "fra", "fre", "frm", "fro", "francais", "français", "french"):
        return "fr"
    if base in ("it", "ita", "italiano", "italian"):
        return "it"
    return "other"


def old_code(code: Optional[str]) -> bool:
    return (code or "").lower().strip() in CODIGOS_ANTIGUOS


# ---------------------------------------------------------------------------
# Characters
# ---------------------------------------------------------------------------

SPECIAL = {
    "ſ": "s", "ʃ": "s", "ß": "ss", "æ": "ae", "œ": "oe", "ꝑ": "per", "ꝓ": "pro", "ꝗ": "que", "ꝙ": "quod", "ꝯ": "con",
    "ﬀ": "ff", "ﬁ": "fi", "ﬂ": "fl", "ﬃ": "ffi", "ﬄ": "ffl", "ﬅ": "st", "ﬆ": "st", "ꝛ": "r", "ı": "i", "ȷ": "j",
    "ø": "o", "đ": "d", "ł": "l", "ħ": "h",
}
_SPECIAL_RE = re.compile("[" + "".join(SPECIAL) + "]")
ET = {"es": " y ", "la": " et ", "fr": " et ", "it": " e ", "other": " "}
_WORD = re.compile(r"[^\W_]+")


def _strip_combining(s: str) -> str:
    return "".join(c for c in s if not unicodedata.combining(c))


def prepare(text: str, lang: str) -> str:
    s = unicodedata.normalize("NFD", text).lower()
    if "&" in s or "⁊" in s:
        s = re.sub(r"[&⁊]", ET[lang], s)
    if s.isascii():
        return s
    s = _SPECIAL_RE.sub(lambda m: SPECIAL[m.group(0)], s)
    if lang != "other":
        s = re.sub("q[̃̄]", "que", s)
        s = re.sub("([aeiou])[̃̄]+([pb]?)", lambda m: f"{m.group(1)}{'m' if m.group(2) else 'n'}{m.group(2)}", s)
    if lang == "es":
        s = s.replace("ñ", "ñ")
        s = re.sub("ç([ei]?)", lambda m: f"c{m.group(1)}" if m.group(1) else "z", s)
        s = s.replace("ç", "z")
    return _strip_combining(s) if lang != "es" else "".join(c for c in s if not unicodedata.combining(c))


def basic_fold(text: str) -> str:
    """The same folding FTS5 does with remove_diacritics: lowercase, no marks, only words."""
    s = _strip_combining(unicodedata.normalize("NFD", text or "").lower())
    return " ".join(_WORD.findall(s))


def _compile_prefixes(m: dict[str, str]):
    keys = sorted(m, key=len, reverse=True)
    rx = re.compile("^(?:" + "|".join(map(re.escape, keys)) + ")")

    def f(w: str) -> str:
        mm = rx.match(w)
        return m[mm.group(0)] + w[mm.end():] if mm else w
    return f


# ---------------------------------------------------------------------------
# Spanish
# ---------------------------------------------------------------------------

WORDS_ES = {
    "fee": "fe", "agora": "ahora", "aguora": "ahora", "mesmo": "mismo", "mesma": "misma", "mesmos": "mismos", "mesmas": "mismas",
    "proprio": "propio", "propria": "propia", "proprios": "propios", "proprias": "propias", "propriedad": "propiedad",
    "ansi": "asi", "ansimesmo": "asimismo", "ansimismo": "asimismo", "assimesmo": "asimismo", "asimesmo": "asimismo", "otrosi": "otrosi",
    "estonces": "entonces", "entonce": "entonces",
    "truxo": "trajo", "truxe": "traje", "truxeron": "trajeron", "truxera": "trajera", "truxesse": "trajese", "truxiste": "trajiste",
    "trujo": "trajo", "truje": "traje", "trujeron": "trajeron", "trujera": "trajera", "trujese": "trajese", "trujiste": "trajiste",
    "vido": "vio", "vee": "ve", "veer": "ver", "seer": "ser", "vees": "ves", "veen": "ven",
    "sotil": "sutil", "sotiles": "sutiles", "sotileza": "sutileza",
    "cobdicia": "codicia", "cudicia": "codicia", "cobdiciar": "codiciar", "cibdad": "ciudad", "cibdades": "ciudades",
    "dubda": "duda", "dubdas": "dudas", "dubdar": "dudar",
    "licion": "leccion", "liciones": "lecciones", "quistion": "cuestion", "quistiones": "cuestiones",
    "vuessa": "vuestra", "vuesa": "vuestra", "vuessas": "vuestras", "vuesas": "vuestras", "vuessamerced": "vuestra merced",
    "vuesamerced": "vuestra merced", "mill": "mil", "ovo": "hubo", "hobo": "hubo", "ovieron": "hubieron",
    "complir": "cumplir", "complido": "cumplido", "complida": "cumplida",
    "escuro": "oscuro", "escura": "oscura", "escuros": "oscuros", "escuras": "oscuras", "escuridad": "oscuridad",
    "cativo": "cautivo", "cativa": "cautiva", "cativos": "cautivos", "cativas": "cautivas", "cativerio": "cautiverio", "cautiuerio": "cautiverio",
    "dotor": "doctor", "dotores": "doctores", "dotrina": "doctrina", "dotrinas": "doctrinas",
    "conceto": "concepto", "concetos": "conceptos", "efeto": "efecto", "efetos": "efectos", "efetuar": "efectuar",
    "perfeto": "perfecto", "perfeta": "perfecta", "perfetos": "perfectos", "perfetas": "perfectas", "perfecion": "perfeccion", "perficion": "perfeccion",
    "acetar": "aceptar", "aceto": "acepto", "preceto": "precepto", "precetos": "preceptos",
    "coluna": "columna", "colunas": "columnas", "solene": "solemne", "solenes": "solemnes",
    "dino": "digno", "dina": "digna", "dinos": "dignos", "dinas": "dignas", "indino": "indigno", "indina": "indigna",
    "malino": "maligno", "malina": "maligna", "sinificar": "significar", "sinifica": "significa", "manifico": "magnifico", "manifica": "magnifica",
    "otubre": "octubre",
    "fixo": "fijo", "fixa": "fija", "lexos": "lejos", "relox": "reloj", "coxo": "cojo", "coxa": "coja", "oxo": "ojo", "oxos": "ojos", "exe": "eje", "exes": "ejes",
    "desta": "de esta", "deste": "de este", "desto": "de esto", "destas": "de estas", "destos": "de estos",
    "dessa": "de esa", "desso": "de eso", "dessas": "de esas", "dessos": "de esos", "desa": "de esa", "deso": "de eso", "desas": "de esas", "desos": "de esos",
    "della": "de ella", "dello": "de ello", "dellas": "de ellas", "dellos": "de ellos",
    "daquel": "de aquel", "daquella": "de aquella", "daquello": "de aquello", "daquellos": "de aquellos", "daquellas": "de aquellas",
    "dalli": "de alli", "dalla": "de alla", "daqui": "de aqui", "destotro": "de este otro", "destotra": "de esta otra",
    "fecho": "hecho", "fechos": "hechos", "ferir": "herir", "ferido": "herido", "ferida": "herida", "feridos": "heridos", "feridas": "heridas",
    "fasta": "hasta", "facer": "hacer", "fuyr": "huir", "fuir": "huir",
    "charidad": "caridad", "chaos": "caos", "choro": "coro", "choros": "coros", "monarcha": "monarca", "monarchas": "monarcas",
    "monarchia": "monarquia", "patriarcha": "patriarca", "patriarchas": "patriarcas", "achiles": "aquiles", "achilles": "aquiles",
    "chimera": "quimera", "chimeras": "quimeras", "machina": "maquina", "machinas": "maquinas", "archangel": "arcangel", "archangeles": "arcangeles",
    "character": "caracter", "characteres": "caracteres", "cholera": "colera", "eucharistia": "eucaristia", "anachoreta": "anacoreta", "anachoretas": "anacoretas",
    "fiempre": "siempre", "fobre": "sobre", "fiendo": "siendo", "fido": "sido", "fus": "sus", "fer": "ser",
}

PREFIXES_ES = {
    "dix": "dij", "predix": "predij", "contradix": "contradij", "bendix": "bendij", "maldix": "maldij",
    "trax": "traj", "trux": "traj", "atrax": "atraj", "retrax": "retraj", "dex": "dej",
    "abax": "abaj", "debax": "debaj", "bax": "baj", "cax": "caj", "rox": "roj", "quex": "quej", "exerc": "ejerc", "exempl": "ejempl",
    "alex": "alej", "flox": "floj", "aflox": "afloj", "embax": "embaj", "quix": "quij", "texer": "tejer", "texid": "tejid", "texed": "tejed",
    "xabon": "jabon", "xarab": "jarab", "ximen": "jimen", "xerez": "jerez", "oxal": "ojal", "lisonx": "lisonj", "mexor": "mejor",
    "dibux": "dibuj", "enxut": "enjut", "exido": "ejido", "axen": "ajen", "mux": "muj", "paxar": "pajar",
    "tixer": "tijer", "vexez": "vejez", "hixo": "hijo", "hixa": "hija", "mexill": "mejill", "consex": "consej", "luxur": "lujur",
    "fabl": "habl", "fermos": "hermos", "fiz": "hiz", "foja": "hoja", "fambr": "hambr", "fierr": "hierr", "faz": "haz",
    "folg": "holg", "fembr": "hembr", "fidalg": "hidalg", "fuyend": "huyend",
    "obscur": "oscur", "subst": "sust", "subscri": "suscri", "sancti": "santi", "sanct": "sant", "escript": "escrit", "script": "escrit",
    "receb": "recib", "rescib": "recib", "resceb": "recib", "escrev": "escrib", "escreu": "escrib", "succed": "suced", "success": "suces",
    "accept": "acept", "excell": "excel", "illustr": "ilustr", "intellig": "intelig", "colleg": "coleg", "colloc": "coloc", "assumpt": "asunt",
    "psych": "psic", "mechan": "mecan", "technic": "tecnic",
}
_prefixes_es = _compile_prefixes(PREFIXES_ES)
_FT_LEGIT = re.compile(r"^(?:naft|aft[ao]s?$|dift|oftalm|soft|loft|kraft|ft)")


def fix_long_s(w: str) -> str:
    if "f" not in w:
        return w
    s = w
    if re.search(r"f[smpcq]", s):
        s = re.sub(r"f(?=[smpcq])", "s", s)
    if "ft" in s and not _FT_LEGIT.match(s):
        s = re.sub(r"f(?=t)", "s", s)
    if len(s) > 4 and s.endswith("rfe"):
        s = s[:-2] + "se"
    return s


def fold_es(w: str) -> str:
    s = w
    if "h" in s:
        s = s.replace("ph", "f").replace("th", "t")
        s = re.sub(r"ch(?=[rl])", "c", s)
    if "qu" in s:
        s = re.sub(r"qu(?=[ao])", "cu", s)
        s = re.sub(r"quen(?=[tc])", "cuen", s)
        s = re.sub(r"^quest", "cuest", s)
    if "sc" in s:
        s = re.sub(r"^sc(?=[ei])", "c", s)
        s = re.sub(r"([aeiou])sc(?=[ei])", r"\1c", s)
    s = re.sub(r"^s(?=[bcdfgjklmnpqrtvz])", "es", s)
    if "y" in s:
        s = re.sub(r"y(?![aeiou])", "i", s)
    s = re.sub(r"^i(?=[aeou])", "j", s)
    s = re.sub(r"^v(?=[^aeiou])", "u", s)
    if "u" in s:
        s = re.sub(r"([aeiou])u(?=[aeiou])", r"\1v", s)
    s = s.replace("v", "b")
    if "h" in s:
        s = re.sub(r"(?<!c)h", "", s)
    if "g" in s:
        s = re.sub(r"g(?=[ei])", "j", s)
    if "c" in s:
        s = re.sub(r"c(?=[ei])", "z", s)
    if "rr" in s:
        s = re.sub(r"(^|[nls])rr", r"\1r", s)
    if "n" in s:
        s = re.sub(r"n(?=[pb])", "m", s)
    s = re.sub(r"([sfmptbdgn])\1+", r"\1", s)
    return s


def word_es(w: str) -> tuple[str, Optional[list[str]]]:
    if not w or w.isdigit():
        return w, None
    s = WORDS_ES.get(w)
    if s is None:
        fixed = fix_long_s(w)
        s = WORDS_ES.get(fixed) or _prefixes_es(fixed)
    if " " in s:
        return " ".join(fold_es(x) for x in s.split(" ")), None
    return fold_es(s), None


_SIGNALS_ES = re.compile(
    "|".join([
        "ſ", "q̃", "[ãẽĩõũ]", "[àèìòù]", "ç",
        rf"{L}+ss(?:e|en|emos|es){NOT_L_AFTER}",
        NOT_L_BEFORE + r"(?:assi|ansi|quando|qual|quales|quanto|quanta|quantos|quantas|quatro|dixo|dixe|dixeron|muger|mugeres|agora|"
        r"aora|desta|deste|destos|destas|dello|della|dellos|mesmo|mesma|hazer|haze|hazen|hazia|dezir|dize|dizen|dezia|vn|vna|vnos|vnas|"
        r"avia|havia|avian|havian|aver|haver|huvo|uvo|proprio|propria|traygo|reyno|reyna|ayre|oyr|essa|esso|esse|essos|essas|excesso|"
        r"sucesso|exercito|exemplo|baxo|dexar|dexo|quexa|fee|vuessa|vuesa|cuydado|cuydar|christiano|christiana|christo|iusticia|iuez|"
        r"aqueste|aquesta|aquesto|fazer|fizo|fasta|vido|truxo|trujo|estonces)" + NOT_L_AFTER,
    ])
)


def signals_es(text: str) -> tuple[int, int]:
    t = unicodedata.normalize("NFC", text).lower()
    return len(_SIGNALS_ES.findall(t)), len(re.findall(rf"{L}+", t))


# ---------------------------------------------------------------------------
# Latin
# ---------------------------------------------------------------------------

WORDS_QUE = set((
    "atque quoque neque itaque absque apsque abusque adaeque adusque denique deque susque oblique peraeque plenisque "
    "quandoque quisque quaeque cuiusque cuique quemque quamque quaque quique quorumque quarumque quibusque quosque "
    "quasque quotusquisque quousque ubique undique usque uterque utique utroque utribique torque coque concoque "
    "contorque detorque decoque excoque extorque obtorque optorque retorque recoque attorque incoque intorque praetorque "
    "namque utrumque utraque utrique utriusque quidque quodque quicumque quaecumque quodcumque quacumque quocumque "
    "ubicumque undecumque quantumque plerumque plerique pleraque quinque").split())
NOT_ENCLITIC = {"omne", "bene", "sine", "pone", "paene", "pene", "mane", "inane", "immane", "abstine", "sustine", "retine", "contine",
                "pertine", "obtine", "detine", "neue", "siue", "seue", "breue", "graue", "leue", "suaue", "caue", "aue", "saeue"}
NOUN_SUFFIXES = ["ibus", "ius", "ae", "am", "as", "em", "es", "ia", "is", "nt", "os", "ud", "um", "us", "a", "e", "i", "o", "u"]
VERB_SUFFIXES = [("iuntur", "i"), ("beris", "bi"), ("erunt", "i"), ("untur", "i"), ("iunt", "i"), ("mini", ""), ("ntur", ""),
                 ("stis", ""), ("bor", "bi"), ("ero", "eri"), ("mur", ""), ("mus", ""), ("ris", ""), ("sti", ""), ("tis", ""),
                 ("tur", ""), ("unt", "i"), ("bo", "bi"), ("ns", ""), ("nt", ""), ("ri", ""), ("m", ""), ("r", ""), ("s", ""), ("t", "")]


def noun_stem(w: str) -> str:
    for s in NOUN_SUFFIXES:
        if w.endswith(s) and len(w) - len(s) >= 2:
            return w[:-len(s)]
    return w


def verb_stem(w: str) -> str:
    for s, r in VERB_SUFFIXES:
        if w.endswith(s):
            root = w[:-len(s)] + r
            return root if len(root) >= 2 else w
    return w


def fold_latin(w: str) -> str:
    s = w.replace("ae", "e").replace("oe", "e").replace("y", "i")
    if s == "michi":
        return "mihi"
    if s == "nichil":
        return "nihil"
    return re.sub(r"(?<=[a-z])ci(?=[aeiou])", "ti", s)


def split_enclitic(w: str) -> tuple[str, Optional[str]]:
    if len(w) > 4 and w.endswith("que"):
        return (w, None) if w in WORDS_QUE else (w[:-3], "que")
    if w == "nonne":
        return "non", "ne"
    if len(w) > 4 and re.search(r"[st]ne$", w) and w not in NOT_ENCLITIC:
        return w[:-2], "ne"
    if len(w) > 4 and re.search(r"[stm]ue$", w) and w not in NOT_ENCLITIC:
        return w[:-2], "ue"
    return w, None


def word_latin(w0: str) -> tuple[str, Optional[list[str]]]:
    if not w0 or w0.isdigit():
        return w0, None
    w = w0.replace("v", "u").replace("j", "i")
    base, enc = split_enclitic(w)
    folded = fold_latin(base)
    p = f"{folded} {enc}" if enc else folded
    if base in WORDS_QUE or len(folded) < 3:
        return p, None
    extra = []
    n, v = noun_stem(folded), verb_stem(folded)
    if n != folded and len(n) >= 3:
        extra.append(n)
    if v != folded and v != n and len(v) >= 3:
        extra.append(v)
    return p, extra or None


# ---------------------------------------------------------------------------
# French and Italian
# ---------------------------------------------------------------------------

WORDS_FR = {
    "estoit": "etait", "estoient": "etaient", "avoit": "avait", "avoient": "avaient", "estre": "etre", "mesme": "meme", "mesmes": "memes",
    "nostre": "notre", "nostres": "notres", "vostre": "votre", "vostres": "votres", "aussy": "aussi", "ainsy": "ainsi", "cy": "ci", "icy": "ici",
    "ung": "un", "vng": "un", "faict": "fait", "faicts": "faits", "faicte": "faite", "dict": "dit", "dicts": "dits", "dicte": "dite",
    "aultre": "autre", "aultres": "autres", "eust": "eut", "fust": "fut", "nuict": "nuit", "scavoir": "savoir", "sçavoir": "savoir",
    "scay": "sais", "scait": "sait", "cognoistre": "connaitre", "connoistre": "connaitre", "paroistre": "paraitre", "françois": "francais",
    "francois": "francais", "anglois": "anglais", "foible": "faible", "foiblesse": "faiblesse", "monsr": "monsieur", "mr": "monsieur",
    "roy": "roi", "loy": "loi", "foy": "foi", "moy": "moi", "toy": "toi", "soy": "soi", "luy": "lui", "celuy": "celui", "ay": "ai",
    "vray": "vrai", "vraye": "vraie",
}
OIT_LEGIT = {"soit", "voit", "doit", "croit", "boit", "toit", "droit", "endroit", "adroit", "maladroit", "etroit", "exploit", "recoit",
             "decoit", "concoit", "apercoit", "percoit", "soient", "voient", "croient", "envoient"}


def word_fr(w: str) -> tuple[str, Optional[list[str]]]:
    if not w or w.isdigit():
        return w, None
    if w in WORDS_FR:
        return WORDS_FR[w], None
    s = re.sub(r"^v(?=[^aeiouy])", "u", w)
    if "u" in s:
        s = re.sub(r"([aeiou])u(?=[aeiou])", r"\1v", s)
    s = re.sub(r"^i(?=[aeou])", "j", s)
    if s not in OIT_LEGIT:
        if len(s) >= 6 and s.endswith("oit"):
            s = s[:-3] + "ait"
        elif len(s) >= 7 and s.endswith("oient"):
            s = s[:-5] + "aient"
    if "s" in s:
        s = re.sub(r"(?<=[aeiou])s(?=[tmlnpcq])", "", s)
    if s.endswith("y") and len(s) > 1 and re.search(r"[aeiou]y$", s):
        s = s[:-1] + "i"
    return s, None


WORDS_IT = {
    "huomo": "uomo", "huomini": "uomini", "hoggi": "oggi", "hora": "ora", "hore": "ore", "hebbe": "ebbe", "hebbero": "ebbero", "et": "e",
    "hauere": "avere", "havere": "avere", "haueua": "aveva", "haveva": "aveva", "hauea": "avea", "havea": "avea", "anchora": "ancora",
    "imperoche": "imperocche", "percioche": "perciocche", "conciosia": "conciossia",
}
MODERN_H = {"ho", "hai", "ha", "hanno"}
_prefixes_it = _compile_prefixes({"hau": "av", "hav": "av", "huom": "uom", "histor": "istor", "honor": "onor", "honest": "onest",
                                  "human": "uman", "humil": "umil"})


def word_it(w: str) -> tuple[str, Optional[list[str]]]:
    if not w or w.isdigit():
        return w, None
    if w in WORDS_IT:
        return WORDS_IT[w], None
    s = _prefixes_it(w)
    if s.startswith("h") and s not in MODERN_H:
        s = s[1:]
    s = re.sub(r"^v(?=[^aeiou])", "u", s)
    if "u" in s:
        s = re.sub(r"([aeiou])u(?=[aeiou])", r"\1v", s)
    s = s.replace("j", "i").replace("ph", "f").replace("th", "t").replace("x", "s")
    s = re.sub(r"[cp]t", "tt", s)
    s = re.sub(r"(?<=[a-rt-z])ti(?=[aeiou])", "zi", s)
    return s, None


_SIGNALS_FR = re.compile(
    "ſ|" + NOT_L_BEFORE + r"(?:estoit|estoient|avoit|avoient|faisoit|disoit|estre|mesme|mesmes|nostre|vostre|aussy|ainsy|icy|faict|"
    r"dict|aultre|eust|fust|nuict|sçavoir|scavoir|cognoistre|connoistre|roy|loy|foy|moy|luy|celuy|vray|maistre|teste|beste|feste|isle|ung)"
    + NOT_L_AFTER + rf"|{L}{{3,}}oient" + NOT_L_AFTER)
_SIGNALS_IT = re.compile(
    "ſ|" + NOT_L_BEFORE + r"(?:huomo|huomini|hoggi|hauere|havere|haueua|haveva|hauea|havea|hebbe|anchora|imperoche|percioche|et)"
    + NOT_L_AFTER + rf"|{L}+tione" + NOT_L_AFTER + rf"|{L}+tia" + NOT_L_AFTER)


def signals_romance(text: str, lang: str) -> tuple[int, int]:
    t = unicodedata.normalize("NFC", text).lower()
    rx = _SIGNALS_FR if lang == "fr" else _SIGNALS_IT
    return len(rx.findall(t)), len(re.findall(rf"{L}+", t))


_WORD_FN = {"es": word_es, "la": word_latin, "fr": word_fr, "it": word_it}


@lru_cache(maxsize=200_000)
def _cached(lang: str, w: str):
    return _WORD_FN[lang](w)


# ---------------------------------------------------------------------------
# Epoch and API
# ---------------------------------------------------------------------------


def detect_epoch(text: str, code: Optional[str]) -> str:
    lang = language_of(code)
    if lang == "la":
        return "old"
    if lang not in ("es", "fr", "it"):
        return "modern"
    if old_code(code):
        return "old"
    signals, words = signals_es(text) if lang == "es" else signals_romance(text, lang)
    if signals >= 2 and signals >= words * 0.01:
        return "old"
    if words < 40 and signals >= 1 and signals * 20 >= words:
        return "old"
    return "modern"


def resolve_epoch(text: str, code: Optional[str], epoch=None) -> str:
    lang = language_of(code)
    if lang == "la":
        return "old"
    if epoch in ("old", "modern"):
        return epoch
    if isinstance(epoch, (int, float)) and epoch > 0:
        if old_code(code):
            return "old"
        return "old" if epoch < MODERN_THRESHOLD[lang] else "modern"
    return detect_epoch(text, code)


def document_epoch(sample, code: Optional[str], year: Optional[int] = None) -> str:
    lang = language_of(code)
    if lang == "la":
        return "old"
    if lang not in _WORD_FN:
        return "modern"
    if old_code(code):
        return "old"
    if isinstance(year, int) and 0 < year < MODERN_THRESHOLD[lang]:
        return "old"
    if isinstance(sample, str):
        text = sample[:200_000]
    else:
        text = ""
        for t in sample:
            text += t + "\n"
            if len(text) > 200_000:
                break
    return detect_epoch(text, code)


def normalize_detailed(text: str, code: Optional[str], epoch=None) -> tuple[str, list[str], str, str]:
    lang = language_of(code)
    e = resolve_epoch(text, code, epoch)
    if lang not in _WORD_FN or e == "modern":
        return basic_fold(text), [], lang, e
    prepared = prepare(text, lang)
    out: list[str] = []
    extras: dict[str, None] = {}
    for m in _WORD.finditer(prepared):
        p, x = _cached(lang, m.group(0))
        out.append(p)
        if x:
            for t in x:
                extras[t] = None
    return " ".join(out), list(extras), lang, e


def normalize_for_search(text: str, code: Optional[str], epoch=None) -> str:
    p, x, _, _ = normalize_detailed(text, code, epoch)
    return f"{p} {' '.join(x)}" if x else p


def search_text(text: str, code: Optional[str], epoch=None) -> str:
    """Value of `fragments.search_text`: '' when it adds nothing over FTS5 folding."""
    if not text:
        return ""
    if language_of(code) not in _WORD_FN:
        return ""
    p, x, _, e = normalize_detailed(text, code, epoch)
    if e == "modern":
        return ""
    n = f"{p} {' '.join(x)}" if x else p
    return "" if n == basic_fold(text) else n


def query_variants(text: str, roots: bool = True) -> list[str]:
    folded = basic_fold(text)
    if not folded:
        return []
    seen = {folded}
    out = []
    several = " " in folded
    for lang in ("es", "la", "fr", "it"):
        p, x, _, _ = normalize_detailed(text, lang, "old")
        main = " ".join(t for t in p.split(" ") if t not in ("que", "ne", "ue")) if (not several and lang == "la") else p
        for v in [main] + ([t for t in x if len(t) >= 3] if (lang == "la" and not several and roots) else []):
            v = v.strip()
            if v and v not in seen:
                seen.add(v)
                out.append(v)
    return out
