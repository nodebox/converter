// Draft NodeBox 4 JavaScript API, test implementation.
// Runs in GraalJS on the JVM and delegates geometry to the NodeBox 3 Java classes, so a converted
// function is checked against exactly the semantics the original Python or Clojure code had.

const JPath = Java.type('nodebox.graphics.Path');
const JPoint = Java.type('nodebox.graphics.Point');
const JColor = Java.type('nodebox.graphics.Color');
const JGeometry = Java.type('nodebox.graphics.Geometry');
const JRect = Java.type('nodebox.graphics.Rect');
const JContour = Java.type('nodebox.graphics.Contour');
const JTransform = Java.type('nodebox.graphics.Transform');
const ArrayList = Java.type('java.util.ArrayList');
const LinkedHashMap = Java.type('java.util.LinkedHashMap');
const LinkedHashSet = Java.type('java.util.LinkedHashSet');

const POINT_TYPES = { 1: 'line', 2: 'curve', 3: 'control' };
const POINT_CODES = { line: 1, curve: 2, control: 3 };

export class Point {
  constructor(x = 0, y = 0, type = 'line') {
    this.x = Number(x);
    this.y = Number(y);
    this.type = type;
    Object.freeze(this);
  }
  moved(dx, dy) { return new Point(this.x + dx, this.y + dy, this.type); }
  equals(o) { return o instanceof Point && o.x === this.x && o.y === this.y; }
  toString() { return `Point(${this.x}, ${this.y})`; }
}

export class Color {
  constructor(r = 0, g = r, b = r, a = 1) {
    this.r = clamp01(r); this.g = clamp01(g); this.b = clamp01(b); this.a = clamp01(a);
    Object.freeze(this);
  }
  static fromHSB(h, s, v, a = 1) { return fromJava(JColor.fromHSB(h, s, v, a)); }
  static fromHex(hex) { return fromJava(JColor.valueOf(hex)); }
  get visible() { return this.a > 0; }
  toString() { return `Color(${this.r}, ${this.g}, ${this.b}, ${this.a})`; }
}
Color.BLACK = new Color(0, 0, 0, 1);
Color.WHITE = new Color(1, 1, 1, 1);

function clamp01(v) { v = Number(v); return v < 0 ? 0 : v > 1 ? 1 : v; }

export class Rect {
  constructor(x = 0, y = 0, width = 0, height = 0) {
    this.x = x; this.y = y; this.width = width; this.height = height;
    Object.freeze(this);
  }
  static centered(cx, cy, width, height) { return new Rect(cx - width / 2, cy - height / 2, width, height); }
  get centroid() { return new Point(this.x + this.width / 2, this.y + this.height / 2); }
  get isEmpty() { return this.width <= 0 || this.height <= 0; }
  contains(p) { return toJava(this).contains(toJava(p)); }
  intersects(r) { return toJava(this).intersects(toJava(r)); }
  united(r) { return fromJava(toJava(this).united(toJava(r))); }
}

class Shape {
  get bounds() { return fromJava(this._j.getBounds()); }
  get length() { return this._j.getLength(); }
  get points() { return listFromJava(this._j.getPoints()); }
  get pointCount() { return this._j.getPointCount(); }
  pointAt(t) { return fromJava(this._j.pointAt(t)); }
  makePoints(amount, perContour = false) { return listFromJava(this._j.makePoints(amount, perContour)); }
  contains(a, b) { return b === undefined ? this._j.contains(toJava(a)) : this._j.contains(a, b); }
}

export class Contour extends Shape {
  constructor(points = [], closed = false) {
    super();
    if (points instanceof JContour) { this._j = points; return; }
    const l = new ArrayList();
    for (const p of points) l.add(toJava(p));
    this._j = new JContour(l, closed);
  }
  get closed() { return this._j.isClosed(); }
  close() { this._j.close(); }
  addPoint(a, b) { this._j.addPoint(b === undefined ? toJava(a) : new JPoint(a, b)); }
  clone() { return new Contour(this._j.clone()); }
}

export class Path extends Shape {
  constructor(source) {
    super();
    if (source === undefined || source === null) this._j = new JPath();
    else if (source instanceof JPath) this._j = source;
    else if (source instanceof Path) this._j = new JPath(source._j);
    else if (source instanceof Contour) this._j = new JPath(source._j);
    else if (Array.isArray(source)) { this._j = new JPath(); for (const p of source) this._j.addPoint(toJava(p)); }
    else throw new TypeError('Path() takes a Path, a Contour or an array of points');
  }
  get fill() { return fromJava(this._j.getFill()); }
  set fill(c) { this._j.setFill(toJava(c)); }
  get stroke() { return fromJava(this._j.getStroke()); }
  set stroke(c) { this._j.setStroke(toJava(c)); }
  get strokeWidth() { return this._j.getStrokeWidth(); }
  set strokeWidth(w) { this._j.setStrokeWidth(w); }
  get contours() { return listFromJava(this._j.getContours()); }
  get closed() { return this._j.isClosed(); }
  get isEmpty() { return this._j.isEmpty(); }
  moveTo(x, y) { this._j.moveto(x, y); return this; }
  lineTo(x, y) { this._j.lineto(x, y); return this; }
  curveTo(x1, y1, x2, y2, x3, y3) { this._j.curveto(x1, y1, x2, y2, x3, y3); return this; }
  close() { this._j.close(); return this; }
  newContour() { this._j.newContour(); return this; }
  addPoint(a, b) { this._j.addPoint(b === undefined ? toJava(a) : new JPoint(a, b)); return this; }
  rect(cx, cy, width, height, rx, ry) {
    if (rx === undefined) this._j.rect(cx, cy, width, height);
    else this._j.rect(cx, cy, width, height, rx, ry === undefined ? rx : ry);
    return this;
  }
  cornerRect(x, y, width, height) { this._j.cornerRect(x, y, width, height); return this; }
  ellipse(cx, cy, width, height) { this._j.ellipse(cx, cy, width, height); return this; }
  cornerEllipse(x, y, width, height) { this._j.cornerEllipse(x, y, width, height); return this; }
  line(x1, y1, x2, y2) { this._j.line(x1, y1, x2, y2); return this; }
  addContour(c) { this._j.add(toJava(c)); return this; }
  extend(p) { this._j.extend(toJava(p)); return this; }
  resampleByAmount(amount, perContour = false) { return fromJava(this._j.resampleByAmount(amount, perContour)); }
  resampleByLength(len) { return fromJava(this._j.resampleByLength(len)); }
  intersects(p) { return this._j.intersects(toJava(p)); }
  united(p) { return fromJava(this._j.united(toJava(p))); }
  subtracted(p) { return fromJava(this._j.subtracted(toJava(p))); }
  intersected(p) { return fromJava(this._j.intersected(toJava(p))); }
  transformed(t) { return fromJava(t._j.map(this._j)); }
  clone() { return fromJava(this._j.clone()); }
  mapPoints(fn) {
    const out = this._j.cloneAndClear();
    let i = 0;
    for (const c of this._j.getContours()) {
      const pts = new ArrayList();
      for (const p of c.getPoints()) pts.add(toJava(fn(fromJava(p), i++)));
      out.add(new JContour(pts, c.isClosed()));
    }
    return new Path(out);
  }
}

export class Geometry extends Shape {
  constructor(paths) {
    super();
    if (paths instanceof JGeometry) { this._j = paths; return; }
    this._j = new JGeometry();
    if (paths) for (const p of paths) this.add(p);
  }
  get paths() { return listFromJava(this._j.getPaths()); }
  get size() { return this._j.size(); }
  get isEmpty() { return this._j.isEmpty(); }
  add(p) { this._j.add(toJava(p)); return this; }
  extend(g) { this._j.extend(toJava(g)); return this; }
  set fill(c) { this._j.setFill(toJava(c)); }
  set stroke(c) { this._j.setStroke(toJava(c)); }
  set strokeWidth(w) { this._j.setStrokeWidth(w); }
  resampleByAmount(amount, perContour = false) { return fromJava(this._j.resampleByAmount(amount, perContour)); }
  transformed(t) { return fromJava(t._j.map(this._j)); }
  clone() { return fromJava(this._j.clone()); }
  mapPoints(fn) {
    let i = 0;
    return new Geometry(this.paths.map(p => p.mapPoints((pt) => fn(pt, i++))));
  }
}

export class Transform {
  constructor(j) { this._j = j || new JTransform(); }
  static identity() { return new Transform(); }
  static translate(x, y) { return new Transform(JTransform.translated(x, y)); }
  static rotate(degrees) { return new Transform(JTransform.rotated(degrees)); }
  static scale(sx, sy = sx) { return new Transform(JTransform.scaled(sx, sy)); }
  then(t) { const c = new JTransform(this._j); c.append(t._j); return new Transform(c); }
  apply(v) {
    if (Array.isArray(v)) return v.map(p => this.apply(p));
    return fromJava(this._j.map(toJava(v)));
  }
}

// Seeded random. In NodeBox 4 this is the core's single generator; this test build uses the
// NodeBox 3 (Jython 2.7) algorithm so that converted code can be compared value for value.
const MASK48 = (1n << 48n) - 1n;
export class Random {
  constructor(seed) {
    if (seed === undefined || seed === null) seed = Date.now();
    this.seed(seed);
  }
  seed(s) {
    let n;
    if (typeof s === 'bigint') n = s;
    else if (typeof s === 'number' && Number.isInteger(s)) n = BigInt(s);
    else if (typeof s === 'string') n = BigInt(javaStringHash(s));
    else n = BigInt(Math.trunc(Number(s)));
    if (n < -(2n ** 31n) || n >= 2n ** 31n) n = ((n % (2n ** 63n - 1n)) + (2n ** 63n - 1n)) % (2n ** 63n - 1n);
    this._s = (BigInt.asUintN(64, n) ^ 0x5DEECE66Dn) & MASK48;
    this._gauss = null;
  }
  _next(bits) {
    this._s = (this._s * 0x5DEECE66Dn + 0xBn) & MASK48;
    return Number(this._s >> BigInt(48 - bits));
  }
  random() {
    const a = this._next(32) >>> 5, b = this._next(32) >>> 6;
    return (a * 67108864 + b) * (1 / 9007199254740992);
  }
  uniform(a, b) { return a + (b - a) * this.random(); }
  randrange(start, stop, step = 1) {
    if (stop === undefined) return Math.trunc(this.random() * start);
    const width = stop - start;
    if (step === 1) return start + Math.trunc(this.random() * width);
    const n = step > 0 ? Math.floor((width + step - 1) / step) : Math.floor((width + step + 1) / step);
    return start + step * Math.trunc(this.random() * n);
  }
  randint(a, b) { return this.randrange(a, b + 1); }
  choice(seq) { return seq[Math.trunc(this.random() * seq.length)]; }
  shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) { const j = Math.trunc(this.random() * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; }
    return arr;
  }
  sample(population, k) {
    const n = population.length, result = new Array(k);
    let setsize = 21;
    if (k > 5) setsize += 4 ** Math.ceil(Math.log(k * 3) / Math.log(4));
    if (n <= setsize) {
      const pool = Array.from(population);
      for (let i = 0; i < k; i++) { const j = Math.trunc(this.random() * (n - i)); result[i] = pool[j]; pool[j] = pool[n - i - 1]; }
    } else {
      const selected = new Set();
      for (let i = 0; i < k; i++) { let j = Math.trunc(this.random() * n); while (selected.has(j)) j = Math.trunc(this.random() * n); selected.add(j); result[i] = population[j]; }
    }
    return result;
  }
  gauss(mu = 0, sigma = 1) {
    let z = this._gauss; this._gauss = null;
    if (z === null) {
      const x2pi = this.random() * 2 * Math.PI, g2rad = Math.sqrt(-2 * Math.log(1 - this.random()));
      z = Math.cos(x2pi) * g2rad; this._gauss = Math.sin(x2pi) * g2rad;
    }
    return mu + z * sigma;
  }
}
function javaStringHash(s) { let h = 0; for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0; return h; }

// What a node knows about the document it runs in.
export class Context {
  constructor({ canvasWidth = 1000, canvasHeight = 1000, frame = 1 } = {}) {
    this.canvasWidth = canvasWidth; this.canvasHeight = canvasHeight; this.frame = frame;
    Object.freeze(this);
  }
}

// The generator behind unseeded randomness. Code that needs reproducible output takes a seed and
// makes its own Random(seed); the host reseeds this one per evaluation.
export const rng = new Random(0);

// ---- conversion between this API and the Java objects (used by the test harness) ----

export function toJava(v) {
  if (v === undefined || v === null) return null;
  if (v instanceof Point) return new JPoint(v.x, v.y, POINT_CODES[v.type] || 1);
  if (v instanceof Color) return new JColor(v.r, v.g, v.b, v.a);
  if (v instanceof Rect) return new JRect(v.x, v.y, v.width, v.height);
  if (v instanceof Path || v instanceof Geometry || v instanceof Contour || v instanceof Transform) return v._j;
  if (v instanceof Set) { const s = new LinkedHashSet(); for (const x of v) s.add(toJava(x)); return s; }
  if (Array.isArray(v)) { const l = new ArrayList(); for (const x of v) l.add(toJava(x)); return l; }
  if (v instanceof Map) { const m = new LinkedHashMap(); for (const [k, x] of v) m.put(String(k), toJava(x)); return m; }
  if (typeof v === 'bigint') return Number(v);
  if (typeof v === 'object' && !Java.isJavaObject(v)) { const m = new LinkedHashMap(); for (const k of Object.keys(v)) m.put(k, toJava(v[k])); return m; }
  return v;
}

export function fromJava(j) {
  if (j === null || j === undefined) return null;
  if (j instanceof JPoint) return new Point(j.x, j.y, POINT_TYPES[j.type] || 'line');
  if (j instanceof JColor) return new Color(j.getR(), j.getG(), j.getB(), j.getA());
  if (j instanceof JRect) return new Rect(j.x, j.y, j.width, j.height);
  if (j instanceof JPath) return new Path(j);
  if (j instanceof JGeometry) return new Geometry(j);
  if (j instanceof JContour) return new Contour(j);
  return j;
}

function listFromJava(l) { const out = []; for (const x of l) out.push(fromJava(x)); return out; }
