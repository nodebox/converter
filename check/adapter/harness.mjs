// Bridges the Java test harness and a converted module: Java arguments in, Java values out.
import { fromJava, toJava, Context, rng } from './nodebox.mjs';

const JList = Java.type('java.util.List');
const JMap = Java.type('java.util.Map');
const JNodeContext = Java.type('nodebox.node.NodeContext');

function argFromJava(j) {
  if (j === null || j === undefined) return null;
  if (typeof j === 'number' || typeof j === 'string' || typeof j === 'boolean') return j;
  if (typeof j === 'bigint') return Number(j);
  if (j instanceof JNodeContext) {
    const lib = j.getNodeLibrary();
    return new Context({ canvasWidth: Number(lib.getProperty('canvasWidth')), canvasHeight: Number(lib.getProperty('canvasHeight')), frame: j.getFrame() });
  }
  if (j instanceof JList) { const out = []; for (const x of j) out.push(argFromJava(x)); return out; }
  if (j instanceof JMap) { const out = {}; for (const k of j.keySet()) out[k] = argFromJava(j.get(k)); return out; }
  if (Java.isJavaObject(j) && j.getClass().getName() === 'java.lang.Long') return Number(j);
  return fromJava(j);
}

function resultToJava(v) {
  if (v === undefined) return null;
  if (typeof v === 'function') return '<function>';
  if (v && typeof v[Symbol.iterator] === 'function' && typeof v !== 'string' && !Array.isArray(v) && !(v instanceof Map) && !(v instanceof Set)) v = Array.from(v);
  if (Array.isArray(v)) return toJava(v.map(resultToJava).map(x => x));
  return toJava(v);
}

export function call(fn, args) {
  rng.seed(0);
  const jsArgs = [];
  for (const a of args) jsArgs.push(argFromJava(a));
  return resultToJava(fn(...jsArgs));
}
