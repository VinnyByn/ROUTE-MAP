// Google Maps mínimo para testes que precisam criar marcadores, cabos e polígonos sem internet.
// Qualquer método não implementado vira uma função que não faz nada.
(() => {
  class LatLng { constructor(lat, lng) { if (typeof lat === 'object') { lng = lat.lng; lat = lat.lat; } this._a = +lat; this._o = +lng; }
    lat() { return this._a; } lng() { return this._o; } equals(o) { return o && o.lat() === this._a && o.lng() === this._o; } toJSON() { return { lat: this._a, lng: this._o }; } }
  const toLL = (p) => (p instanceof LatLng ? p : new LatLng(p));
  //Ouvintes guardados: google.maps.event.__fire(objeto, 'evento', ...args) dispara nos testes (o trigger segue sem efeito)
  const listen = (store, name, fn) => { (store[name] ||= []).push(fn); return { remove() { store[name] = (store[name] || []).filter(f => f !== fn); } }; };
  const fire = (store, name, ...args) => (store?.[name] || []).slice().forEach(f => f(...args));
  class MVCArray { constructor(a = []) { this.a = (a instanceof MVCArray ? a.getArray() : a).map(toLL); this.ls = {}; } getArray() { return this.a; } getLength() { return this.a.length; } getAt(i) { return this.a[i]; }
    addListener(name, fn) { return listen(this.ls, name, fn); }
    forEach(f) { this.a.forEach(f); } push(p) { this.a.push(toLL(p)); fire(this.ls, 'insert_at', this.a.length - 1); } setAt(i, p) { const old = this.a[i]; this.a[i] = toLL(p); fire(this.ls, 'set_at', i, old); }
    insertAt(i, p) { this.a.splice(i, 0, toLL(p)); fire(this.ls, 'insert_at', i); } removeAt(i) { const [old] = this.a.splice(i, 1); fire(this.ls, 'remove_at', i, old); }
    clear() { while (this.a.length) this.removeAt(this.a.length - 1); } }
  const generic = (extra = {}) => function (opts = {}) {
    const self = { o: { ...opts }, ...extra };
    const proxy = new Proxy(self, { get(t, k) {
      if (k in t) return t[k];
      if (typeof k === 'string' && /^get[A-Z]/.test(k)) { const f = k[3].toLowerCase() + k.slice(4); return () => t.o[f]; }
      if (typeof k === 'string' && /^set[A-Z]/.test(k)) { const f = k[3].toLowerCase() + k.slice(4); return (v) => { t.o[f] = v; }; }
      return () => ({ remove() {} });
    } });
    self.get = (k) => self.o[k]; self.set = (k, v) => { self.o[k] = v; };
    self.setOptions = (o) => Object.assign(self.o, o);
    self.ls = {};
    self.addListener = (name, fn) => listen(self.ls, name, fn);
    self.bindTo = () => {};
    return proxy;
  };
  function Marker(opts = {}) { const m = generic()(opts); if (opts.position) m.o.position = toLL(opts.position); m.o.visible = opts.visible !== false; m.getVisible = () => m.o.visible !== false; m.getPosition = () => m.o.position; m.setPosition = (p) => { m.o.position = toLL(p); }; return m; }
  function Poly(opts = {}) { const p = generic()(opts); p.o.path = new MVCArray(opts.path || opts.paths || []); p.getPath = () => p.o.path; p.setPath = (a) => { p.o.path = new MVCArray(a instanceof MVCArray ? a.getArray() : a); }; p.getVisible = () => p.o.visible !== false; return p; }
  const R = 6371000, rad = (d) => d * Math.PI / 180;
  const dist = (a, b) => { const x = rad(b.lng() - a.lng()) * Math.cos(rad((a.lat() + b.lat()) / 2)); const y = rad(b.lat() - a.lat()); return Math.sqrt(x * x + y * y) * R; };
  class LatLngBounds { constructor() { this.pts = []; } extend(p) { this.pts.push(toLL(p)); return this; } isEmpty() { return !this.pts.length; }
    contains(p) { if (!this.pts.length) return false; const la = this.pts.map(x => x.lat()), lo = this.pts.map(x => x.lng()); return p.lat() >= Math.min(...la) && p.lat() <= Math.max(...la) && p.lng() >= Math.min(...lo) && p.lng() <= Math.max(...lo); }
    getCenter() { const p = this.pts[0]; return p; } getNorthEast() { return this.pts[0]; } getSouthWest() { return this.pts[0]; } }
  window.google = { maps: {
    LatLng, MVCArray, LatLngBounds, Marker, Polyline: Poly, Polygon: Poly, Rectangle: generic(), Circle: generic(), InfoWindow: generic(), Map: generic(),
    Size: function (w, h) { this.width = w; this.height = h; }, Point: function (x, y) { this.x = x; this.y = y; },
    SymbolPath: { CIRCLE: 0, FORWARD_CLOSED_ARROW: 1 }, Animation: { DROP: 1, BOUNCE: 2 }, ControlPosition: { TOP_LEFT: 1 },
    event: { addListener: () => ({ remove() {} }), addListenerOnce: () => ({ remove() {} }), removeListener(l) { l?.remove?.(); }, clearInstanceListeners() {}, clearListeners() {}, trigger() {},
      __fire: (obj, name, ...args) => fire(obj?.ls, name, ...args) },
    geometry: { spherical: {
      computeDistanceBetween: (a, b) => dist(toLL(a), toLL(b)),
      computeLength: (path) => { const a = path.getArray ? path.getArray() : path; let s = 0; for (let i = 1; i < a.length; i++) s += dist(toLL(a[i - 1]), toLL(a[i])); return s; },
      interpolate: (a, b, t) => new LatLng(a.lat() + (b.lat() - a.lat()) * t, a.lng() + (b.lng() - a.lng()) * t),
      computeArea: () => 0, computeHeading: () => 0,
    } },
  } };
})();
