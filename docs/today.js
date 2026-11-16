// Onewordle daily: three puzzles, one clock, one go per day.
(() => {
  const SITE = "https://gavinhaggis.github.io/onewordle/";
  const PENALTY_WRONG = 15000, PENALTY_GIVEUP = 60000, PAUSE_BETWEEN = 900;
  const VALID = new Set(window.ONEWORDLE_WORDS.split(" "));
  const D = window.ONEWORDLE_DAILY;
  const $ = (id) => document.getElementById(id);
  const store = {
    get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
  };

  // ---------- which day is it (each phone's local date)
  const pad = (x) => String(x).padStart(2, "0");
  const now = new Date();
  const dateKey = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const [ly, lm, ld] = D.launch.split("-").map(Number);
  const dayNo = Math.max(1, Math.round((Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) - Date.UTC(ly, lm - 1, ld)) / 864e5) + 1);
  const dateLabel = now.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });

  function decode(s) {
    const k = D.key;
    return [...s].map((ch, i) => /[a-z]/.test(ch) ? String.fromCharCode(97 + ((ch.charCodeAt(0) - 97 - k.charCodeAt(i % k.length)) % 26 + 26 * 10) % 26) : ch).join("");
  }
  const BAND = { g: "gentle", m: "medium", t: "tricky" };
  const puzzles = D.days[(dayNo - 1) % D.days.length].map((row) => {
    const [code, band] = row.split("|");
    const s = decode(code);
    return { guess: s.slice(0, 5), pattern: s.slice(5, 10), answer: s.slice(10, 15), band: BAND[band] };
  });

  // ---------- state, saved after every change so a reload can't reset the clock
  const KEY = "onewordle-day-" + dateKey;
  let st = store.get(KEY);
  if (!st || st.day !== dayNo) st = { day: dayNo, started: false, done: false, idx: 0, clock: 0, since: null, res: puzzles.map(() => ({ tries: [], wrong: 0, gaveUp: false, ms: 0, startClock: null })) };
  let typed = "";
  const save = () => store.set(KEY, st);

  const clockMs = () => st.clock + (st.since ? Date.now() - st.since : 0);
  const penalties = (r) => r.wrong * PENALTY_WRONG + (r.gaveUp ? PENALTY_GIVEUP : 0);
  const liveTotal = () => {
    const done = st.res.slice(0, st.idx).reduce((s, r) => s + r.ms, 0);
    const cur = st.res[st.idx];
    return done + (cur ? clockMs() - cur.startClock + penalties(cur) : 0);
  };
  const total = () => st.res.reduce((s, r) => s + r.ms, 0);
  function fmt(ms, tenths) {
    const s = Math.max(0, ms) / 1000, m = Math.floor(s / 60), r = s - m * 60;
    return tenths ? `${m}:${r.toFixed(1).padStart(4, "0")}` : `${m}:${pad(Math.floor(r))}`;
  }

  function feedback(guess, answer) {
    const out = [0, 0, 0, 0, 0], left = {};
    for (let i = 0; i < 5; i++) {
      if (guess[i] === answer[i]) out[i] = 2;
      else left[answer[i]] = (left[answer[i]] || 0) + 1;
    }
    for (let i = 0; i < 5; i++) if (out[i] !== 2 && left[guess[i]] > 0) { out[i] = 1; left[guess[i]]--; }
    return out.join("");
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
  const mini = (word, pattern) => `<span class="mini">${[...word].map((ch, i) => `<i class="s${pattern[i]}">${ch}</i>`).join("")}</span>`;

  function renderPlay() {
    const p = puzzles[st.idx], r = st.res[st.idx];
    const b = $("board");
    b.innerHTML = "";
    b.appendChild(tileRow(p.guess, p.pattern, "clue"));
    const div = document.createElement("div"); div.className = "divider"; b.appendChild(div);
    r.tries.forEach(([w, pat], i) => b.appendChild(tileRow(w, pat, `try ${i + 1}`)));
    if (!r.solved && !r.gaveUp) {
      const row = tileRow(typed, null, "you", "input");
      const t = row.querySelectorAll(".tile")[Math.min(typed.length, 4)];
      if (t) t.classList.add("cursor");
      b.appendChild(row);
    } else {
      b.appendChild(tileRow(p.answer, "22222", r.gaveUp ? "answer" : ""));
    }
    $("progress").innerHTML = puzzles.map((q, i) =>
      `<span class="dot ${i < st.idx ? "done" : i === st.idx ? "now" : ""}">${i + 1}<small>${q.band}</small></span>`).join("");
    renderKeys();
  }

  function renderKeys() {
    const s = {};
    const p = puzzles[st.idx], r = st.res[st.idx];
    for (const [w, pat] of [[p.guess, p.pattern], ...r.tries]) for (let i = 0; i < 5; i++) s[w[i]] = Math.max(s[w[i]] ?? -1, +pat[i]);
    $("kb").innerHTML = ["qwertyuiop", "asdfghjkl", "+zxcvbnm-"].map((line) => `<div class="kbrow">${[...line].map((ch) =>
      ch === "+" ? `<button class="key wide" data-k="Enter">enter</button>` :
      ch === "-" ? `<button class="key wide" data-k="Backspace" aria-label="delete">⌫</button>` :
      `<button class="key${s[ch] !== undefined ? " s" + s[ch] : ""}" data-k="${ch}">${ch}</button>`).join("")}</div>`).join("");
  }

  let msgTimer;
  function say(text, cls = "") { const m = $("msg"); m.textContent = text; m.className = cls; clearTimeout(msgTimer); if (text) msgTimer = setTimeout(() => (m.textContent = ""), 1800); }
  function toast(text) { const t = $("toast"); t.textContent = text; t.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => (t.hidden = true), 2200); }

  // ---------- clock
  let tick;
  function runClock() {
    clearInterval(tick);
    const c = $("clock");
    c.hidden = false;
    const draw = () => (c.textContent = fmt(liveTotal()));
    draw();
    tick = setInterval(draw, 250);
  }
  function bumpClock() { const c = $("clock"); c.classList.remove("bump"); void c.offsetWidth; c.classList.add("bump"); }

  // ---------- flow
  function show(which) { ["intro", "play", "done"].forEach((id) => ($(id).hidden = id !== which)); }

  function start() {
    st.started = true; st.since = Date.now(); st.res[0].startClock = 0;
    save(); show("play"); renderPlay(); runClock();
  }

  function finishPuzzle(gaveUp) {
    const r = st.res[st.idx];
    r.gaveUp = gaveUp; r.solved = !gaveUp;
    st.clock = clockMs(); st.since = null;          // pause while the answer shows
    r.ms = st.clock - r.startClock + penalties(r);
    save(); renderPlay();
    say(gaveUp ? `It was ${puzzles[st.idx].answer.toUpperCase()}  +60s` : `${fmt(r.ms, true)}`, gaveUp ? "bad" : "good");
    setTimeout(() => {
      st.idx++;
      if (st.idx >= puzzles.length) return finishDay();
      st.res[st.idx].startClock = st.clock; st.since = Date.now(); typed = "";
      save(); renderPlay(); runClock();
    }, gaveUp ? 1800 : PAUSE_BETWEEN);
  }

  function finishDay() {
    st.done = true; st.since = null; clearInterval(tick);
    save();
    const hist = store.get("onewordle-history") || {};
    hist[dateKey] = { day: dayNo, total: total() };
    store.set("onewordle-history", hist);
    renderDone();
  }

  function shareText() {
    const nums = ["1️⃣", "2️⃣", "3️⃣"], sq = { 0: "⬛", 1: "🟨", 2: "🟩" };
    const lines = puzzles.map((p, i) => {
      const r = st.res[i];
      const extra = r.gaveUp ? " 🏳️" : r.wrong ? ` (${r.wrong}✗ +${r.wrong * 15}s)` : "";
      return `${nums[i]} ${[...p.pattern].map((d) => sq[d]).join("")} ${fmt(r.ms, true)}${extra}`;
    });
    const url = location.protocol.startsWith("http") ? location.origin + location.pathname.replace(/index\.html$/, "") : SITE;
    return `Onewordle #${dayNo} · ${dateLabel}\n⏱ ${fmt(total(), true)}\n${lines.join("\n")}\n${url}`;
  }

  function renderDone() {
    show("done");
    $("clock").hidden = true;
    $("total").textContent = fmt(total(), true);
    $("splits").innerHTML = puzzles.map((p, i) => {
      const r = st.res[i];
      const pen = r.gaveUp ? `<span class="neg">gave up +60s</span>` : r.wrong ? `<span class="neg">${r.wrong} wrong +${r.wrong * 15}s</span>` : `<span class="pos">clean</span>`;
      return `<div class="split"><span class="band">${p.band}</span>${mini(p.guess, p.pattern)}<span class="arrow">→</span>${mini(p.answer, "22222")}<b>${fmt(r.ms, true)}</b>${pen}</div>`;
    }).join("");
    $("shareText").textContent = shareText();
    const hist = Object.values(store.get("onewordle-history") || {});
    const times = hist.map((h) => h.total);
    let streak = 0;
    const days = new Set(hist.map((h) => h.day));
    while (days.has(dayNo - streak)) streak++;
    $("mystats").innerHTML = [
      [hist.length, "played"], [streak, "day streak"],
      [times.length ? fmt(Math.min(...times), true) : "–", "your best"],
      [times.length ? fmt(times.reduce((a, b) => a + b, 0) / times.length, true) : "–", "your average"],
    ].map(([v, l]) => `<div><b>${v}</b><span>${l}</span></div>`).join("");
    const nextIn = () => {
      const t = new Date(); const mid = new Date(t.getFullYear(), t.getMonth(), t.getDate() + 1);
      const ms = mid - t;
      if (ms <= 1000) return location.reload();
      const h = Math.floor(ms / 36e5), m = Math.floor(ms / 6e4) % 60;
      $("nextIn").textContent = `New puzzles in ${h}h ${m}m`;
    };
    nextIn(); setInterval(nextIn, 30000);
  }

  function submit() {
    const p = puzzles[st.idx], r = st.res[st.idx], w = typed;
    if (w.length < 5) return reject("Five letters, please");
    if (!VALID.has(w)) return reject("Not in the word list");
    if (w === p.guess || r.tries.some(([a]) => a === w)) return reject("Already on the board");
    const pat = feedback(w, p.answer);
    r.tries.push([w, pat]);
    typed = "";
    if (pat === "22222") return finishPuzzle(false);
    r.wrong++;
    save(); renderPlay(); bumpClock();
    say("Not it  +15s", "bad");
  }

  function reject(text) {
    say(text, "bad");
    const row = document.querySelector(".row.input");
    if (row) { row.classList.remove("shake"); void row.offsetWidth; row.classList.add("shake"); }
  }

  function press(k) {
    if ($("play").hidden || !st.since) return;
    const r = st.res[st.idx];
    if (r.solved || r.gaveUp) return;
    if (k === "Enter") return submit();
    if (k === "Backspace") typed = typed.slice(0, -1);
    else if (/^[a-z]$/i.test(k) && typed.length < 5) typed += k.toLowerCase();
    else return;
    renderPlay();
  }

  // ---------- wiring
  $("dayLabel").textContent = `#${dayNo} · ${dateLabel}`;
  $("example").innerHTML = `<div class="ex-row">${mini("crane", "20100")}<span class="muted">C is right, A is somewhere else, R, N and E aren't in the word.</span></div>`;
  $("start").onclick = start;
  $("kb").addEventListener("click", (e) => { const k = e.target.closest(".key"); if (k) press(k.dataset.k); });
  document.addEventListener("keydown", (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === "Enter") e.preventDefault();
    press(e.key);
  });
  let confirmGiveUp = 0;
  $("giveup").onclick = () => {
    if (!st.since) return;
    if (Date.now() - confirmGiveUp > 3000) {
      confirmGiveUp = Date.now();
      $("giveup").textContent = "Tap again to give up (+60s)";
      setTimeout(() => ($("giveup").textContent = "Give up on this one (+60s)"), 3000);
      return;
    }
    confirmGiveUp = 0;
    $("giveup").textContent = "Give up on this one (+60s)";
    finishPuzzle(true);
  };
  $("share").onclick = async () => {
    const text = shareText();
    if (navigator.share && /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent)) {
      try { await navigator.share({ text }); return; } catch (e) { if (e.name === "AbortError") return; }
    }
    try { await navigator.clipboard.writeText(text); toast("Copied. Paste it in the group chat."); }
    catch { const sel = getSelection(), rng = document.createRange(); rng.selectNodeContents($("shareText")); sel.removeAllRanges(); sel.addRange(rng); toast("Selected. Copy it and paste in the chat."); }
  };

  // resume where this phone left off today
  if (st.done) renderDone();
  else if (st.started) {
    if (!st.since) { st.since = Date.now(); if (st.res[st.idx].solved || st.res[st.idx].gaveUp) st.idx++; }
    if (st.idx >= puzzles.length) finishDay();
    else { st.res[st.idx].startClock ??= st.clock; save(); show("play"); renderPlay(); runClock(); }
  } else show("intro");

  window.__daily = { get st() { return st; }, puzzles, press, feedback, shareText, dayNo }; // for testing
})();
