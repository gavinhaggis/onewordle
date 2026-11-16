// How it works page: explorer, pipeline, code listing and the in-browser check.
// All puzzle logic lives in rules.js; this file only draws things and compares results with build.py.
(() => {
  const $ = (id) => document.getElementById(id);
  const fmt = (n) => n.toLocaleString("en-GB");
  const WORDS = window.ONEWORDLE_WORDS.split(" ");
  const H = window.ONEWORDLE_HOW;
  const IDX = new Map(WORDS.map((w, i) => [w, i]));
  const clsOf = (w) => (IDX.has(w) ? H.cls[IDX.get(w)] : null);
  const zipfOf = (w) => H.zipf[IDX.get(w)] / 100;
  const isAnswerWord = (w) => clsOf(w) === "a";
  const CLUES = WORDS.filter(isAnswerWord);
  const pstr = (p) => [81, 27, 9, 3, 1].map((b) => Math.floor(p / b) % 3).join("");
  const STATUS = ["kept", "grey clash", "no green or yellow", "shape"];

  // ---------- build.py's answers, for comparison
  const LINKS = H.links.map((l) => ({
    clue: WORDS[l[0]], answer: WORDS[l[1]], pattern: pstr(l[2]), status: STATUS[l[3]],
    ...(l[3] === 0 ? { U: l[7], N: l[8], D: l[9], band: H.config.bands[l[10]] } : {}),
  }));
  const group = (key) => LINKS.reduce((m, l) => (m.get(l[key]) || m.set(l[key], []).get(l[key])).push(l) && m, new Map());
  const byClue = group("clue"), byAnswer = group("answer");
  const keyOf = (clue, pattern, answer) => clue + pattern + answer;

  // ---------- difficulty, recomputed here from the measures (rules.js: difficulty)
  const KEPT = LINKS.filter((l) => l.status === "kept");
  const RANKED = new Map();
  {
    const res = difficulty(KEPT.map((l) => ({ U: l.U, C: zipfOf(l.answer), X: shapeOf(l.clue, l.pattern, l.answer).X,
      Y: shapeOf(l.clue, l.pattern, l.answer).Y, N: l.N })));
    let same = 0;
    res.forEach((r, i) => {
      const l = KEPT[i];
      RANKED.set(keyOf(l.clue, l.pattern, l.answer), r);
      if (Math.abs(r.D - l.D) < 0.0006 && r.band === l.band) same++;
    });
    $("scoreCheck").innerHTML = `Recomputed in your browser just now: <b class="${same === KEPT.length ? "ok" : "no"}">${fmt(same)} of ${fmt(KEPT.length)}</b> difficulty scores and bands match build.py.`;
  }

  // ---------- don't spoil today's puzzles
  const SPOIL = new Set();
  try {
    const D = window.ONEWORDLE_DAILY, k = D.key, now = new Date();
    const pad = (x) => String(x).padStart(2, "0");
    const dateKey = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
    const [ly, lm, ld] = D.launch.split("-").map(Number);
    const dayNo = Math.round((Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) - Date.UTC(ly, lm - 1, ld)) / 864e5) + 1;
    let doneToday = false;
    try { doneToday = !!(JSON.parse(localStorage.getItem("onewordle-day-" + dateKey)) || {}).done; } catch {}
    const decode = (s) => [...s].map((ch, i) => /[a-z]/.test(ch) ? String.fromCharCode(97 + ((ch.charCodeAt(0) - 97 - k.charCodeAt(i % k.length)) % 26 + 260) % 26) : ch).join("");
    for (const d of [dayNo - 1, dayNo, dayNo + 1]) {
      if (d < 1 || (d === dayNo && doneToday)) continue;
      for (const row of D.days[(d - 1) % D.days.length]) SPOIL.add(decode(row.split("|")[0]).slice(0, 10));
    }
  } catch {}
  const spoiler = (clue, pattern) => SPOIL.has(clue + pattern);

  // ---------- drawing helpers
  const tiles = (word, pattern, cls = "") => `<span class="tiles ${cls}">${[...word].map((ch, i) =>
    `<span class="t ${pattern ? "s" + pattern[i] : "plain"}">${ch}</span>`).join("")}</span>`;
  const hiddenTiles = () => `<span class="tiles">${"?????".split("").map(() => `<span class="t hidden">?</span>`).join("")}</span>`;
  const shown = (w) => (clsOf(w) === "b" ? "•••••" : w);
  const shapeDots = ({ G, Y, X }) => `<span class="shape" title="${G} in place, ${Y} to move, ${X} to invent">${"<i class=g></i>".repeat(G)}${"<i class=y></i>".repeat(Y)}${"<i class=x></i>".repeat(X)}<em>${G}·${Y}·${X}</em></span>`;
  const CLASS_TEXT = {
    a: "a common word, so it can be a clue and an answer",
    v: "a valid word, but too rare to be a clue or an answer. It still counts as a rival",
    n: "a valid word, but it's also a name, so it's never shown. It still counts as a rival",
    b: "a valid word, but on the blocklist, so it's never shown. It still counts as a rival",
  };

  // ---------- stats
  const F = H.funnel;
  $("stats").innerHTML = [
    [F.V, "five-letter words the game accepts"], [F.A, "common enough to be shown"],
    [F.unique, "clues with exactly one answer"], [F.kept, "of those in the game"],
  ].map(([n, t]) => `<div class="stat"><b>${fmt(n)}</b><span>${t}</span></div>`).join("");

  // ---------- explorer
  const st = { word: "", tab: "clue", onlyKept: false, limit: 30, clue: [], answer: [], buckets: [] };
  const input = $("word");

  function analyse(word) {
    st.word = word;
    st.limit = 30;
    try { history.replaceState(null, "", "#" + word); } catch {}
    const cls = clsOf(word);
    $("wordInfo").innerHTML = cls ? `<b>${word.toUpperCase()}</b> is ${CLASS_TEXT[cls]}.` :
      `<b>${word.toUpperCase()}</b> isn't in the word list, but here's what it would show as a guess.`;

    // as the clue: worked out live
    const buckets = sortIntoBuckets(word, WORDS);
    st.buckets = [...buckets].sort((a, b) => b[1].length - a[1].length || (a[0] < b[0] ? 1 : -1));
    st.clue = [];
    for (const [pattern, ws] of buckets) {
      const answer = ws[0];
      if (ws.length !== 1 || !isAnswerWord(answer) || pattern === "22222") continue;
      st.clue.push(row(word, pattern, answer, buckets));
    }
    // as the answer: for every common clue word, does this word sit alone in its bucket?
    st.answer = [];
    if (isAnswerWord(word)) {
      for (const clue of CLUES) {
        const pattern = colours(clue, word);
        if (pattern === "22222") continue;
        let n = 0;
        for (const w of WORDS) if (colours(clue, w) === pattern && ++n > 1) break;
        if (n === 1) st.answer.push(row(clue, pattern, word, null));
      }
    }
    const order = (r) => (r.verdict === "kept" ? r.D ?? 2 : 3);
    st.clue.sort((a, b) => order(a) - order(b));
    st.answer.sort((a, b) => order(a) - order(b));
    verify(word);
    draw();
  }

  function row(clue, pattern, answer, buckets) {
    const r = { clue, pattern, answer, verdict: verdict(clue, pattern, answer, 1), shape: shapeOf(clue, pattern, answer) };
    if (r.verdict === "kept") {
      if (!isAnswerWord(clue)) r.verdict = "clue word too rare";
      else {
        r.m = measures(clue, pattern, answer, buckets || sortIntoBuckets(clue, WORDS), zipfOf);
        Object.assign(r, RANKED.get(keyOf(clue, pattern, answer)) || {});
      }
    }
    return r;
  }

  function verify(word) {
    const out = [];
    const check = (mine, theirs, label) => {
      const a = new Map(mine.filter((r) => r.verdict !== "clue word too rare").map((r) => [keyOf(r.clue, r.pattern, r.answer), r]));
      const b = theirs || [];
      let same = 0;
      for (const l of b) {
        const r = a.get(keyOf(l.clue, l.pattern, l.answer));
        if (r && r.verdict.startsWith(l.status) && (l.status !== "kept" || (r.m.U === l.U && Math.abs(r.m.N - l.N) < 0.011))) same++;
      }
      const ok = same === b.length && a.size === b.length;
      out.push(`${label}: <b class="${ok ? "ok" : "no"}">${ok ? "✓" : "✗"} ${fmt(a.size)} found here, ${fmt(b.length)} in build.py${ok ? ", same verdicts and measures" : ""}</b>`);
    };
    if (isAnswerWord(word)) {
      check(st.clue, byClue.get(word), "As the clue");
      check(st.answer, byAnswer.get(word), "As the answer");
      $("verify").innerHTML = "Worked out live in your browser with the code below, then compared with build.py. " + out.join(" · ");
    } else $("verify").innerHTML = "";
  }

  function card(r, focus) {
    const hide = focus === "clue" && spoiler(r.clue, r.pattern);
    const kept = r.verdict === "kept";
    const clueBtn = `<button class="tiles" data-go="${r.clue}" aria-label="Explore ${r.clue}">${tiles(r.clue, r.pattern)}</button>`;
    const ansBtn = hide ? hiddenTiles() : `<button class="tiles" data-go="${r.answer}" aria-label="Explore ${r.answer}">${tiles(r.answer)}</button>`;
    let meta = shapeDots(r.shape);
    if (hide) meta += `<span class="pill">today's puzzle, hidden until you've played</span>`;
    else if (kept) meta += `<span class="pill kept band-${r.band}">${r.band || "kept"}</span>${r.D != null ? `<span>D ${r.D.toFixed(2)}</span>` : ""}`;
    else meta += `<span class="pill cut">${r.verdict}</span>`;
    const why = kept && !hide && r.m ? `<div class="why">fits greens + yellows: ${r.m.U} · answer commonness: ${r.m.C.toFixed(2)} · near misses: ${r.m.N}</div>` : "";
    return `<div class="card ${kept ? "" : "out"}"><div class="pair">${clueBtn}<span class="arrow">→</span>${ansBtn}</div><div class="meta">${meta}</div>${why}</div>`;
  }

  function bucketRow([pattern, ws]) {
    const one = ws.length === 1;
    let label = `<span class="n">${fmt(ws.length)}</span>`;
    const hide = spoiler(st.word, pattern);
    if (one && isAnswerWord(ws[0]) && pattern !== "22222") {
      const v = verdict(st.word, pattern, ws[0], 1);
      label = `<span class="meta"><span class="n">1</span>${hide ? `<span class="pill">today's puzzle</span>` : `<span class="pill ${v === "kept" ? "kept" : "cut"}">${v}</span>`}</span>`;
    }
    const list = ws.slice(0, 40).map((w) => (hide ? "?????" : isAnswerWord(w) ? `<b>${w}</b>` : shown(w))).join(" ") + (ws.length > 40 ? ` +${fmt(ws.length - 40)}` : "");
    return `<div class="bucket ${one ? "one" : ""}">${tiles(st.word, pattern)}${label}<div class="ws">${list}</div></div>`;
  }

  function draw() {
    const W = st.word.toUpperCase();
    const kc = st.clue.filter((r) => r.verdict === "kept").length, ka = st.answer.filter((r) => r.verdict === "kept").length;
    $("nClue").textContent = st.clue.length; $("nAnswer").textContent = st.answer.length; $("nBuckets").textContent = st.buckets.length;
    document.querySelectorAll("#tabs button").forEach((b) => b.setAttribute("aria-selected", b.dataset.tab === st.tab));
    $("filters").hidden = st.tab === "buckets";
    let items, html;
    if (st.tab === "clue") {
      $("tabNote").textContent = `${W} splits all ${fmt(WORDS.length)} words into ${st.buckets.length} colour patterns. ${st.clue.length} of those hold exactly one common word, so ${W} gives ${st.clue.length} one-answer clues. ${kc} pass every filter.`;
      items = st.onlyKept ? st.clue.filter((r) => r.verdict === "kept") : st.clue;
      html = items.slice(0, st.limit).map((r) => card(r, "clue")).join("");
    } else if (st.tab === "answer") {
      $("tabNote").textContent = isAnswerWord(st.word)
        ? `${st.answer.length} common words, shown as the wrong guess, leave ${W} as the only word that fits. ${ka} of those pass every filter. Worked out live: each clue word is checked against all ${fmt(WORDS.length)} words.`
        : `${W} is never an answer, so nothing points to it.`;
      items = st.onlyKept ? st.answer.filter((r) => r.verdict === "kept") : st.answer;
      html = items.slice(0, st.limit).map((r) => card(r, "answer")).join("");
    } else {
      $("tabNote").textContent = `Every word in the dictionary, grouped by the colours ${W} would show against it. Common words are in bold. A green outline is a bucket of exactly one word.`;
      items = st.buckets;
      html = `<div class="bucketlist">${items.slice(0, st.limit).map(bucketRow).join("")}</div>`;
    }
    $("results").className = st.tab === "buckets" ? "" : "cards";
    $("results").innerHTML = items.length ? html : `<div class="empty">Nothing here for ${W}.</div>`;
    $("more").hidden = items.length <= st.limit;
    $("more").textContent = `Show more (${fmt(items.length - st.limit)} left)`;
  }

  input.addEventListener("input", () => {
    const w = input.value.toLowerCase().replace(/[^a-z]/g, "").slice(0, 5);
    input.value = w;
    if (w.length === 5 && w !== st.word) analyse(w);
  });
  $("tabs").addEventListener("click", (e) => { const b = e.target.closest("button"); if (b) { st.tab = b.dataset.tab; st.limit = 30; draw(); } });
  $("onlyKept").addEventListener("change", (e) => { st.onlyKept = e.target.checked; st.limit = 30; draw(); });
  $("more").addEventListener("click", () => { st.limit += 60; draw(); });
  $("results").addEventListener("click", (e) => {
    const b = e.target.closest("[data-go]");
    if (b) { input.value = b.dataset.go; analyse(b.dataset.go); $("explore").scrollIntoView(); }
  });
  $("chips").innerHTML = ["crane", "plant", "ghost", "audio", "pizza", "lemon"].map((w) => `<button class="chip" data-w="${w}">${w}</button>`).join("");
  $("chips").addEventListener("click", (e) => { const b = e.target.closest("[data-w]"); if (b) { input.value = b.dataset.w; analyse(b.dataset.w); } });

  // ---------- shape grid (from build.py's list of one-answer clues)
  {
    const grid = {};
    let max = 0;
    for (const l of LINKS) {
      if (l.status === "grey clash") continue;
      const { G, Y } = shapeOf(l.clue, l.pattern, l.answer);
      const k = G + "," + Y;
      grid[k] = (grid[k] || 0) + 1;
      max = Math.max(max, grid[k]);
    }
    let html = `<div class="h">G ↓ Y →</div>` + [0, 1, 2, 3, 4, 5].map((y) => `<div class="h">${y}</div>`).join("");
    for (let g = 0; g <= 4; g++) {
      html += `<div class="h">${g}</div>`;
      for (let y = 0; y <= 5; y++) {
        const n = grid[g + "," + y] || 0;
        const a = n ? Math.log(n + 1) / Math.log(max + 1) : 0;
        const keep = g >= 1 && g <= 2 && y >= 1 && y <= 2;
        html += `<div class="cell ${n ? "" : "none"} ${keep ? "keep" : ""} ${a > .6 ? "dark" : ""}" style="--a:${a.toFixed(2)}" title="${g} green, ${y} yellow: ${n}">${n ? fmt(n) : "·"}</div>`;
      }
    }
    $("shapeGrid").innerHTML = html;
    const kept = Object.entries(grid).filter(([k]) => { const [g, y] = k.split(",").map(Number); return g >= 1 && g <= 2 && y >= 1 && y <= 2; }).reduce((s, [, n]) => s + n, 0);
    $("shapeNote").textContent = `${fmt(kept)} of ${fmt(F.unique - F.ambiguous)} clean one-answer clues have a kept shape. Empty cells are shapes that are impossible or never leave just one word.`;
  }

  // ---------- pipeline
  {
    const steps = [
      [F.V, "Five-letter words", "Every five-letter word in the ENABLE word list. All of them count as rivals: if any word at all shares a clue's colours, that clue isn't unique.", null, ""],
      [F.A, "Common enough to show", "Only words people actually use (Zipf 3 or more on wordfreq's scale), minus names and a blocklist. Only these are ever shown as a clue or an answer.", null, `${fmt(F.V - F.A)} too rare, names or blocked`],
      [F.pairs, "Every clue × every answer", `Each common word as the wrong guess against each common word as the answer, and against all ${fmt(F.V)} words to find rivals. That's about 22 million colour checks.`, "colours", ""],
      [F.unique, "Exactly one word fits", "Group every word by the colours the guess would show. A group of one is a clue with one answer. Only 0.24% of pairs get there.", "sortIntoBuckets", `${fmt(F.pairs - F.unique)} have a rival that shows the same colours`],
      [F.unique - F.ambiguous, "No grey clash", "Drop clues where a letter is grey in one tile and green or yellow in another.", "hasGreyClash", `${fmt(F.ambiguous)} grey clashes`],
      [F.kept, "The right shape", "Keep 1–2 greens and 1–2 yellows. Four greens is a giveaway, and no greens is a slog.", "shapeOf", `${fmt(F.shape + F.no_clues)} outside the shape window`],
      [F.kept, "Scored for difficulty", "Five measures, each turned into a percentile rank, weighted and added up. The four quarters become gentle, medium, tricky and fiendish.", "measures", ""],
      [F.daily_days * 3, "Daily puzzles", `${fmt(F.daily_days)} days × one gentle, one medium and one tricky. No answer comes back within a year. Everyone gets the same three, and they change at each phone's midnight.`, null, ""],
    ];
    const top = Math.log10(Math.max(...steps.map((s) => s[0])));
    $("rail").innerHTML = steps.map(([n, title, text, fn, drop]) => `<li>
      <div class="head"><h3>${title}</h3><span class="count">${fmt(n)}</span></div>
      <div class="bar"><i style="width:${(100 * Math.log10(n) / top).toFixed(1)}%"></i></div>
      <p>${text}</p>${drop ? `<span class="drop">− ${drop}</span>` : ""}
      ${fn ? `<a class="fn" href="#fn-${fn}">${fn}() ↓</a>` : ""}</li>`).join("");
  }

  // ---------- code listing, read from the running functions
  {
    const hl = (src) => src.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/(\/\/[^\n]*)|("(?:[^"\\\n]|\\.)*")|\b(const|let|for|of|if|else|return|function|new|in|while|continue|break)\b|\b(\d+(?:\.\d+)?)\b/g,
        (m, c, s, k, n) => c ? `<span class="c">${c}</span>` : s ? `<span class="s">${s}</span>` : k ? `<span class="k">${k}</span>` : `<span class="n">${n}</span>`);
    const sample = (status) => LINKS.find((l) => l.status === status && !spoiler(l.clue, l.pattern) && zipfOf(l.answer) > 4.2 && zipfOf(l.clue) > 4.2);
    const clash = sample("grey clash"), kept = sample("kept");
    const ex = (g, a) => `<span>${tiles(g, colours(g, a))} vs ${tiles(a)}</span>`;
    const fns = [
      [colours, "Step 3", "Works out a guess's colours against an answer. Greens are settled first, then yellows from the letters left over, so repeated letters come out right.",
        () => ex("speed", "abide") + ex("eerie", "abide") + ex("eerie", "theme")],
      [sortIntoBuckets, "Step 4", "Runs colours() for one guess against every valid word and groups the words by the colours they'd show. This is the uniqueness check: a group of one means only one word fits.", null],
      [hasGreyClash, "Step 5", "Finds clues where one letter is grey in one tile but green or yellow in another.",
        () => clash ? `<span>${tiles(clash.clue, clash.pattern)} grey clash: ${hasGreyClash(clash.clue, clash.pattern)}</span>` : ""],
      [shapeOf, "Step 6", "Counts how many answer letters are in place, how many are shown but need moving, and how many you have to invent.",
        () => kept ? `<span>${tiles(kept.clue, kept.pattern)} → ${tiles(kept.answer)} ${shapeDots(shapeOf(kept.clue, kept.pattern, kept.answer))}</span>` : ""],
      [verdict, "Steps 4–6", "Every filter in order. The explorer above shows this function's answer on each card.", null],
      [fitsGreensAndYellows, "Step 7", "Used for measure U: how many words you'd still be choosing between if you used only the greens and yellows. The more there are, the more the greys have to do, and the harder the puzzle.", null],
      [measures, "Step 7", "The five difficulty measures: U (words fitting greens and yellows only), C (how common the answer is), X (letters to invent), Y (letters to move) and N (near misses: words one tile away, counted by how well known they are).", null],
      [percentileRanks, "Step 7", "Turns raw numbers into 0 to 1 so measures in different units can be added together.", null],
      [difficulty, "Step 7", "The score: D = 0.30·U + 0.20·C + 0.25·X + 0.10·Y + 0.15·N, all as percentile ranks. Then the bands are cut at the quarters of D.", null],
    ];
    $("fns").innerHTML = fns.map(([fn, step, text, demo]) => `<div class="fn-block" id="fn-${fn.name}">
      <h3>${fn.name}()<small>${step}</small></h3><p>${text}</p>${demo ? `<div class="demo">${demo()}</div>` : ""}
      <pre class="code"><code>${hl(fn.toString())}</code></pre></div>`).join("");
  }

  // ---------- full check, in chunks so the page stays responsive
  {
    let running = false;
    const btn = $("audit");
    btn.addEventListener("click", () => {
      if (running) { running = false; return; }
      running = true;
      btn.textContent = "Stop";
      const want = new Map(LINKS.map((l) => [keyOf(l.clue, l.pattern, l.answer), l]));
      let i = 0, found = 0, same = 0;
      const t0 = performance.now();
      $("auditBar").hidden = false;
      const step = () => {
        if (!running) return finish(true);
        const until = performance.now() + 40;
        while (i < CLUES.length && performance.now() < until) {
          const clue = CLUES[i++];
          const buckets = sortIntoBuckets(clue, WORDS);
          for (const [pattern, ws] of buckets) {
            if (ws.length !== 1 || !isAnswerWord(ws[0]) || pattern === "22222") continue;
            found++;
            const l = want.get(keyOf(clue, pattern, ws[0]));
            const v = verdict(clue, pattern, ws[0], 1);
            if (!l || !v.startsWith(l.status)) continue;
            if (v === "kept") {
              const m = measures(clue, pattern, ws[0], buckets, zipfOf);
              if (m.U !== l.U || Math.abs(m.N - l.N) > 0.011) continue;
            }
            same++;
          }
        }
        $("auditBar").firstElementChild.style.width = (100 * i / CLUES.length).toFixed(1) + "%";
        $("auditOut").textContent = `Checked ${fmt(i)} of ${fmt(CLUES.length)} clue words…`;
        if (i < CLUES.length) setTimeout(step, 0); else finish(false);
      };
      const finish = (stopped) => {
        running = false;
        btn.textContent = "Run the full check again";
        const secs = ((performance.now() - t0) / 1000).toFixed(1);
        const ok = !stopped && found === LINKS.length && same === LINKS.length;
        $("auditOut").innerHTML = stopped ? `Stopped after ${fmt(i)} clue words: ${fmt(same)} of ${fmt(found)} one-answer clues so far match build.py.` :
          `<b class="${ok ? "ok" : "no"}">${ok ? "✓ Everything matches." : "✗ Something differs."}</b> In ${secs} s your browser found ${fmt(found)} one-answer clues (build.py: ${fmt(LINKS.length)}). ${fmt(same)} have the same verdict, and every kept one has the same difficulty measures.`;
      };
      step();
    });
  }

  // ---------- start
  const start = (location.hash.slice(1).toLowerCase().match(/^[a-z]{5}$/) || ["plant"])[0];
  input.value = start;
  analyse(start);
})();
