# Onewordle

You're shown a wrong five-letter guess with its green, yellow and grey tiles. Exactly one word fits. Find it, fast.

**Play:** https://gavinhaggis.github.io/onewordle/

## Daily game (`docs/index.html`)

- Three puzzles a day (gentle, medium, tricky), all on one clock. The clock starts when you press Start.
- A wrong answer adds 15 s, and its colours go on the board. Giving up on a puzzle adds 60 s.
- One go per day per phone. The day rolls over at each phone's local midnight. Puzzle #1 was 2026-11-16.
- Share copies the clue colours and your times (never the answers) for the family chat.
- Progress and stats live in the phone's `localStorage`. Reloading doesn't reset the clock.

`docs/practice.html` is the earlier 10-round game, with one-row and two-row modes, and isn't timed.

## Files

| Path | What |
|---|---|
| `build.py` | Builds every puzzle file below |
| `docs/` | The site GitHub Pages serves |
| `docs/schedule.js` | Three puzzles per day for about 3 years, lightly scrambled so answers aren't readable at a glance |
| `docs/puzzles.js`, `docs/words.js` | The practice puzzle packs, and the list of words the game accepts |
| `report/template.html` | Pipeline explainer. `build.py` writes `report/index.html` from it (that file isn't committed) |

## Rebuild the puzzles

```bash
python3 -m venv .venv && .venv/bin/pip install wordfreq numpy   # once
.venv/bin/python build.py
```

`build.py` writes the `docs/*.js` files. The settings (commonness floors, score weights, pool sizes) are in `CONFIG` at the top of the file.

## Data

| File | Role |
|---|---|
| `data/enable1.txt` | ENABLE word list (public domain). Every 5-letter word in it is valid, and is a rival when checking that only one word fits |
| `wordfreq` (pip) | Zipf commonness `c(w)` for every word |
| `data/propernames.list`, `data/web2.list` | macOS dictionaries, used to keep names (ERICA) out of answers and guesses |
| `data/blocklist.list` | Words to keep out by hand |
| `data/nsfw-ldnoobw.list` | LDNOOBW list of NSFW words (CC-BY 4.0). Blocked words are still valid rivals, but are never answers or clues |

Any extra `data/*.txt` list is added to the valid words.

## How a puzzle is made

1. **V** is every valid word. **A** (answers) and **P** (shown guesses) are the words in V with Zipf ≥ 3.0 that aren't names. That gives about 2.6k words, plurals included.
2. `M[g, w]` is the colour pattern of guess g against word w, worked out greens first and then yellows left to right, so repeated letters come out right. Patterns are stored as base-3 numbers from 0 to 242.
3. A one-row puzzle is any pair (g, a) where `a ∈ A` and no other word in V shows the same pattern for g.
4. A two-row puzzle uses two guesses where each row alone fits 2 or more words, but only `a` fits both.
5. Rejected:
   - a letter that is grey in one place and green or yellow in another, since grey then means "no more of this letter"
   - any clue row with 4 greens
   - one-row puzzles outside 1–2 greens and 1–2 yellows (`one_greens` / `one_yellows` in `CONFIG`), the shape playtesting found works best
6. Difficulty is `D = .30·U + .20·C + .25·X + .10·Y + .15·N`, where each term is converted to its percentile rank:
   - `U = log2(n_gy)`: the number of words that fit the greens and yellows alone, ignoring greys
   - `C`: how rare the answer is
   - `X`: letters the player has to invent, because no tile shows them
   - `Y`: letters the player has to move
   - `N`: near misses (words one tile off), weighted by how common they are

   The four bands (gentle / medium / tricky / fiendish) are the quartiles of D.
