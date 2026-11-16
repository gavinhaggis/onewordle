// Onewordle: one wrong guess, one possible answer.
(() => {
  const DATA = window.ONEWORDLE;
  const VALID = new Set(window.ONEWORDLE_WORDS.split(" "));
  const BANDS = ["gentle", "medium", "tricky", "fiendish"];
  const POINTS = { gentle: 10, medium: 20, tricky: 30, fiendish: 40 };
  const MIXED = ["gentle", "gentle", "medium", "medium", "medium", "tricky", "tricky", "tricky", "fiendish", "fiendish"];
  const ROUNDS = 10, MAX_TRIES = 5, WRONG = -5, GIVE_UP = -10;

  const $ = (id) => document.getElementById(id);
  const state = { mode: "one", band: "mixed", round: 0, score: 0, history: [], used: new Set() };
  let cur = null; // { puzzle, attempts: [[word, pattern]], typed, done }

  // Same two-pass rule as build.py: greens first, then yellows left to right from leftover letters.
  function feedback(guess, answer) {
    const out = [0, 0, 0, 0, 0], left = {};
    for (let i = 0; i < 5; i++) {
      if (guess[i] === answer[i]) out[i] = 2;
      else left[answer[i]] = (left[answer[i]] || 0) + 1;
    }
    for (let i = 0; i < 5; i++) {
      if (out[i] === 2) continue;
      if (left[guess[i]] > 0) { out[i] = 1; left[guess[i]]--; }
    }
    return out.join("");
  }

  function pickPuzzle() {
    const band = state.band === "mixed" ? MIXED[state.round] : state.band;
    const pool = DATA[state.mode].filter((p) => p.band === band && !state.used.has(p.answer));
    const p = pool[Math.floor(Math.random() * pool.length)];
    state.used.add(p.answer);
    return p;
  }

  // ---------- rendering
  function tileRow(word, pattern, cap, cls = "") {
    const row = document.createElement("div");
    row.className = "row " + cls;
    if (cap) row.innerHTML = `<span class="cap">${cap}</span>`;
    for (let i = 0; i < 5; i++) {
      const t = document.createElement("div");
      const ch = word[i] || "";
      t.className = "tile" + (pattern ? " s" + pattern[i] : ch ? " filled" : "");
      t.textContent = ch;
      if (pattern) t.setAttribute("aria-label", `${ch} ${["grey", "yellow", "green"][pattern[i]]}`);
      row.appendChild(t);
    }
    return row;
  }

  function render() {
    const b = $("board");
    b.innerHTML = "";
    const clues = cur.puzzle.rows;
    clues.forEach(([g, p], i) => b.appendChild(tileRow(g, p, clues.length > 1 ? `clue ${i + 1}` : "clue")));
    const div = document.createElement("div"); div.className = "divider"; b.appendChild(div);
    cur.attempts.forEach(([w, p], i) => b.appendChild(tileRow(w, p, `try ${i + 1}`)));
    if (!cur.done) {
      const r = tileRow(cur.typed, null, "you", "input");
      const t = r.querySelectorAll(".tile")[Math.min(cur.typed.length, 4)];
      if (t) t.classList.add("cursor");
      b.appendChild(r);
    } else if (!cur.solved) {
      b.appendChild(tileRow(cur.puzzle.answer, "22222", "answer"));
    }
    $("round").textContent = `Round ${state.round + 1} / ${ROUNDS}`;
    $("score").textContent = `Score ${state.score}`;
    $("bandTag").textContent = `${cur.puzzle.band} · ${state.mode === "one" ? "one row" : "two rows"} · ${cur.attempts.length}/${MAX_TRIES} tries`;
    renderKeys();
  }

  function keyStates() {
    const s = {};
    const rows = cur.puzzle.rows.concat(cur.attempts);
    for (const [w, p] of rows) for (let i = 0; i < 5; i++) s[w[i]] = Math.max(s[w[i]] ?? -1, +p[i]);
    return s;
  }

  function renderKeys() {
    const s = keyStates();
    const kb = $("kb");
    kb.innerHTML = "";
    ["qwertyuiop", "asdfghjkl", "+zxcvbnm-"].forEach((line) => {
      const r = document.createElement("div"); r.className = "kbrow";
      for (const ch of line) {
        const k = document.createElement("button");
        k.className = "key";
        if (ch === "+") { k.textContent = "enter"; k.classList.add("wide"); k.dataset.k = "Enter"; }
        else if (ch === "-") { k.textContent = "⌫"; k.classList.add("wide"); k.dataset.k = "Backspace"; }
        else { k.textContent = ch; k.dataset.k = ch; if (s[ch] !== undefined) k.classList.add("s" + s[ch]); }
        r.appendChild(k);
      }
      kb.appendChild(r);
    });
  }

  function say(text, cls = "") { const m = $("msg"); m.textContent = text; m.className = cls; }

  // ---------- flow
  function startGame() {
    state.mode = document.querySelector("input[name=mode]:checked").value;
    state.band = $("band").value;
    state.round = 0; state.score = 0; state.history = []; state.used = new Set();
    $("setup").hidden = true; $("end").hidden = true; $("play").hidden = false;
    startRound();
  }

  function startRound() {
    cur = { puzzle: pickPuzzle(), attempts: [], typed: "", done: false, solved: false, delta: 0 };
    $("after").hidden = true; $("giveup").hidden = false; $("kb").hidden = false;
    say("");
    render();
  }

  function finishRound(solved, gaveUp) {
    cur.done = true; cur.solved = solved;
    if (solved) cur.delta += POINTS[cur.puzzle.band];
    if (gaveUp) cur.delta += GIVE_UP;
    state.score += solved ? POINTS[cur.puzzle.band] : gaveUp ? GIVE_UP : 0;
    state.history.push({ answer: cur.puzzle.answer, band: cur.puzzle.band, tries: cur.attempts.length, solved, delta: cur.delta });
    const f = cur.puzzle.features;
    say(solved ? `Got it: ${cur.puzzle.answer.toUpperCase()}  +${POINTS[cur.puzzle.band]}` :
      `It was ${cur.puzzle.answer.toUpperCase()}`, solved ? "good" : "bad");
    $("explain").innerHTML =
      `Shape <b>${f.G} green · ${f.Y} to move · ${f.X} to invent</b><br>` +
      `Words fitting the greens and yellows alone: <b>${f.n_gy}</b> · near misses: <b>${f.n_near}</b><br>` +
      `Answer commonness <b>${f.c_answer.toFixed(2)}</b> (Zipf) · difficulty <b>${cur.puzzle.D}</b> · round ${cur.delta >= 0 ? "+" : ""}${cur.delta}`;
    $("next").textContent = state.round + 1 >= ROUNDS ? "See results" : "Next round";
    $("after").hidden = false; $("giveup").hidden = true; $("kb").hidden = true;
    render();
  }

  function submit() {
    const w = cur.typed;
    if (w.length < 5) return reject("Five letters, please");
    if (!VALID.has(w)) return reject("Not in the word list");
    if (cur.attempts.some(([a]) => a === w) || cur.puzzle.rows.some(([g]) => g === w)) return reject("Already on the board");
    const p = feedback(w, cur.puzzle.answer);
    cur.attempts.push([w, p]);
    cur.typed = "";
    if (p === "22222") return finishRound(true, false);
    state.score += WRONG; cur.delta += WRONG;
    if (cur.attempts.length >= MAX_TRIES) return finishRound(false, false);
    say(`Not it  ${WRONG}`, "bad");
    render();
  }

  function reject(text) {
    say(text, "bad");
    const r = document.querySelector(".row.input");
    if (r) { r.classList.remove("shake"); void r.offsetWidth; r.classList.add("shake"); }
  }

  function press(k) {
    if (!cur || cur.done || $("play").hidden) return;
    if (k === "Enter") return submit();
    if (k === "Backspace") cur.typed = cur.typed.slice(0, -1);
    else if (/^[a-z]$/i.test(k) && cur.typed.length < 5) cur.typed += k.toLowerCase();
    else return;
    say("");
    render();
  }

  function next() {
    state.round++;
    if (state.round < ROUNDS) return startRound();
    $("play").hidden = true; $("end").hidden = false;
    $("final").textContent = state.score;
    $("summary").innerHTML = state.history.map((h, i) =>
      `<tr><td>${i + 1}</td><td><b>${h.answer.toUpperCase()}</b></td><td>${h.band}</td>` +
      `<td>${h.solved ? `solved in ${h.tries}` : "missed"}</td>` +
      `<td class="${h.delta >= 0 ? "pos" : "neg"}">${h.delta >= 0 ? "+" : ""}${h.delta}</td></tr>`).join("");
  }

  $("start").onclick = startGame;
  $("again").onclick = () => { $("end").hidden = true; $("setup").hidden = false; };
  $("next").onclick = next;
  $("giveup").onclick = () => { if (cur && !cur.done) finishRound(false, true); };
  $("kb").addEventListener("click", (e) => { const k = e.target.closest(".key"); if (k) press(k.dataset.k); });
  document.addEventListener("keydown", (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === "Enter") e.preventDefault(); // stop a focused button from also firing
    if ($("play").hidden) return;
    if (!$("after").hidden && e.key === "Enter") return next();
    press(e.key);
  });

  window.__onewordle = { state, get cur() { return cur; }, feedback, press }; // for testing
})();
