"""Folios on synthetic books (the cases of Scholaris @scholaris/folios, ported)."""
import random

from spdf_build.steps.folios import candidates_in_line, deduce_folios, int_to_roman, link, Candidate

TEXT = "la de que el en y a los se del las un por con no una su para es al lo como más pero sus le ya o este " * 3


def book(romans=6, body=60, seed=1, read=0.6, ocr_errors=0.0, plates_after=(), cover=1, where="footer", upper=False):
    rnd = random.Random(seed)
    pages, truth = [], []
    phys = 0
    for _ in range(cover):
        phys += 1
        pages.append({"physical": phys, "text": "TITLE PAGE"})
        truth.append(None)
    for i in range(1, romans + 1):
        phys += 1
        f = int_to_roman(i, upper)
        p = {"physical": phys, "text": TEXT}
        if i == romans // 2 + 1 or (i > 1 and rnd.random() < read):  # at least one roman is seen
            p[where] = f
        pages.append(p)
        truth.append(f)
    for i in range(1, body + 1):
        phys += 1
        f = str(i)
        p = {"physical": phys, "text": TEXT + (f" nota {rnd.randint(1, 9)}" if rnd.random() < 0.2 else "")}
        if rnd.random() < read:
            seen = f
            if rnd.random() < ocr_errors:
                seen = f.replace("1", "l") if "1" in f else str(int(f) + 10)
            p[where] = seen
        pages.append(p)
        truth.append(f)
        if i in plates_after:
            phys += 1
            pages.append({"physical": phys, "text": "", "figures": [1]})
            truth.append(None)
    return pages, truth


def accuracy(pages, truth, **kw):
    r = deduce_folios(pages, **kw)
    got = [p.printed for p in r.pages]
    return sum(1 for a, b in zip(got, truth) if a == b) / len(truth), r


def test_romans_then_arabic():
    for seed in range(10):
        acc, r = accuracy(*book(seed=seed))
        assert acc >= 0.95, (seed, acc)
    assert r.transition is not None


def test_few_readings():
    acc, _ = accuracy(*book(read=0.1, seed=3))
    assert acc >= 0.9


def test_plates_are_unnumbered():
    pages, truth = book(plates_after=(10, 30), read=0.8, seed=4)
    acc, r = accuracy(pages, truth)
    assert acc >= 0.95
    assert sum(1 for p in r.pages if p.page_type == "plate") >= 1


def test_ocr_errors_and_footnotes_do_not_break_the_chain():
    acc, _ = accuracy(*book(ocr_errors=0.15, seed=5, read=0.7))
    assert acc >= 0.93


def test_running_head_numbers():
    pages, truth = book(where="header", seed=6)
    for p in pages:
        if p.get("header"):
            p["header"] = f"{p['header']} THE ORIGIN OF SPECIES"
    acc, _ = accuracy(pages, truth)
    assert acc >= 0.95


def test_upper_romans_stay_upper():
    _, r = accuracy(*book(upper=True, seed=7, read=0.9))
    assert any(p.printed == "IV" for p in r.pages)


def test_unread_preliminaries_get_no_folio():
    pages, truth = book(romans=4, seed=2, read=0.9)
    for p in pages[1:5]:
        p.pop("footer", None)  # no roman is seen
    r = deduce_folios(pages)
    assert [p.printed for p in r.pages[1:5]] == [None] * 4
    assert r.pages[5].printed == "1"


def test_no_reading_invents_nothing():
    pages = [{"physical": i, "text": TEXT} for i in range(1, 20)]
    r = deduce_folios(pages)
    assert r.strategy == "none" and all(p.printed is None for p in r.pages)


def test_single_weak_reading_is_not_used():
    pages = [{"physical": i, "text": TEXT} for i in range(1, 20)]
    pages[5]["text"] = TEXT + "\n7"  # a lone number at the end of the body: weak
    r = deduce_folios(pages)
    assert all(p.printed is None for p in r.pages)


def test_foliation_recto_only():
    pages = []
    for k in range(1, 30):
        pages.append({"physical": 2 * k - 1, "text": TEXT, "header": f"Fol. {k}"})
        pages.append({"physical": 2 * k, "text": TEXT})
    r = deduce_folios(pages)
    assert r.foliation
    assert [p.printed for p in r.pages[:4]] == ["1r", "1v", "2r", "2v"]


def test_labels_unconfirmed_run_is_dropped():
    pages = [{"physical": i, "text": TEXT, "label": lab} for i, lab in enumerate(["I", "I", "II"], start=1)]
    pages += [{"physical": 3 + k, "text": TEXT, "footer": str(k), "label": str(k)} for k in range(1, 20)]
    r = deduce_folios(pages)
    assert r.origin == "labels"
    assert [p.printed for p in r.pages[:4]] == [None, None, None, "1"]


def test_links():
    a = Candidate(10, False, False, "10", "footer", 0.9, False)
    assert link(a, Candidate(12, False, False, "12", "footer", 0.9, False), 2, 1) == 1.0
    assert link(a, Candidate(11, False, False, "11", "footer", 0.9, False), 2, 1) < 0  # a plate between
    assert link(Candidate(5, True, False, "v", "footer", 0.9, False), Candidate(1, False, False, "1", "footer", 0.9, False), 2, 1) > 0


def test_candidates():
    assert [c.value for c in candidates_in_line("— 23 —", "footer")] == [23]
    assert [c.value for c in candidates_in_line("Pag. 1.", "header")] == [1]
    assert not [c for c in candidates_in_line("Capítulo IV", "header") if c.value == 4]
    assert candidates_in_line("l23", "footer")[0].value == 123
