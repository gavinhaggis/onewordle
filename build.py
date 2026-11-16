#!/usr/bin/env python3
"""Onewordle puzzle builder.

Turns word lists into scored puzzle packs:

  1. Normalise  sources -> V (valid words), c(w) (Zipf commonness), A (answers), P (guesses)
  2. Feedback   M[g, w] = F(g, w) for g in P, w in V, patterns as base-3 ints 0..242
  3. Bucket     B(g, p) = {w in V : M[g, w] = p}
  4. One-row    (g, a) with a in A, |B(g, p)| = 1      -> "intended" pool
  5. Two-row    (g1, g2, a), neither row unique alone, together unique -> "easy" pool
  6. Score      U (greys-ignored candidates), C (rarity), X (invented letters),
                Y (moved letters), N (weighted near misses) -> percentile ranks -> D -> band
  7. Emit       game/puzzles.js and game/words.js (JS files so the game runs from file://)

Run:  .venv/bin/python build.py
"""
import json
import random
from collections import Counter
from pathlib import Path

import numpy as np
from wordfreq import zipf_frequency

ROOT = Path(__file__).parent
DATA = ROOT / "data"
OUT = ROOT / "docs"  # served by GitHub Pages

CONFIG = {
    "tau_answer": 3.0,      # Zipf floor for answers
    "tau_guess": 3.0,       # Zipf floor for the shown wrong guess(es)
    "min_revealed": 1,      # reject patterns with fewer green+yellow tiles than this
    "max_row_greens": 3,    # no clue row may show 4 greens (too close to a giveaway)
    "one_greens": (1, 2),   # one-row shape window: the sweet spot from playtesting
    "one_yellows": (1, 2),
    "weights": {"U": 0.30, "C": 0.20, "X": 0.25, "Y": 0.10, "N": 0.15},
    "bands": ["gentle", "medium", "tricky", "fiendish"],
    "per_band": 1500,       # puzzles kept per band per mode
    "easy_tries_per_answer": 40,
    "easy_bucket_max": 40,  # first-row candidate set size cap for easy puzzles
    "seed": 7,
    "launch": "2026-11-16",            # daily puzzle #1 (each phone's local date)
    "daily_bands": ["gentle", "medium", "tricky"],
    "daily_days": 1100,                # about three years of puzzles
    "daily_no_repeat_days": 365,       # an answer won't come back within this many days
}

DAILY_KEY = "onewordle"  # light obfuscation so answers aren't readable at a glance in the page source

GREY, YELLOW, GREEN = 0, 1, 2
ALL_GREEN = 242
POW = np.array([81, 27, 9, 3, 1])  # digit i (left to right) * 3^(4-i)


# ---------------------------------------------------------------- 1 normalise
def load_words():
    raw = set()
    for f in sorted(DATA.glob("*.txt")):
        for line in f.read_text().split():
            w = line.strip().lower()
            if len(w) == 5 and w.isascii() and w.isalpha():
                raw.add(w)
    V = sorted(raw)
    c = {w: zipf_frequency(w, "en") for w in V}
    names = proper_names()
    blocked = set()  # hand blocklist + LDNOOBW NSFW list; blocked words stay valid rivals but never appear
    for f in ("blocklist.list", "nsfw-ldnoobw.list"):
        if (DATA / f).exists():
            blocked |= {w.strip().lower() for w in (DATA / f).read_text().splitlines()}
    A = [w for w in V if c[w] >= CONFIG["tau_answer"] and w not in names and w not in blocked]
    P = [w for w in V if c[w] >= CONFIG["tau_guess"] and w not in names and w not in blocked]
    return V, c, A, P


def proper_names():
    """Words that are first names, or appear in Webster's web2 only with a capital letter.
    They stay valid as rivals (V) but are never shown as answers or guesses."""
    names = {w.lower() for w in (DATA / "propernames.list").read_text().split()}
    lower, upper = set(), set()
    for w in (DATA / "web2.list").read_text().split():
        (upper if w[0].isupper() else lower).add(w.lower())
    return names | (upper - lower)


def encode(words):
    return np.array([[ord(ch) - 97 for ch in w] for w in words], dtype=np.int8)


# ---------------------------------------------------------------- 2 feedback
def feedback_row(g, Vcodes, Vcounts):
    """Patterns of guess g (5 letter codes) against every word in V. Two-pass, duplicate-safe."""
    n = len(Vcodes)
    digits = np.zeros((n, 5), dtype=np.int8)
    counts = Vcounts.copy()
    green = Vcodes == g[None, :]
    digits[green] = GREEN
    for i in range(5):  # remove greens from the pool of unmatched letters
        counts[green[:, i], g[i]] -= 1
    for i in range(5):  # yellows, left to right
        L = g[i]
        can = (~green[:, i]) & (counts[:, L] > 0)
        digits[can, i] = YELLOW
        counts[can, L] -= 1
    return (digits.astype(np.int16) * POW).sum(1).astype(np.uint8)


def feedback(g_word, a_word):
    g = encode([g_word])[0]
    a = encode([a_word])
    counts = np.zeros((1, 26), dtype=np.int8)
    for ch in a[0]:
        counts[0, ch] += 1
    return int(feedback_row(g, a, counts)[0])


DIGITS = np.array([[(p // 3 ** (4 - i)) % 3 for i in range(5)] for p in range(243)], dtype=np.int8)
PAT_STR = ["".join(map(str, d)) for d in DIGITS]
HAMMING = (DIGITS[:, None, :] != DIGITS[None, :, :]).sum(2)  # [p, q]

# position part of "q is consistent with the greens and yellows of p"
_pos_ok = np.ones((243, 243), dtype=bool)
for i in range(5):
    pg = DIGITS[:, i][:, None] == GREEN
    py = DIGITS[:, i][:, None] == YELLOW
    qg = DIGITS[:, i][None, :] == GREEN
    _pos_ok &= ~pg | qg      # a green must stay green
    _pos_ok &= ~py | ~qg     # a yellow letter is not at that position
_compat_cache = {}


def gy_compat(g_word):
    """compat[p, q]: a word showing q also satisfies every green/yellow clue of p.
    Letter-count part: for each distinct letter of g, non-grey count in q >= in p."""
    struct = tuple(g_word.index(ch) for ch in g_word)
    if struct not in _compat_cache:
        groups = sorted(set(struct))
        K = np.stack([(DIGITS[:, [i for i in range(5) if struct[i] == gr]] > 0).sum(1) for gr in groups], 1)
        cnt_ok = (K[None, :, :] >= K[:, None, :]).all(2)
        _compat_cache[struct] = _pos_ok & cnt_ok
    return _compat_cache[struct]


def ambiguous(g_word, p):
    """A letter is grey in one place and green/yellow in another: grey then means 'no more of it'."""
    d = DIGITS[p]
    seen, grey = set(), set()
    for ch, x in zip(g_word, d):
        (grey if x == GREY else seen).add(ch)
    return bool(seen & grey)


def greens(p):
    return int((DIGITS[p] == GREEN).sum())


def shape(answer, rows):
    """(G, Y, X): fixed letters, letters to move, letters to invent. Rows = [(guess, pattern)]."""
    greens = set()
    revealed = Counter()
    for g, p in rows:
        d = DIGITS[p]
        greens |= {i for i in range(5) if d[i] == GREEN}
        here = Counter(ch for ch, x in zip(g, d) if x > 0)
        for ch, k in here.items():
            revealed[ch] = max(revealed[ch], k)
    known = sum(min(k, revealed[ch]) for ch, k in Counter(answer).items())
    G = len(greens)
    return G, known - G, 5 - known


def rarity_weight(z):
    return float(np.clip((z - 1.0) / 5.0, 0, 1))  # how likely a player is to know a rival word


# ---------------------------------------------------------------- 6 scoring
def pct_rank(x):
    x = np.asarray(x, dtype=float)
    order = x.argsort(kind="stable")
    r = np.empty(len(x))
    r[order] = np.arange(len(x))
    # ties share the mean rank
    _, inv, cnt = np.unique(x, return_inverse=True, return_counts=True)
    sums = np.bincount(inv, weights=r)
    r = sums[inv] / cnt[inv]
    return r / max(len(x) - 1, 1)


def score(puzzles):
    w = CONFIG["weights"]
    f = lambda k: [p["features"][k] for p in puzzles]
    U = pct_rank(np.log2(f("n_gy")))
    C = pct_rank([-z for z in f("c_answer")])
    X = pct_rank(f("X"))
    Y = pct_rank(f("Y"))
    N = pct_rank(f("near_w"))
    D = w["U"] * U + w["C"] * C + w["X"] * X + w["Y"] * Y + w["N"] * N
    qs = np.quantile(D, [0.25, 0.5, 0.75])
    for p, d in zip(puzzles, D):
        p["D"] = round(float(d), 3)
        p["band"] = CONFIG["bands"][int(np.searchsorted(qs, d, side="right"))]


def pick(puzzles, rng):
    """Keep up to per_band puzzles per band, at most one per answer per band."""
    out = []
    for band in CONFIG["bands"]:
        pool = [p for p in puzzles if p["band"] == band]
        rng.shuffle(pool)
        seen = set()
        for p in pool:
            if p["answer"] in seen:
                continue
            seen.add(p["answer"])
            out.append(p)
            if len(seen) >= CONFIG["per_band"]:
                break
    return out


# ---------------------------------------------------------------- daily schedule
def write_schedule(one):
    """Fixed puzzles for every day from launch: one per band in daily_bands, same for everyone.
    Answers don't repeat within daily_no_repeat_days (falls back to least recently used)."""
    rng = random.Random(f"{CONFIG['seed']}-daily")
    pools = {}
    for band in CONFIG["daily_bands"]:
        pool = [p for p in one if p["band"] == band]
        rng.shuffle(pool)
        pools[band] = pool
    last_used = {}   # answer -> day
    clue_used = {}
    days, repeats = [], 0
    window = CONFIG["daily_no_repeat_days"]
    for d in range(CONFIG["daily_days"]):
        today, words = [], set()
        for band in CONFIG["daily_bands"]:
            pool = pools[band]
            best, best_i = None, None
            for i, p in enumerate(pool):
                a, g = p["answer"], p["rows"][0][0]
                if a in words or g in words:
                    continue
                age = d - last_used.get(a, -10**6)
                if age > window and d - clue_used.get(g, -10**6) > 30:
                    best, best_i = p, i
                    break
                if best is None or age > d - last_used.get(best["answer"], -10**6):
                    best, best_i = p, i
            if d - last_used.get(best["answer"], -10**6) <= window:
                repeats += 1
            pool.append(pool.pop(best_i))  # rotate so later days look further down the list
            last_used[best["answer"]] = d
            clue_used[best["rows"][0][0]] = d
            words |= {best["answer"], best["rows"][0][0]}
            today.append(best)
        days.append(today)

    def enc(s):
        k = DAILY_KEY
        return "".join(chr(97 + (ord(ch) - 97 + ord(k[i % len(k)])) % 26) if ch.isalpha() else ch
                       for i, ch in enumerate(s))

    packed = [[enc(p["rows"][0][0] + p["rows"][0][1] + p["answer"]) + "|" + p["band"][0] + "|" +
               f"{p['features']['G']}{p['features']['Y']}{p['features']['X']}|{p['features']['n_gy']}"
               for p in day] for day in days]
    (OUT / "schedule.js").write_text(
        "window.ONEWORDLE_DAILY = " + json.dumps({"launch": CONFIG["launch"], "key": DAILY_KEY, "days": packed},
                                                 separators=(",", ":")) + ";\n")
    print(f"daily: {len(days)} days x {len(CONFIG['daily_bands'])}, repeats inside window: {repeats}")
    return days


# ---------------------------------------------------------------- report
def write_report(L):
    """Funnel counts, a worked example and the word list, inlined into report/index.html."""
    V, c, A, P, M, one, easy = L["V"], L["c"], L["A"], L["P"], L["M"], L["one"], L["easy"]
    vidx, stats = L["vidx"], L["stats"]
    raw_lines = sum(1 for f in sorted(DATA.glob("*.txt")) for _ in f.read_text().split())
    names = proper_names()
    blocked = set()
    for f in ("blocklist.list", "nsfw-ldnoobw.list"):
        if (DATA / f).exists():
            blocked |= {w.strip().lower() for w in (DATA / f).read_text().splitlines()}
    common = [w for w in V if c[w] >= CONFIG["tau_answer"]]
    n_names = sum(w in names for w in common)
    n_blocked = sum(w in blocked and w not in names for w in common)

    as_answer = Counter(p["answer"] for p in one)
    as_clue = Counter(p["rows"][0][0] for p in one)
    Aset = set(A)
    words = []
    for w in V:
        if w in blocked:
            flag, shown = "b", ""
        elif w in names:
            flag, shown = "n", w
        elif w in Aset:
            flag, shown = "a", w
        else:
            flag, shown = "v", w
        words.append([shown, round(c[w], 2), flag, as_answer.get(w, 0), as_clue.get(w, 0)])

    # worked example: a tricky one-row puzzle where the greys do real work
    ex = next(p for p in sorted(one, key=lambda p: -p["features"]["c_answer"])
              if p["band"] == "tricky" and 3 <= p["features"]["n_gy"] <= 6 and p["features"]["X"] == 2
              and c[p["rows"][0][0]] >= 4)
    g, pat = ex["rows"][0]
    gi, p = P.index(g), int(pat, 3)
    row = M[gi]
    hist = np.bincount(row, minlength=243)
    compat = gy_compat(g)[p]
    rivals = [[V[j], PAT_STR[row[j]], round(c[V[j]], 2)] for j in np.flatnonzero(compat[row]) if V[j] != ex["answer"]]
    near = [j for j in np.flatnonzero(HAMMING[p][row] == 1) if V[j] not in blocked]
    near = sorted(near, key=lambda j: -c[V[j]])[:8]
    sizes = hist[hist > 0]
    ans_hist = np.bincount(row[[vidx[a] for a in A]], minlength=243)
    example = {
        "guess": g, "pattern": pat, "pattern_int": p, "answer": ex["answer"], "features": ex["features"],
        "D": ex["D"], "band": ex["band"], "bucket": int(hist[p]),
        "patterns_used": int((hist > 0).sum()), "singleton_patterns": int((hist == 1).sum()),
        "singleton_answers": int(((hist == 1) & (ans_hist == 1)).sum()),
        "largest_bucket": [PAT_STR[int(hist.argmax())], int(hist.max())],
        "size_hist": {int(k): int(v) for k, v in zip(*np.unique(np.minimum(sizes, 51), return_counts=True))},
        "rivals": rivals,
        "near": [[V[j], PAT_STR[row[j]], round(c[V[j]], 2)] for j in near],
    }
    bs = L["bucket_sizes"]
    report = {
        "config": {k: v for k, v in CONFIG.items()},
        "funnel": {
            "raw": raw_lines, "five": len(V), "common": len(common), "names": n_names, "blocked": n_blocked,
            "A": len(A), "P": len(P), "pairs": stats["pairs"], "unique": stats["unique"],
            "ambiguous": stats["rej_ambiguous"], "no_clues": stats["rej_no_clues"], "shape": stats["rej_shape"],
            "one": len(one), "one_game": len(L["one_k"]), "easy": len(easy), "easy_game": len(L["easy_k"]),
            "easy_tried": L["easy_stats"]["first_rows_tried"], "easy_usable": L["easy_stats"]["first_rows_usable"],
            "answers_with_puzzle": len(as_answer),
        },
        "bucket_sizes": {str(k): int(v) for k, v in sorted(bs.items())},
        "shape_unique": [[g_, y_, n] for (g_, y_), n in sorted(L["shape_unique"].items())],
        "bands": {m: Counter(p["band"] for p in pool) for m, pool in (("one", one), ("easy", easy))},
        "example": example,
        "words": words,
        "puzzles": {
            m: [[p["answer"], [r[0] + r[1] for r in p["rows"]], p["band"], p["D"],
                 p["features"]["G"], p["features"]["Y"], p["features"]["X"], p["features"]["n_gy"]]
                for p in pool]
            for m, pool in (("one", L["one_k"]), ("easy", L["easy_k"]))
        },
    }
    tpl = ROOT / "report" / "template.html"
    if tpl.exists():
        html = tpl.read_text().replace("/*REPORT*/null", json.dumps(report, separators=(",", ":"), default=lambda o: o.item()))
        (ROOT / "report" / "index.html").write_text(html)
    print("report: example", g, pat, "->", ex["answer"], "rivals", len(rivals))


# ---------------------------------------------------------------- main
def main():
    rng = random.Random(CONFIG["seed"])
    V, c, A, P = load_words()
    vidx = {w: i for i, w in enumerate(V)}
    Aset = set(A)
    print(f"V={len(V)} valid, A={len(A)} answers, P={len(P)} guesses")

    Vcodes = encode(V)
    Vcounts = np.zeros((len(V), 26), dtype=np.int8)
    for j in range(5):
        np.add.at(Vcounts, (np.arange(len(V)), Vcodes[:, j]), 1)
    Pcodes = encode(P)
    weight = np.array([rarity_weight(c[w]) for w in V])
    a_cols = np.array([vidx[a] for a in A])

    # 2 feedback matrix
    M = np.stack([feedback_row(g, Vcodes, Vcounts) for g in Pcodes])  # [|P|, |V|]
    print(f"feedback matrix {M.shape}, {M.nbytes / 1e6:.0f} MB")

    # 3-4 one-row puzzles
    one = []
    stats = Counter()
    bucket_sizes = Counter()   # for every (guess, answer) pair: how many words share its pattern
    shape_unique = Counter()   # (G, Y) of every unique, unambiguous pair, before the shape window
    for gi, g in enumerate(P):
        row = M[gi]
        hist = np.bincount(row, minlength=243)
        whist = np.bincount(row, weights=weight, minlength=243)
        compat = gy_compat(g)
        n_gy = compat @ hist                       # per p: words matching greens+yellows only
        near1 = HAMMING == 1
        n_near = near1 @ hist
        near_w = near1 @ whist
        bucket_sizes.update(np.minimum(hist[row[a_cols]], 999).tolist())
        for aj in a_cols:
            p = int(row[aj])
            stats["pairs"] += 1
            if p == ALL_GREEN or hist[p] != 1:
                continue
            stats["unique"] += 1
            a = V[aj]
            if ambiguous(g, p):
                stats["rej_ambiguous"] += 1
                continue
            G, Y, X = shape(a, [(g, p)])
            if G + Y < CONFIG["min_revealed"]:
                stats["rej_no_clues"] += 1
                continue
            shape_unique[(G, Y)] += 1
            lo, hi = CONFIG["one_greens"]
            ylo, yhi = CONFIG["one_yellows"]
            if not (lo <= G <= hi and ylo <= Y <= yhi):
                stats["rej_shape"] += 1
                continue
            one.append({
                "answer": a, "rows": [[g, PAT_STR[p]]],
                "features": {"G": G, "Y": Y, "X": X, "n_gy": int(n_gy[p]), "n_near": int(n_near[p]),
                             "near_w": round(float(near_w[p]), 2), "c_answer": c[a], "c_guess": c[g]},
            })
    print("one-row:", dict(stats), "kept", len(one))
    score(one)

    # 5 two-row easy pool: neither row is unique alone, both together are
    easy = []
    easy_stats = Counter()
    P_ok = np.arange(len(P))
    for aj in a_cols:
        a = V[aj]
        col = M[:, aj]
        for _ in range(CONFIG["easy_tries_per_answer"]):
            g1 = int(rng.choice(P_ok))
            p1 = int(col[g1])
            if greens(p1) > CONFIG["max_row_greens"] or ambiguous(P[g1], p1):
                continue
            S1 = np.flatnonzero(M[g1] == p1)
            easy_stats["first_rows_tried"] += 1
            if not (2 <= len(S1) <= CONFIG["easy_bucket_max"]):
                continue
            easy_stats["first_rows_usable"] += 1
            # for every g2: how many words in S1 share a's pattern under g2
            same = (M[:, S1] == col[:, None]).sum(1)
            cands_list = list(np.flatnonzero(same == 1))
            rng.shuffle(cands_list)
            found = None
            for g2 in cands_list[:30]:
                p2 = int(col[g2])
                if g2 == g1 or greens(p2) > CONFIG["max_row_greens"] or ambiguous(P[g2], p2):
                    continue
                if (M[g2] == p2).sum() == 1:   # row 2 alone would already be unique
                    continue
                found = (g2, p2)
                break
            if not found:
                continue
            g2, p2 = found
            rows = [(P[g1], p1), (P[g2], p2)]
            G, Y, X = shape(a, rows)
            # greys-ignored candidates across both rows
            m = gy_compat(P[g1])[p1][M[g1]] & gy_compat(P[g2])[p2][M[g2]]
            near = HAMMING[p1][M[g1]] + HAMMING[p2][M[g2]] == 1
            easy.append({
                "answer": a, "rows": [[P[g1], PAT_STR[p1]], [P[g2], PAT_STR[p2]]],
                "features": {"G": G, "Y": Y, "X": X, "n_gy": int(m.sum()), "n_near": int(near.sum()),
                             "near_w": round(float(weight[near].sum()), 2), "c_answer": c[a],
                             "c_guess": min(c[P[g1]], c[P[g2]])},
            })
            break
    print("two-row easy pool:", len(easy))
    score(easy)

    one_k, easy_k = pick(one, rng), pick(easy, rng)
    OUT.mkdir(exist_ok=True)
    meta = {"config": CONFIG, "V": len(V), "A": len(A), "P": len(P),
            "one_total": len(one), "easy_total": len(easy)}
    (OUT / "puzzles.js").write_text(
        "window.ONEWORDLE = " + json.dumps({"meta": meta, "one": one_k, "easy": easy_k}, separators=(",", ":")) + ";\n")
    (OUT / "words.js").write_text("window.ONEWORDLE_WORDS = " + json.dumps(" ".join(V)) + ";\n")

    write_schedule(one)
    write_report(locals())

    # console summary
    for name, pool in (("one-row", one), ("easy", easy)):
        print(f"\n{name}: {len(pool)} puzzles")
        shapes = Counter((p["features"]["G"], p["features"]["Y"], p["features"]["X"]) for p in pool)
        print("  top shapes (G,Y,X):", shapes.most_common(8))
        ngy = np.array([p["features"]["n_gy"] for p in pool])
        print("  n_gy: =1 %.1f%%, 2-8 %.1f%%, >8 %.1f%%" % (
            100 * (ngy == 1).mean(), 100 * ((ngy >= 2) & (ngy <= 8)).mean(), 100 * (ngy > 8).mean()))
        for band in CONFIG["bands"]:
            ex = next(p for p in pool if p["band"] == band)
            print(f"  {band:9s} e.g. {' / '.join(r[0] + ' ' + r[1] for r in ex['rows'])} -> {ex['answer']}  {ex['features']}")


if __name__ == "__main__":
    # self-check the feedback function on duplicate-letter cases
    assert PAT_STR[feedback("speed", "abide")] == "00101"
    assert PAT_STR[feedback("eerie", "abide")] == "00012"
    assert PAT_STR[feedback("eerie", "theme")] == "10002"
    assert PAT_STR[feedback("crane", "crane")] == "22222"
    main()
