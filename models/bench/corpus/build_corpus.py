"""Builds the public-domain benchmark corpus for the SPDF models bench.

Outputs (committed to the repository):
  corpus/texts.jsonl    passages and queries (public-domain text, or queries written for this bench, CC0)
  corpus/images.json    image manifest: url, licence, source page, sha256
  corpus/audio.json     audio manifest: LibriVox recording, offset, sha256 of the 16 kHz WAV clip

Media files are downloaded to ~/.cache/spdf-models/bench-corpus (never committed).
Run with: python -I corpus/build_corpus.py [--texts] [--images] [--audio]
"""
from __future__ import annotations

import argparse
import hashlib
import html
import json
import random
import re
import subprocess
import sys
import time
import unicodedata
import urllib.parse
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
CACHE = Path.home() / ".cache" / "spdf-models" / "bench-corpus"
UA = {"User-Agent": "spdf-models-bench/0.1 (https://github.com/joseluissaorin/spdf)",
      "AIC-User-Agent": "spdf-models-bench (https://github.com/joseluissaorin/spdf)"}

# (key, lang, title, author, source, locator). All works are in the public domain.
GUTENBERG = [
    ("quijote", "es", "Don Quijote", "Miguel de Cervantes", "gutenberg", 2000),
    ("pride", "en", "Pride and Prejudice", "Jane Austen", "gutenberg", 1342),
    ("origin", "en", "On the Origin of Species", "Charles Darwin", "gutenberg", 1228),
    ("miserables", "fr", "Les misérables, tome I", "Victor Hugo", "gutenberg", 17489),
    ("candide", "fr", "Candide, ou l'optimisme", "Voltaire", "gutenberg", 4650),
    ("faust", "de", "Faust. Der Tragödie erster Teil", "Johann Wolfgang von Goethe", "gutenberg", 2229),
    ("verwandlung", "de", "Die Verwandlung", "Franz Kafka", "gutenberg", 22367),
    ("commedia", "it", "La Divina Commedia", "Dante Alighieri", "gutenberg", 1012),
    ("lusiadas", "pt", "Os Lusíadas", "Luís de Camões", "gutenberg", 3333),
    ("casmurro", "pt", "Dom Casmurro", "Machado de Assis", "gutenberg", 55752),
    ("gallico", "la", "De Bello Gallico", "C. Iulius Caesar", "gutenberg", 218),
    ("honglou", "zh", "紅樓夢", "曹雪芹", "gutenberg", 24264),
    ("rashomon", "ja", "羅生門", "芥川龍之介", "gutenberg", 1982),
    ("havelaar", "nl", "Max Havelaar", "Multatuli", "gutenberg", 11024),
    ("veljesta", "fi", "Seitsemän veljestä", "Aleksis Kivi", "gutenberg", 11940),
    ("krestomatio", "eo", "Fundamenta Krestomatio", "L. L. Zamenhof", "gutenberg", 8224),
]
WIKISOURCE = [
    ("shinel", "ru", "Шинель", "Николай Гоголь", "ru", "Шинель (Гоголь)/СС 1967 (СО)"),
    ("kapitan", "ru", "Капитанская дочка, глава I", "Александр Пушкин", "ru", "Капитанская дочка (Пушкин)/1960 (СО)/Глава I"),
    ("alflayla", "ar", "ألف ليلة وليلة", "مجهول", "ar", "ألف ليلة وليلة/الجزء الأول"),
    ("ymnos", "el", "Ύμνος εις την Ελευθερίαν", "Διονύσιος Σολωμός", "el", "Ύμνος εις την Ελευθερίαν"),
    ("atlantida", "ca", "L'Atlàntida, introducció", "Jacint Verdaguer", "ca", "L'Atlàntida/Introducció"),
]

# Queries written for this bench (CC0). They target the works above, so the bench can also
# compare rankings between engines, not only vector-by-vector cosines.
QUERIES = [
    ("es", "¿Quién es Dulcinea del Toboso?"),
    ("es", "caballero que confunde molinos de viento con gigantes"),
    ("es", "el escudero que acompaña al hidalgo y quiere gobernar una ínsula"),
    ("es", "libros de caballerías que secaron el cerebro de un hidalgo"),
    ("en", "a young woman's first impression of a proud wealthy gentleman"),
    ("en", "Mr. Bennet and his daughters' marriage prospects"),
    ("en", "variation of species under domestication"),
    ("en", "struggle for existence and natural selection"),
    ("en", "how geological record is imperfect"),
    ("fr", "un évêque qui accueille un ancien forçat"),
    ("fr", "il faut cultiver notre jardin"),
    ("fr", "le meilleur des mondes possibles selon Pangloss"),
    ("de", "ein Gelehrter schließt einen Pakt mit dem Teufel"),
    ("de", "ein Mann erwacht als Ungeziefer verwandelt"),
    ("it", "selva oscura nel mezzo del cammin di nostra vita"),
    ("it", "le anime dei dannati nell'inferno"),
    ("pt", "navegadores portugueses no caminho para a Índia"),
    ("pt", "ciúme de Bentinho por Capitu"),
    ("la", "Gallia est omnis divisa in partes tres"),
    ("la", "bellum cum Helvetiis"),
    ("zh", "賈寶玉與林黛玉的愛情"),
    ("zh", "大觀園中的詩社"),
    ("ja", "羅生門の下で雨やみを待つ下人"),
    ("nl", "koffieveiling en het koloniale bestuur op Java"),
    ("fi", "seitsemän veljestä metsässä"),
    ("eo", "lingvo internacia kaj ĝiaj reguloj"),
    ("ru", "бедный чиновник и его новая шинель"),
    ("ru", "молодой дворянин отправляется на службу"),
    ("ar", "شهرزاد تحكي الحكايات للملك شهريار"),
    ("el", "ύμνος στην ελευθερία και την επανάσταση"),
    ("ca", "l'Atlàntida enfonsada sota el mar"),
    ("es", "evolución de las especies por selección natural"),
    ("en", "a knight who attacks windmills"),
    ("fr", "Faust et Méphistophélès"),
    ("de", "Liebe und Eifersucht in einem brasilianischen Roman"),
    ("en", "the Gallic war of Julius Caesar"),
    ("it", "viaggio di Vasco da Gama"),
    ("en", "a poor clerk saves money to buy an overcoat"),
    ("es", "las mil y una noches"),
    ("en", "seven brothers leave home to live in the forest"),
]

DOC_PREFIX = "title: none | text: "
QUERY_PREFIX = "task: search result | query: "


def fetch(url: str, dest: Path, tries: int = 4) -> Path:
    if dest.exists() and dest.stat().st_size > 0:
        return dest
    dest.parent.mkdir(parents=True, exist_ok=True)
    for attempt in range(tries):
        try:
            req = urllib.request.Request(url, headers=UA)
            with urllib.request.urlopen(req, timeout=120) as r:
                data = r.read()
            dest.write_bytes(data)
            return dest
        except Exception as exc:  # noqa: BLE001
            if attempt == tries - 1:
                raise RuntimeError(f"{url}: {exc}") from exc
            time.sleep(2 + 3 * attempt)
    return dest


def get_json(url: str):
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=120) as r:
        return json.load(r)


def sha256_file(p: Path) -> str:
    h = hashlib.sha256()
    with p.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


# ---------------------------------------------------------------- texts

def gutenberg_body(raw: str) -> str:
    raw = raw.replace("\r\n", "\n")
    start = re.search(r"\*\*\* ?START OF (THE|THIS) PROJECT GUTENBERG[^\n]*\n", raw)
    end = re.search(r"\*\*\* ?END OF (THE|THIS) PROJECT GUTENBERG", raw)
    body = raw[start.end() if start else 0 : end.start() if end else len(raw)]
    return body


def paragraphs(body: str, cjk: bool) -> list[str]:
    paras = []
    blocks = re.split(r"\n\s*\n", body)
    if cjk:  # Japanese layout: one paragraph per line starting with an ideographic space
        blocks = [b for blk in blocks for b in re.split(r"\n(?=\u3000)", blk)]
    for block in blocks:
        lines = [ln.strip() for ln in block.split("\n") if ln.strip()]
        if not lines:
            continue
        text = ("" if cjk else " ").join(lines)
        text = re.sub(r"\s+", " ", text).strip()
        text = re.sub(r"[_*]", "", text)
        if cjk:
            if len(text) < 30:
                continue
        elif len(text.split()) < 12:
            continue
        if re.search(r"(?i)gutenberg|copyright|transcriber|e-?text|produced by|digitizer|encoded in", text):
            continue
        paras.append(unicodedata.normalize("NFC", text))
    return paras


def wikisource_paragraphs(lang: str, title: str, dest: Path) -> list[str]:
    if not dest.exists():
        q = urllib.parse.urlencode({"action": "parse", "page": title, "prop": "text", "format": "json", "redirects": 1})
        d = get_json(f"https://{lang}.wikisource.org/w/api.php?{q}")
        h = d["parse"]["text"]["*"]
        h = re.sub(r"(?s)<(script|style|sup|table)[^>]*>.*?</\1>", " ", h)
        paras = [html.unescape(re.sub(r"<[^>]+>", "", p)) for p in re.findall(r"(?s)<p[^>]*>(.*?)</p>", h)]
        if lang == "ar":  # this page is rendered as a few huge paragraphs; split on sentence ends
            paras = [s for p in paras for s in re.split(r"(?<=[.!؟])\s+", p)]
        text = "\n\n".join(re.sub(r"\s+", " ", p).strip() for p in paras if p.strip())
        if len(text) < 1000:  # poems are not in <p>: fall back to the plain-text extract, stanza by stanza
            q = urllib.parse.urlencode({"action": "query", "prop": "extracts", "explaintext": 1, "format": "json",
                                        "redirects": 1, "titles": title})
            pages = get_json(f"https://{lang}.wikisource.org/w/api.php?{q}")["query"]["pages"]
            extract = next(iter(pages.values())).get("extract") or ""
            text = "\n\n".join(re.sub(r"\s+", " ", b).strip() for b in re.split(r"\n\s*\n", extract)
                                 if b.strip() and not b.strip().startswith("=="))
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_text(text)
    out = []
    for p in dest.read_text().split("\n\n"):
        p = unicodedata.normalize("NFC", p.strip())
        if len(p.split()) >= 8:
            out.append(p)
    return out


def words(t: str) -> int:
    return len(t.split())


def make_items(key: str, lang: str, paras: list[str], rng: random.Random, n_short=4, n_medium=6, n_long=5):
    cjk = lang in ("zh", "ja")
    size = (lambda t: len(t)) if cjk else words
    short_max, med_lo, med_hi, long_lo, long_hi = (60, 80, 220, 350, 700) if cjk else (35, 50, 140, 180, 320)
    items = []
    idx = list(range(len(paras)))
    rng.shuffle(idx)
    # short: first sentence of a paragraph
    for i in idx:
        if sum(1 for it in items if it["length"] == "short") >= n_short:
            break
        sent = re.split(r"(?<=[.!?。！？;؟])\s*", paras[i])[0].strip()
        if 6 <= (len(sent) if cjk else words(sent)) <= short_max and len(sent) >= 15:
            items.append({"length": "short", "text": sent})
    # medium: one paragraph, or consecutive ones (verse stanzas) until the range is reached
    joiner = "" if cjk else " "
    for i in idx:
        if sum(1 for it in items if it["length"] == "medium") >= n_medium:
            break
        buf, j = [], i
        while j < len(paras) and size(joiner.join(buf)) < med_lo:
            buf.append(paras[j])
            j += 1
        text = joiner.join(buf)
        if med_lo <= size(text) <= med_hi:
            items.append({"length": "medium", "text": text})
    # long: consecutive paragraphs, cut at a word boundary
    tried = 0
    for i in idx:
        if sum(1 for it in items if it["length"] == "long") >= n_long or tried > 400:
            break
        tried += 1
        buf, j = [], i
        while j < len(paras) and size((" " if not cjk else "").join(buf)) < long_lo:
            buf.append(paras[j])
            j += 1
        text = ("" if cjk else " ").join(buf)
        if size(text) < long_lo:
            continue
        if size(text) > long_hi:
            text = text[:long_hi] if cjk else " ".join(text.split()[:long_hi])
        items.append({"length": "long", "text": text})
    seen, uniq = set(), []
    for it in items:
        if it["text"] not in seen:
            seen.add(it["text"])
            uniq.append(it)
    return uniq


def build_texts():
    rng = random.Random(20261007)
    out = []
    for key, lang, title, author, _, gid in GUTENBERG:
        p = fetch(f"https://www.gutenberg.org/cache/epub/{gid}/pg{gid}.txt", CACHE / "gutenberg" / f"pg{gid}.txt")
        paras = paragraphs(gutenberg_body(p.read_text(encoding="utf-8", errors="replace")), lang in ("zh", "ja"))
        for k, it in enumerate(make_items(key, lang, paras, rng)):
            out.append({"id": f"{key}-{k:02d}", "kind": "passage", "lang": lang, "length": it["length"],
                        "source": {"title": title, "author": author, "url": f"https://www.gutenberg.org/ebooks/{gid}",
                                   "rights": "public domain"},
                        "text": it["text"]})
    for key, lang, title, author, wiki, page in WIKISOURCE:
        paras = wikisource_paragraphs(wiki, page, CACHE / "wikisource" / f"{key}.txt")
        n = (3, 4, 3) if key in ("kapitan", "atlantida", "ymnos") else (4, 6, 5)
        for k, it in enumerate(make_items(key, lang, paras, rng, *n)):
            out.append({"id": f"{key}-{k:02d}", "kind": "passage", "lang": lang, "length": it["length"],
                        "source": {"title": title, "author": author,
                                   "url": f"https://{wiki}.wikisource.org/wiki/{urllib.parse.quote(page)}",
                                   "rights": "public domain"},
                        "text": it["text"]})
    for k, (lang, q) in enumerate(QUERIES):
        out.append({"id": f"q-{k:02d}", "kind": "query", "lang": lang, "length": "query",
                    "source": {"title": "SPDF bench queries", "author": "SPDF", "rights": "CC0-1.0"}, "text": q})
    dest = HERE / "texts.jsonl"
    with dest.open("w", encoding="utf-8") as f:
        for it in out:
            f.write(json.dumps(it, ensure_ascii=False) + "\n")
    by_lang = {}
    for it in out:
        by_lang[it["lang"]] = by_lang.get(it["lang"], 0) + 1
    print(f"texts: {len(out)} items ({sum(1 for i in out if i['kind']=='passage')} passages) -> {dest}")
    print("  by language:", by_lang)


# ---------------------------------------------------------------- images

AIC_TYPES = ["Painting", "Print", "Photograph", "Drawing and Watercolor", "Textile", "Sculpture", "Book", "Architectural Drawing"]
COMMONS_QUERIES = [
    "El ingenioso hidalgo don Quixote de la Mancha 1605 title page",
    "Gutenberg Bible page",
    "Philosophiae Naturalis Principia Mathematica title page 1687",
    "Darwin tree of life sketch 1837 notebook",
    "Vesalius De humani corporis fabrica muscle man",
    "Mercator 1569 world map",
    "Shakespeare First Folio title page",
    "Beethoven manuscript score",
    "Codex Gigas",
    "Book of Kells folio",
    "Encyclopédie Diderot planche",
    "Hokusai Great Wave off Kanagawa",
    "Nebra sky disc",
    "Leonardo da Vinci Vitruvian Man",
    "Rosetta Stone",
]


def commons_pick(query: str):
    q = urllib.parse.urlencode({"action": "query", "generator": "search", "gsrsearch": query, "gsrnamespace": 6,
                                "gsrlimit": 10, "prop": "imageinfo", "iiprop": "url|mime|size|extmetadata",
                                "iiurlwidth": 1024, "format": "json"})
    d = get_json(f"https://commons.wikimedia.org/w/api.php?{q}")
    pages = sorted(d.get("query", {}).get("pages", {}).values(), key=lambda p: p.get("index", 99))
    for p in pages:
        ii = (p.get("imageinfo") or [{}])[0]
        meta = ii.get("extmetadata", {})
        lic = meta.get("LicenseShortName", {}).get("value", "")
        if ii.get("mime") not in ("image/jpeg", "image/png", "image/tiff") or ii.get("width", 0) < 500:
            continue
        if not re.search(r"(?i)public domain|^PD|CC0", lic):
            continue
        return {"title": p["title"], "url": ii.get("thumburl") or ii["url"], "page": ii.get("descriptionurl"),
                "license": lic}
    return None


def build_images():
    out = []
    per_type = 5
    for t in AIC_TYPES:
        q = urllib.parse.urlencode({"query[bool][must][0][term][is_public_domain]": "true",
                                    "query[bool][must][1][match][artwork_type_title]": t,
                                    "fields": "id,title,image_id,artist_title,date_display,artwork_type_title",
                                    "limit": 20})
        d = get_json(f"https://api.artic.edu/api/v1/artworks/search?{q}")
        n = 0
        for a in d["data"]:
            if not a.get("image_id") or a.get("artwork_type_title") != t:
                continue
            out.append({"id": f"aic-{a['id']}", "kind": t.lower(), "title": a["title"], "author": a.get("artist_title"),
                        "date": a.get("date_display"),
                        "url": f"https://www.artic.edu/iiif/2/{a['image_id']}/full/843,/0/default.jpg",
                        "page": f"https://www.artic.edu/artworks/{a['id']}", "license": "CC0-1.0 (public domain)"})
            n += 1
            if n >= per_type:
                break
        time.sleep(0.5)
    for q in COMMONS_QUERIES:
        pick = commons_pick(q)
        if pick:
            out.append({"id": "commons-" + hashlib.sha1(pick["title"].encode()).hexdigest()[:10], "kind": "document",
                        "title": pick["title"].removeprefix("File:"), "author": None, "date": None,
                        "url": pick["url"], "page": pick["page"], "license": pick["license"]})
        time.sleep(0.5)
    good = []
    for it in out:
        ext = ".png" if it["url"].lower().endswith(".png") else ".jpg"
        dest = CACHE / "images" / (it["id"] + ext)
        try:
            fetch(it["url"], dest)
        except RuntimeError as exc:
            print("  skip", it["id"], exc)
            continue
        it["file"] = dest.name
        it["sha256"] = sha256_file(dest)
        it["bytes"] = dest.stat().st_size
        good.append(it)
    (HERE / "images.json").write_text(json.dumps(good, ensure_ascii=False, indent=1) + "\n")
    print(f"images: {len(good)} -> {HERE / 'images.json'}")


# ---------------------------------------------------------------- audio

LIBRIVOX = [("spa", 2), ("eng", 3), ("fre", 2), ("ita", 2), ("por", 2), ("ger", 1)]


def build_audio():
    out = []
    for lang, n_items in LIBRIVOX:
        q = urllib.parse.urlencode({"q": f"collection:librivoxaudio AND language:{lang}", "fl[]": "identifier",
                                    "rows": n_items + 3, "output": "json", "sort[]": "downloads desc"})
        docs = get_json(f"https://archive.org/advancedsearch.php?{q}")["response"]["docs"]
        taken = 0
        for doc in docs:
            if taken >= n_items:
                break
            ident = doc["identifier"]
            meta = get_json(f"https://archive.org/metadata/{ident}")
            md = meta.get("metadata", {})
            lic = md.get("licenseurl", "")
            if "publicdomain" not in lic:
                continue
            mp3s = sorted(f["name"] for f in meta.get("files", []) if f["name"].endswith("_64kb.mp3"))
            if not mp3s:
                continue
            name = mp3s[min(1, len(mp3s) - 1)]
            src = CACHE / "audio" / "src" / ident / name
            fetch(f"https://archive.org/download/{ident}/{urllib.parse.quote(name)}", src)
            dur = float(subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of",
                                        "default=nw=1:nk=1", str(src)], capture_output=True, text=True).stdout or 0)
            if dur < 40:
                continue
            offsets = (round(min(40.0, dur * 0.3), 1), round(min(100.0, dur - 15.0, max(dur * 0.6, 55.0)), 1))
            for k, offset in enumerate(offsets):
                clip = CACHE / "audio" / f"{ident}-{k}.wav"
                if not clip.exists():
                    subprocess.run(["ffmpeg", "-nostdin", "-loglevel", "error", "-y", "-ss", str(offset), "-t", "10",
                                    "-i", str(src), "-ac", "1", "-ar", "16000", "-sample_fmt", "s16", str(clip)], check=True)
                out.append({"id": f"{ident}-{k}", "lang": lang, "title": md.get("title"),
                            "url": f"https://archive.org/download/{ident}/{name}", "page": f"https://archive.org/details/{ident}",
                            "license": lic, "offset_s": offset, "duration_s": 10.0, "file": clip.name,
                            "sha256": sha256_file(clip)})
            taken += 1
    (HERE / "audio.json").write_text(json.dumps(out, ensure_ascii=False, indent=1) + "\n")
    print(f"audio: {len(out)} clips -> {HERE / 'audio.json'}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--texts", action="store_true")
    ap.add_argument("--images", action="store_true")
    ap.add_argument("--audio", action="store_true")
    a = ap.parse_args()
    every = not (a.texts or a.images or a.audio)
    if a.texts or every:
        build_texts()
    if a.images or every:
        build_images()
    if a.audio or every:
        build_audio()


if __name__ == "__main__":
    sys.exit(main())
