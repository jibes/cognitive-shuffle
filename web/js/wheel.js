// Horizontales Rad für die Dauer: Zahlen in festen Schritten, die mittlere rastet ein.
// Wischen (Scroll-Snap), Tippen auf eine Zahl, Pfeiltasten; für Screenreader ein Slider.
export function createWheel(el, { min, max, step, value, onChange }) {
  const track = el.querySelector(".track");
  for (let v = min; v <= max; v += step) {
    const it = document.createElement("div");
    it.className = "item";
    it.dataset.min = String(v);
    it.textContent = String(v);
    it.addEventListener("click", () => select(v, true));
    track.appendChild(it);
  }
  const item = v => track.querySelector(`[data-min="${v}"]`);
  let current = null, settle = 0;

  function center(v, smooth) {
    const it = item(v);
    el.scrollTo({ left: it.offsetLeft + it.offsetWidth / 2 - el.clientWidth / 2, behavior: smooth ? "smooth" : "auto" });
  }
  function mark(v) {
    if (v === current) return;
    if (current != null) item(current).classList.remove("on");
    current = v;
    item(v).classList.add("on");
    el.setAttribute("aria-valuenow", String(v));
    onChange(v);
  }
  function select(v, smooth) {
    v = Math.min(max, Math.max(min, v));
    mark(v);
    center(v, smooth);
  }
  // Nach dem Wischen: die Zahl in der Mitte gilt
  el.addEventListener("scroll", () => {
    clearTimeout(settle);
    settle = setTimeout(() => {
      const mid = el.scrollLeft + el.clientWidth / 2;
      let best = current, dist = Infinity;
      for (const it of track.children) {
        const d = Math.abs(it.offsetLeft + it.offsetWidth / 2 - mid);
        if (d < dist) { dist = d; best = Number(it.dataset.min); }
      }
      mark(best);
    }, 90);
  }, { passive: true });
  el.addEventListener("keydown", e => {
    const d = { ArrowLeft: -step, ArrowDown: -step, ArrowRight: step, ArrowUp: step }[e.key];
    if (d) { e.preventDefault(); select(current + d, true); }
    if (e.key === "Home") { e.preventDefault(); select(min, true); }
    if (e.key === "End") { e.preventDefault(); select(max, true); }
  });
  el.setAttribute("role", "slider");
  el.setAttribute("aria-valuemin", String(min));
  el.setAttribute("aria-valuemax", String(max));
  el.tabIndex = 0;
  mark(value);
  // Erst zentrieren, wenn das Rad sichtbar ist und Maße hat
  const recenter = () => { if (el.clientWidth) center(current, false); };
  new ResizeObserver(recenter).observe(el);

  return {
    get value() { return current; },
    recenter,
    setUnit(text) { el.setAttribute("aria-valuetext", `${current} ${text}`); },
  };
}
