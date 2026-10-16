import net.minidev.json.JSONArray;
import net.minidev.json.JSONObject;
import net.minidev.json.JSONValue;
import nodebox.function.Function;
import nodebox.function.FunctionLibrary;
import nodebox.graphics.*;
import nodebox.node.Node;
import nodebox.node.NodeContext;
import nodebox.node.NodeLibrary;
import org.graalvm.polyglot.Context;
import org.graalvm.polyglot.Source;
import org.graalvm.polyglot.Value;
import org.python.core.*;

import java.io.File;
import java.lang.reflect.Array;
import java.nio.file.Files;
import java.util.*;

/**
 * Runs one module's test cases and prints canonical JSON results.
 *
 *   java Harness ref <job.json>   original Python/Clojure through NodeBox 3's own loaders
 *   java Harness js  <job.json>   converted JavaScript in GraalJS, over the same NodeBox Java classes
 *
 * job.json: {"lang":"python|clojure|js", "file": path, "adapter": dir with nodebox.mjs (js only),
 *            "functions": [{"name": "...", "jsName": "...", "cases": [[arg, ...], ...]}]}
 * An arg is typed JSON: {"int":3} {"float":1.5} {"str":"a"} {"bool":true} {"point":[x,y]}
 * {"color":[r,g,b,a]} {"fixture":"rect"} {"list":[...]} {"null":true}.
 */
public class Harness {

    public static void main(String[] a) throws Exception {
        String mode = a[0];
        JSONObject job = (JSONObject) JSONValue.parse(Files.readString(new File(a[1]).toPath()));
        JSONArray fns = (JSONArray) job.get("functions");
        JSONObject out = new JSONObject();
        Caller caller;
        try {
            caller = mode.equals("ref") ? refCaller(job) : jsCaller(job);
        } catch (Throwable t) {
            JSONObject err = new JSONObject();
            err.put("loadError", message(t));
            System.out.println(err.toJSONString());
            return;
        }
        for (Object o : fns) {
            JSONObject fn = (JSONObject) o;
            String name = (String) (mode.equals("js") && fn.get("jsName") != null ? fn.get("jsName") : fn.get("name"));
            JSONArray results = new JSONArray();
            for (Object c : (JSONArray) fn.get("cases")) {
                List<Object> args = new ArrayList<>();
                for (Object arg : (JSONArray) c) args.add(decode(arg));
                JSONObject r = new JSONObject();
                try {
                    r.put("value", canon(caller.call(name, args.toArray())));
                } catch (Throwable t) {
                    r.put("error", message(t));
                    if (System.getenv("TRACE") != null) t.printStackTrace();
                }
                results.add(r);
            }
            out.put((String) fn.get("name"), results);
        }
        System.out.println(out.toJSONString());
        System.exit(0);
    }

    interface Caller {
        Object call(String name, Object[] args) throws Exception;
    }

    static Caller refCaller(JSONObject job) throws Exception {
        File file = new File((String) job.get("file"));
        String lang = (String) job.get("lang");
        if (lang.equals("python")) {
            // NodeBox's own initializer needs a display; do the same setup without it.
            Properties props = new Properties();
            props.put("python.cachedir", System.getProperty("java.io.tmpdir") + "/_jythoncache");
            PySystemState.initialize(System.getProperties(), props, new String[]{""});
            Py.getSystemState().path.add(new PyString(new File(System.getProperty("nb.python", "src/main/python")).getAbsolutePath()));
            java.lang.reflect.Field f = Class.forName("nodebox.client.PythonUtils").getDeclaredField("isInitialized");
            f.setAccessible(true);
            ((java.util.concurrent.atomic.AtomicBoolean) f.get(null)).set(true);
        }
        // The same loader NodeBox 3 uses for <link rel="functions" href="python:...">.
        FunctionLibrary lib = FunctionLibrary.load(new File(file.getParentFile(), "x.ndbx"), lang + ":" + file.getName());
        return (name, args) -> {
            if (lang.equals("python")) {
                // A fixed seed for code that uses the module-level generator.
                PySystemState sys = Py.getSystemState();
                PyObject random = org.python.core.imp.importName("random", true);
                random.__getattr__("seed").__call__(Py.newInteger(0));
            }
            Function f = lib.getFunction(name);
            return f.invoke(args);
        };
    }

    static Caller jsCaller(JSONObject job) throws Exception {
        File adapter = new File((String) job.get("adapter")).getCanonicalFile();
        String src = Files.readString(new File((String) job.get("file")).toPath());
        String nb = adapter.toURI().resolve("nodebox.mjs").toString();
        String pf = adapter.toURI().resolve("platform.mjs").toString();
        src = src.replaceAll("from\\s+([\"'])nodebox/platform\\1", "from \"" + pf + "\"")
                 .replaceAll("from\\s+([\"'])nodebox\\1", "from \"" + nb + "\"");
        File tmp = File.createTempFile("conv", ".mjs");
        tmp.deleteOnExit();
        Files.writeString(tmp.toPath(), src);
        Context ctx = Context.newBuilder("js").allowAllAccess(true)
                .option("engine.WarnInterpreterOnly", "false")
                .option("js.esm-eval-returns-exports", "true")
                .build();
        Value mod = ctx.eval(Source.newBuilder("js", tmp).mimeType("application/javascript+module").build());
        File h = new File(adapter, "harness.mjs");
        Value harness = ctx.eval(Source.newBuilder("js", h).mimeType("application/javascript+module").build());
        Value call = harness.getMember("call");
        return (name, args) -> {
            Value fn = mod.getMember(name);
            if (fn == null || !fn.canExecute()) throw new RuntimeException("no exported function " + name);
            Value r = call.execute(fn, args);
            return r.isNull() ? null : r.as(Object.class);
        };
    }

    // ---- fixtures ----

    static Object fixture(String name) {
        switch (name) {
            case "rect": { Path p = new Path(); p.rect(0, 0, 100, 100); return p; }
            case "ellipse": { Path p = new Path(); p.ellipse(10, 20, 120, 80); return p; }
            case "polygon": {
                Path p = new Path();
                for (int i = 0; i < 10; i++) {
                    double r = i % 2 == 0 ? 100 : 40, t = Math.toRadians(i * 36 - 90);
                    if (i == 0) p.moveto(r * Math.cos(t), r * Math.sin(t)); else p.lineto(r * Math.cos(t), r * Math.sin(t));
                }
                p.close();
                return p;
            }
            case "curve": { Path p = new Path(); p.moveto(-100, 0); p.curveto(-50, -80, 50, 80, 100, 0); p.setFill(null); p.setStroke(Color.BLACK); return p; }
            case "two_contours": { Path p = new Path(); p.rect(0, 0, 200, 200); p.ellipse(0, 0, 80, 80); return p; }
            case "line": { Path p = new Path(); p.line(-50, -50, 50, 50); p.setFill(null); p.setStroke(Color.BLACK); return p; }
            case "geometry": { Geometry g = new Geometry(); g.add((Path) fixture("rect")); g.add((Path) fixture("ellipse")); return g; }
            case "points": {
                List<Point> l = new ArrayList<>();
                double[][] xy = {{0, 0}, {50, 10}, {80, 60}, {30, 90}, {-20, 70}, {-40, 20}, {10, 40}};
                for (double[] p : xy) l.add(new Point(p[0], p[1]));
                return l;
            }
            case "context": {
                NodeLibrary lib = NodeLibrary.create("test", Node.ROOT)
                        .withProperty("canvasWidth", "1000").withProperty("canvasHeight", "800");
                return new NodeContext(lib);
            }
            case "rows": {
                List<Map<String, Object>> rows = new ArrayList<>();
                String[][] r = {{"a", "1", "x"}, {"b", "2", "y"}, {"c", "3", "x"}};
                for (String[] row : r) {
                    Map<String, Object> m = new LinkedHashMap<>();
                    m.put("name", row[0]); m.put("value", Double.parseDouble(row[1])); m.put("group", row[2]);
                    rows.add(m);
                }
                return rows;
            }
        }
        throw new IllegalArgumentException("unknown fixture " + name);
    }

    static Object decode(Object o) {
        if (o == null) return null;
        JSONObject j = (JSONObject) o;
        if (j.containsKey("int")) return ((Number) j.get("int")).longValue();
        if (j.containsKey("float")) return ((Number) j.get("float")).doubleValue();
        if (j.containsKey("str")) return j.get("str");
        if (j.containsKey("bool")) return j.get("bool");
        if (j.containsKey("null")) return null;
        if (j.containsKey("point")) { JSONArray p = (JSONArray) j.get("point"); return new Point(num(p.get(0)), num(p.get(1))); }
        if (j.containsKey("color")) { JSONArray c = (JSONArray) j.get("color"); return new Color(num(c.get(0)), num(c.get(1)), num(c.get(2)), num(c.get(3))); }
        if (j.containsKey("fixture")) return fixture((String) j.get("fixture"));
        if (j.containsKey("list")) {
            List<Object> l = new ArrayList<>();
            for (Object x : (JSONArray) j.get("list")) l.add(decode(x));
            return Collections.unmodifiableList(l);
        }
        throw new IllegalArgumentException("bad arg " + j);
    }

    static double num(Object o) { return ((Number) o).doubleValue(); }

    // ---- canonical output ----

    static Object canon(Object o) {
        if (o == null) return null;
        if (o instanceof PyObject) {
            PyObject p = (PyObject) o;
            if (p == Py.None) return null;
            if (p instanceof PyBoolean) return ((PyBoolean) p).getBooleanValue();
            if (p instanceof PyInteger || p instanceof PyLong || p instanceof PyFloat) return num(p.__float__().getValue());
            if (p instanceof PyString) return p.toString();
            if (p instanceof PyDictionary) {
                Map<String, Object> m = new TreeMap<>();
                for (PyObject k : ((PyDictionary) p).keys().asIterable()) m.put(keyString(canon(k)), canon(p.__getitem__(k)));
                return m;
            }
            if (p instanceof PySet || p instanceof PyFrozenSet) return setOf(p.asIterable());
            Object j = p.__tojava__(Object.class);
            if (j != Py.NoConversion && !(j instanceof PyObject)) return canon(j);
            try {
                List<Object> l = new ArrayList<>();
                for (PyObject x : p.asIterable()) l.add(canon(x));
                return l;
            } catch (PyException e) {
                return other(p.getType().getName(), p.toString());
            }
        }
        if (o instanceof Number) return num(((Number) o).doubleValue());
        if (o instanceof Boolean || o instanceof String) return o;
        if (o instanceof Character) return o.toString();
        if (o instanceof clojure.lang.Keyword) return ((clojure.lang.Keyword) o).getName();
        if (o instanceof Point) return tagged("$pt", list(((Point) o).x, ((Point) o).y, ((Point) o).type));
        if (o instanceof Color) { Color c = (Color) o; return tagged("$color", list(c.getR(), c.getG(), c.getB(), c.getA())); }
        if (o instanceof Rect) { Rect r = (Rect) o; return tagged("$rect", list(r.x, r.y, r.width, r.height)); }
        if (o instanceof Path) return tagged("$path", path((Path) o));
        if (o instanceof Contour) return tagged("$contour", contour((Contour) o));
        if (o instanceof Geometry) {
            List<Object> l = new ArrayList<>();
            for (Path p : ((Geometry) o).getPaths()) l.add(path(p));
            return tagged("$geo", l);
        }
        if (o instanceof Map) {
            Map<String, Object> m = new TreeMap<>();
            for (Map.Entry<?, ?> e : ((Map<?, ?>) o).entrySet()) m.put(keyString(canon(e.getKey())), canon(e.getValue()));
            return m;
        }
        if (o instanceof Set) return setOf((Set<?>) o);
        if (o instanceof Iterable) {
            List<Object> l = new ArrayList<>();
            for (Object x : (Iterable<?>) o) l.add(canon(x));
            return l;
        }
        if (o.getClass().isArray()) {
            List<Object> l = new ArrayList<>();
            for (int i = 0; i < Array.getLength(o); i++) l.add(canon(Array.get(o, i)));
            return l;
        }
        return other(o.getClass().getName(), String.valueOf(o));
    }

    static Object num(double d) {
        if (Double.isNaN(d) || Double.isInfinite(d)) return tagged("$num", String.valueOf(d));
        return d;
    }

    static String keyString(Object k) {
        if (k instanceof Double && ((Double) k) == Math.rint((Double) k)) return String.valueOf(((Double) k).longValue());
        return k instanceof String ? (String) k : JSONValue.toJSONString(k);
    }

    static Object setOf(Iterable<?> it) {
        List<String> l = new ArrayList<>();
        for (Object x : it) l.add(JSONValue.toJSONString(canon(x)));
        Collections.sort(l);
        List<Object> out = new ArrayList<>();
        for (String s : l) out.add(JSONValue.parse(s));
        return tagged("$set", out);
    }

    static Map<String, Object> path(Path p) {
        Map<String, Object> m = new LinkedHashMap<>();
        List<Object> cs = new ArrayList<>();
        for (Contour c : p.getContours()) cs.add(contour(c));
        m.put("contours", cs);
        m.put("fill", p.getFill() == null ? null : canon(p.getFill()));
        m.put("stroke", p.getStroke() == null ? null : canon(p.getStroke()));
        m.put("strokeWidth", p.getStrokeWidth());
        return m;
    }

    static Map<String, Object> contour(Contour c) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("closed", c.isClosed());
        List<Object> pts = new ArrayList<>();
        for (Point p : c.getPoints()) pts.add(list(p.x, p.y, p.type));
        m.put("points", pts);
        return m;
    }

    static List<Object> list(Object... xs) { return new ArrayList<>(Arrays.asList(xs)); }

    static Map<String, Object> tagged(String tag, Object v) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put(tag, v);
        return m;
    }

    static Map<String, Object> other(String type, String repr) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("$other", type);
        m.put("repr", repr.length() > 200 ? repr.substring(0, 200) : repr);
        return m;
    }

    static String message(Throwable t) {
        while (t.getCause() != null && t.getCause() != t && !(t instanceof PyException)) t = t.getCause();
        String s = t.toString();
        if (t instanceof PyException) {
            // The last line of a Python traceback is the exception itself.
            String[] lines = s.trim().split("\n");
            s = lines[lines.length - 1];
        }
        return s.length() > 600 ? s.substring(0, 600) : s;
    }
}
