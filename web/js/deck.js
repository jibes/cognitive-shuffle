// Gemischter Stapel: kein Wort wiederholt sich, bis die Liste einmal durch ist –
// auch über mehrere Nächte, wenn der Stand gespeichert wird.

export function shuffle(items, rng = Math.random) {
  const a = items.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function freshDeck(words, rng) {
  return { order: shuffle(words, rng), pos: 0 };
}

// Gespeicherter Stand passt nur, wenn er genau dieselbe Wortmenge enthält.
export function validDeck(deck, words) {
  if (!deck || !Array.isArray(deck.order) || !Number.isInteger(deck.pos) || deck.pos < 0) return false;
  if (deck.order.length !== words.length) return false;
  const set = new Set(words);
  return deck.order.every(w => set.has(w));
}

// Zieht n Wörter, ohne den Eingabestand zu verändern; liefert den neuen Stand.
export function draw(deck, words, n, rng) {
  let order = deck.order, pos = deck.pos;
  const out = [];
  while (out.length < n) {
    if (pos >= order.length) {
      order = shuffle(words, rng);
      pos = 0;
      if (order[0] === out[out.length - 1]) order.push(order.shift());
    }
    out.push(order[pos++]);
  }
  return { words: out, deck: { order, pos } };
}
