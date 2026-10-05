// localStorage kann fehlen oder werfen (privates Fenster, gesperrte Daten).
// Alles hier ist Komfort; die App läuft auch ohne.

export const storage = {
  get(key) {
    try { return localStorage.getItem(key); } catch (e) { return null; }
  },
  set(key, value) {
    try { localStorage.setItem(key, value); } catch (e) { /* egal */ }
  },
  remove(key) {
    try { localStorage.removeItem(key); } catch (e) { /* egal */ }
  },
  getJSON(key) {
    try { return JSON.parse(this.get(key)); } catch (e) { return null; }
  },
  setJSON(key, value) {
    this.set(key, JSON.stringify(value));
  },
};
