// Onewordle's rules, written to be read. The How it works page runs these exact functions,
// shows their source, and checks its results against what build.py (numpy, same rules) produced.
// Patterns are five characters: "0" grey, "1" yellow, "2" green.

function colours(guess, answer) {
  // Pass 1: greens. Every answer letter that isn't matched by a green goes into a pool.
  const result = ["0", "0", "0", "0", "0"];
  const pool = {};
  for (let i = 0; i < 5; i++) {
    if (guess[i] === answer[i]) result[i] = "2";
    else pool[answer[i]] = (pool[answer[i]] || 0) + 1;
  }
  // Pass 2: yellows, left to right. Each yellow uses up one letter from the pool,
  // so a letter is never shown more times than the answer has it.
  for (let i = 0; i < 5; i++) {
    if (result[i] !== "2" && pool[guess[i]] > 0) {
      result[i] = "1";
      pool[guess[i]] -= 1;
    }
  }
  return result.join("");
}

function sortIntoBuckets(guess, words) {
  // Put every valid word in the bucket for the colours this guess would show against it.
  // A bucket holding exactly one word is a clue with exactly one answer.
  const buckets = new Map();
  for (const word of words) {
    const pattern = colours(guess, word);
    if (!buckets.has(pattern)) buckets.set(pattern, []);
    buckets.get(pattern).push(word);
  }
  return buckets;
}

function hasGreyClash(guess, pattern) {
  // Grey normally means "not in the word". If the same letter is also green or yellow
  // somewhere else, grey only means "no more of this letter". Too subtle, so rejected.
  const grey = new Set(), coloured = new Set();
  for (let i = 0; i < 5; i++) (pattern[i] === "0" ? grey : coloured).add(guess[i]);
  return [...grey].some((letter) => coloured.has(letter));
}

function shapeOf(guess, pattern, answer) {
  // G = letters already in place (the greens)
  // Y = letters you're shown but have to move
  // X = letters no tile gives you, so you have to invent them.   G + Y + X = 5
  const shown = {}, need = {};
  for (let i = 0; i < 5; i++) if (pattern[i] !== "0") shown[guess[i]] = (shown[guess[i]] || 0) + 1;
  for (const letter of answer) need[letter] = (need[letter] || 0) + 1;
  let known = 0;
  for (const letter in need) known += Math.min(need[letter], shown[letter] || 0);
  const G = [...pattern].filter((x) => x === "2").length;
  return { G, Y: known - G, X: 5 - known };
}

function verdict(guess, pattern, answer, bucketSize) {
  // The filters, in the order build.py applies them. "kept" means it's in the game.
  if (pattern === "22222") return "the guess is the answer";
  if (bucketSize > 1) return bucketSize + " words fit";
  if (hasGreyClash(guess, pattern)) return "grey clash";
  const { G, Y } = shapeOf(guess, pattern, answer);
  if (G + Y < 1) return "no green or yellow";
  if (G < 1 || G > 2 || Y < 1 || Y > 2) return "shape: " + G + " green, " + Y + " yellow";
  return "kept";
}

function fitsGreensAndYellows(guess, clue, other) {
  // Would a word showing the `other` colours also satisfy every green and yellow of `clue`?
  // Greys are ignored on purpose: this counts the words you'd consider if you forgot them.
  for (let i = 0; i < 5; i++) {
    if (clue[i] === "2" && other[i] !== "2") return false; // a green must stay green
    if (clue[i] === "1" && other[i] === "2") return false; // a yellow letter isn't in that spot
  }
  for (const letter of new Set(guess)) {                   // and at least as many of each letter
    const lit = (p) => [...guess].filter((l, i) => l === letter && p[i] !== "0").length;
    if (lit(other) < lit(clue)) return false;
  }
  return true;
}

function measures(guess, pattern, answer, buckets, zipfOf) {
  // The five difficulty measures for one puzzle. zipfOf(word) is how common a word is:
  // about 1 for very rare, 6 or more for everyday words.
  let U = 0, N = 0;
  for (const [other, words] of buckets) {
    if (fitsGreensAndYellows(guess, pattern, other)) U += words.length;
    const tilesOff = [...other].filter((x, i) => x !== pattern[i]).length;
    if (tilesOff === 1) {
      // a near miss: one tile away from the clue. Count it by how likely you are to know it.
      for (const w of words) N += Math.min(Math.max((zipfOf(w) - 1) / 5, 0), 1);
    }
  }
  const { G, Y, X } = shapeOf(guess, pattern, answer);
  return { U, C: zipfOf(answer), X, Y, N: Math.round(N * 100) / 100, G };
}

function percentileRanks(values) {
  // 0 for the smallest value, 1 for the largest. Equal values share the average rank.
  const order = values.map((_, i) => i).sort((a, b) => values[a] - values[b]);
  const rank = new Array(values.length);
  for (let k = 0; k < order.length; ) {
    let end = k;
    while (end + 1 < order.length && values[order[end + 1]] === values[order[k]]) end++;
    for (let j = k; j <= end; j++) rank[order[j]] = (k + end) / 2 / (values.length - 1);
    k = end + 1;
  }
  return rank;
}

function difficulty(puzzles) {
  // Turn each measure into a percentile rank across every kept puzzle, then add them up.
  // Rarer answers are harder, so C is ranked on minus commonness.
  const rank = (key, sign) => percentileRanks(puzzles.map((p) => sign * p[key]));
  const U = rank("U", 1), C = rank("C", -1), X = rank("X", 1), Y = rank("Y", 1), N = rank("N", 1);
  const D = puzzles.map((_, i) => 0.30 * U[i] + 0.20 * C[i] + 0.25 * X[i] + 0.10 * Y[i] + 0.15 * N[i]);
  // The bands are the four quarters of D.
  const sorted = [...D].sort((a, b) => a - b);
  const quantile = (q) => {
    const x = q * (sorted.length - 1), lo = Math.floor(x), hi = Math.min(lo + 1, sorted.length - 1);
    return sorted[lo] + (sorted[hi] - sorted[lo]) * (x - lo);
  };
  const cuts = [0.25, 0.5, 0.75].map(quantile);
  const bands = ["gentle", "medium", "tricky", "fiendish"];
  return D.map((d) => ({ D: d, band: bands[cuts.filter((c) => d >= c).length] }));
}
