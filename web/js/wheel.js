// Horizontales Rad für die Dauer: Zahlen in festen Schritten, die mittlere rastet ein.
// Wischen (Scroll-Snap), Tippen auf eine Zahl, Pfeiltasten; für Screenreader ein Slider.
export function createWheel(el, { min, max, step, value, onChange }) {
  const track = el.querySelector(".track");
  for (let v = min; v <= max; v += step) {
    const it = document.createElement("div");
    it.className = "item";
    it.dataset.min = String(v);
    it.textContent = String(v);
    it.addEventListener("click", () => { if (!justDragged) select(v, true); });
    track.appendChild(it);
  }
  const item = v => track.querySelector(`[data-min="${v}"]`);
  let current = null, settle = 0, justDragged = false;
  let target = null;  // Ziel einer programmgesteuerten Bewegung: Zwischenstände nicht übernehmen

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
    target = smooth ? v : null;
    center(v, smooth);
  }
  el.addEventListener("touchstart", () => { target = null; }, { passive: true });  // Nutzer wischt selbst

  // Desktop: Mausrad (senkrecht oder waagrecht) dreht in Schritten
  let wheelAcc = 0;
  el.addEventListener("wheel", e => {
    e.preventDefault();
    wheelAcc += Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
    const steps = Math.trunc(wheelAcc / 40);
    if (steps) { wheelAcc -= steps * 40; select((target ?? current) + steps * step, true); }
  }, { passive: false });

  // Desktop: mit der Maus ziehen; danach rastet die nächste Zahl ein
  let drag = null;
  el.addEventListener("pointerdown", e => {
    target = null;
    if (e.pointerType !== "mouse" || e.button !== 0) return;
    drag = { x: e.clientX, left: el.scrollLeft, moved: false, id: e.pointerId };
  });
  el.addEventListener("pointermove", e => {
    if (!drag) return;
    const dx = e.clientX - drag.x;
    if (Math.abs(dx) > 4 && !drag.moved) {  // erst jetzt fangen, sonst landet ein Klick nicht auf der Zahl
      drag.moved = true;
      el.classList.add("dragging");
      el.setPointerCapture(drag.id);
    }
    if (drag.moved) el.scrollLeft = drag.left - dx;
  });
  const endDrag = () => {
    if (!drag) return;
    const moved = drag.moved;
    drag = null;
    el.classList.remove("dragging");
    if (!moved) return;
    select(nearest(), true);
    justDragged = true;  // der Klick am Ende des Ziehens ist kein Tipp auf eine Zahl
    setTimeout(() => { justDragged = false; }, 0);
  };
  el.addEventListener("pointerup", endDrag);
  el.addEventListener("pointercancel", endDrag);
  function nearest() {
    const mid = el.scrollLeft + el.clientWidth / 2;
    let best = current, dist = Infinity;
    for (const it of track.children) {
      const d = Math.abs(it.offsetLeft + it.offsetWidth / 2 - mid);
      if (d < dist) { dist = d; best = Number(it.dataset.min); }
    }
    return best;
  }
  // Nach dem Wischen: die Zahl in der Mitte gilt
  el.addEventListener("scroll", () => {
    clearTimeout(settle);
    settle = setTimeout(() => {
      if (drag) return;
      const best = nearest();
      if (target != null) { if (best === target) target = null; return; }
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
