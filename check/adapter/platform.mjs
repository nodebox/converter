// Draft "nodebox/platform": the only door to files, fonts and the clock. Kept separate so a
// function that imports it is visibly not pure. Paths are relative to the document's folder.
import { Color } from './nodebox.mjs';

const JFile = Java.type('java.io.File');
const Files = Java.type('java.nio.file.Files');
const Paths = Java.type('java.nio.file.Paths');
const JString = Java.type('java.lang.String');
const ImageIO = Java.type('javax.imageio.ImageIO');
const GraphicsEnvironment = Java.type('java.awt.GraphicsEnvironment');
const System = Java.type('java.lang.System');

function file(path) { return new JFile(String(path)); }

export function exists(path) { return file(path).exists(); }
export function isDirectory(path) { return file(path).isDirectory(); }

/** Names of the entries in a folder, in the order the file system returns them. */
export function listDir(path) {
  const names = file(path).list();
  if (names === null) throw new Error(`not a folder: ${path}`);
  return Array.from(names, String);
}

export function readText(path) { return String(Files.readString(Paths.get(String(path)))); }
export function writeText(path, text) { Files.writeString(Paths.get(String(path)), new JString(String(text))); }

/** Decodes an image file. pixel(x, y) returns a Color. */
export function readImage(path) {
  const img = ImageIO.read(file(path));
  if (img === null) throw new Error(`not an image: ${path}`);
  return {
    width: img.getWidth(),
    height: img.getHeight(),
    pixel(x, y) {
      const argb = img.getRGB(x, y);
      return new Color(((argb >> 16) & 255) / 255, ((argb >> 8) & 255) / 255, (argb & 255) / 255, ((argb >>> 24) & 255) / 255);
    },
  };
}

/** Installed font family names. */
export function fonts() { return Array.from(GraphicsEnvironment.getLocalGraphicsEnvironment().getAvailableFontFamilyNames(), String); }

/** Milliseconds since 1970, like Date.now(). */
export function now() { return Number(System.currentTimeMillis()); }

/** The user's home folder, for code that builds paths like ~/Desktop/data.csv. */
export function homeDir() { return String(System.getenv('HOME') || System.getProperty('user.home')); }

// Dates, in the local time zone. formatDate and parseDate take java.text.SimpleDateFormat patterns
// (which Clojure code uses); strftime takes Python's time.strftime codes.
const SimpleDateFormat = Java.type('java.text.SimpleDateFormat');
const JDate = Java.type('java.util.Date');

/** Formats milliseconds since 1970 with a SimpleDateFormat pattern ("yyyy-MM-dd HH:mm"). */
export function formatDate(ms, pattern) { return String(new SimpleDateFormat(pattern).format(new JDate(Math.trunc(ms)))); }

/** Parses text with a SimpleDateFormat pattern, as leniently as Java does. Returns milliseconds since 1970. */
export function parseDate(text, pattern) { return Number(new SimpleDateFormat(pattern).parse(String(text)).getTime()); }

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** Python's time.strftime(format, time.localtime(ms / 1000)), for the C-locale codes. */
export function strftime(format, ms) {
  const d = new Date(ms);
  const pad = (n, w = 2) => String(n).padStart(w, '0');
  const start = new Date(d.getFullYear(), 0, 1);
  const yday = Math.round((new Date(d.getFullYear(), d.getMonth(), d.getDate()) - start) / 86400000) + 1;
  const codes = {
    a: DAYS[d.getDay()].slice(0, 3), A: DAYS[d.getDay()], b: MONTHS[d.getMonth()].slice(0, 3), B: MONTHS[d.getMonth()],
    d: pad(d.getDate()), H: pad(d.getHours()), I: pad(d.getHours() % 12 || 12), j: pad(yday, 3), m: pad(d.getMonth() + 1),
    M: pad(d.getMinutes()), p: d.getHours() < 12 ? 'AM' : 'PM', S: pad(d.getSeconds()), w: String(d.getDay()),
    y: pad(d.getFullYear() % 100), Y: String(d.getFullYear()), '%': '%',
  };
  return format.replace(/%(.)/g, (m, c) => (c in codes ? codes[c] : m));
}
