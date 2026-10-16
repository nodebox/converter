"""Builds testset.json: every code module with the node signatures that call into it, plus generated
test inputs per function.

    python3 testset.py <forum_corpus.json> <forum_ports.json> <node library dir> <nl_inventory.json> > testset.json

Inputs come from the port types and default values in the .ndbx files that use each function. Each
function gets its stored defaults plus a few deterministic variations, so a conversion is checked on
more than one path through the code.
"""
import hashlib, json, os, random, re, sys
from collections import defaultdict

corpus_path, ports_path, nl_dir, nl_inv_path = sys.argv[1:5]
corpus = json.load(open(corpus_path))
ports = json.load(open(ports_path))
nl_inventory = json.load(open(nl_inv_path))

GEOMETRY_FIXTURES = ['rect', 'polygon', 'ellipse', 'curve', 'two_contours', 'geometry', 'line']
WORDS = ['apple', 'banana', 'cherry', 'date', 'elderberry', 'fig']


def num(s, default=0.0):
    try:
        return float(s)
    except (TypeError, ValueError):
        return default


def clamp(v, port):
    if 'min' in port: v = max(v, num(port['min']))
    if 'max' in port: v = min(v, num(port['max']))
    return v


IMAGE_EXT = ('.jpg', '.jpeg', '.png', '.gif', '.bmp', '.tif', '.tiff')
TEXT_EXT = ('.csv', '.txt', '.tsv', '.xml', '.json', '.svg', '.mid', '.dat')


def file_candidates(port, s):
    """Real files and folders from the fixtures, for ports that take a path."""
    name = (port.get('name') or '').lower()
    low = s.lower()
    if low.endswith(IMAGE_EXT) or re.search(r'pic|foto|photo|image|img', name):
        return ['sunshine 240.jpg', 'Desktop/sunshine 240.jpg']
    if low.endswith(TEXT_EXT) or re.search(r'csv|txt|file', name):
        return ['data.csv', 'notes.txt', 'Gravity/out.csv']
    if re.search(r'folder|dir|path', name) or re.search(r'folder|directory|library', low):
        return ['Node Library', 'Directory Nodes', 'non-empty folder', 'empty folder']
    return None


def value_for(port, variant, rng):
    """One argument for a value-range port. variant 0 is the stored default."""
    t = port.get('type')
    v = port.get('value')
    if t == 'float':
        base = num(v, 0.0)
        cands = [base, base * 2 + 3.5, rng.uniform(-50, 150), base / 3.0 + 1.25]
        return {'float': clamp(cands[variant % len(cands)], port)}
    if t == 'int':
        base = int(num(v, 0))
        cands = [base, base + 3, rng.randint(1, 40), max(base // 2, 1) + 7]
        return {'int': int(clamp(cands[variant % len(cands)], port))}
    if t == 'boolean':
        b = (v or 'false') == 'true'
        return {'bool': b if variant % 2 == 0 else not b}
    if t == 'point':
        x, y = (num(s) for s in (v or '0,0').split(',')[:2]) if v and ',' in v else (0.0, 0.0)
        cands = [(x, y), (x + 25.5, y - 40.0), (rng.uniform(-200, 200), rng.uniform(-200, 200)), (-x + 10, y * 0.5 + 3)]
        px, py = cands[variant % len(cands)]
        return {'point': [px, py]}
    if t == 'color':
        return {'color': [[0.2, 0.4, 0.6, 1.0], [1, 0, 0, 1], [0.5, 0.5, 0.5, 0.5], [0, 0, 0, 1]][variant % 4]}
    if t == 'string':
        s = v or ''
        if variant == 0: return {'str': s}
        files = file_candidates(port, s)
        if files: return {'str': files[(variant - 1) % len(files)]}
        if re.fullmatch(r'-?\d+(\.\d+)?', s): return {'str': str(int(num(s)) + variant * 7)}
        alts = ['hello world', 'a,b,c', 'NodeBox 3', '42', 'x']
        return {'str': alts[variant % len(alts)] if s == '' else [s, s + ' 2', s.upper(), s[: max(1, len(s) // 2)]][variant % 4]}
    if t in ('geometry', 'shape'):
        return {'fixture': GEOMETRY_FIXTURES[variant % len(GEOMETRY_FIXTURES)]}
    if t == 'context':
        return {'fixture': 'context'}
    if t == 'data':
        return {'fixture': 'rows'}
    if t in ('list', 'item'):
        return {'list': [{'float': 1.0}, {'float': 2.5}, {'float': 4.0}]}
    return {'null': True}


def list_for(port, variant, rng):
    """One argument for a list-range port."""
    t = port.get('type')
    n = [5, 3, 8, 1][variant % 4]
    if t == 'point':
        if variant == 0: return {'fixture': 'points'}
        return {'list': [{'point': [round(rng.uniform(-150, 150), 3), round(rng.uniform(-150, 150), 3)]} for _ in range(n)]}
    if t == 'float':
        return {'list': [{'float': round(rng.uniform(-20, 120), 4)} for _ in range(n)]}
    if t == 'int':
        return {'list': [{'int': rng.randint(0, 30)} for _ in range(n)]}
    if t == 'string':
        return {'list': [{'str': WORDS[(i + variant) % len(WORDS)]} for i in range(n)]}
    if t in ('geometry', 'shape'):
        return {'list': [{'fixture': GEOMETRY_FIXTURES[(i + variant) % len(GEOMETRY_FIXTURES)]} for i in range(min(n, 4))]}
    if t == 'data':
        return {'fixture': 'rows'}
    if t == 'boolean':
        return {'list': [{'bool': i % 2 == 0} for i in range(n)]}
    return {'list': [{'float': float(i) * 1.5} for i in range(n)]}


def cases_for(fn_key, variants, n_cases=4):
    rng = random.Random(fn_key)
    cases, seen = [], set()
    for ports_ in variants:
        for i in range(n_cases):
            args = [list_for(p, i, rng) if p.get('range') == 'list' else value_for(p, i, rng) for p in ports_]
            k = json.dumps(args, sort_keys=True)
            if k not in seen:
                seen.add(k)
                cases.append(args)
    return cases[:8]


def safe_name(name, lang):
    base = re.sub(r'[^a-z0-9_]', '_', name.rsplit('.', 1)[0].lower()) or 'module'
    return base + ('.py' if lang == 'python' else '.clj')


def arity(text, name, lang):
    """Number of parameters in the definition of name, or None when it cannot be read."""
    if lang == 'python':
        m = re.search(r'^\s*def\s+' + re.escape(name) + r'\s*\(([^)]*)\)', text, re.M)
        if not m: return None
        params = [p.strip() for p in m.group(1).split(',') if p.strip()]
        return None if any(p.startswith('*') for p in params) else len(params)
    m = re.search(r'\(defn-?\s+' + re.escape(name) + r'(?:\s+"(?:[^"\\]|\\.)*")?\s*\[([^\]]*)\]', text)
    if not m or '&' in m.group(1): return None
    return len(m.group(1).split())


def pick_variants(variants, n):
    """The port lists that match the definition, so an older node with fewer ports is not used.
    Without a readable definition, the longest port list."""
    if n is not None:
        same = [v for v in variants if len(v) == n]
        if same: return same
    longest = max(len(v) for v in variants)
    return [v for v in variants if len(v) == longest]


def defines(text, name, lang):
    if lang == 'python':
        return re.search(r'^\s*def\s+' + re.escape(name) + r'\s*\(', text, re.M) is not None
    return re.search(r'\(defn-?\s+' + re.escape(name) + r'[\s\[]', text) is not None


modules = []

# The Node Library: signatures from its own .ndbx.
nl_files = {f: open(os.path.join(nl_dir, f), 'rb').read() for f in os.listdir(nl_dir) if f.endswith(('.py', '.clj'))}
nl_hashes = {hashlib.sha256(b).hexdigest() for b in nl_files.values()}
for fname, raw in sorted(nl_files.items()):
    lang = 'python' if fname.endswith('.py') else 'clojure'
    text = raw.decode('utf8', 'replace')
    ns = fname.rsplit('.', 1)[0]
    fns = []
    for key, info in sorted(nl_inventory.items()):
        kns, name = key.split('/', 1)
        if kns != ns or not defines(text, name, lang): continue
        variants = pick_variants(info['variants'], arity(text, name, lang))
        fns.append({'name': name, 'outputType': info['outputType'], 'outputRange': info['outputRange'],
                    'ports': variants[0], 'cases': cases_for(key, variants)})
    modules.append({'id': 'nl/' + fname, 'set': 'known', 'lang': lang, 'filename': fname,
                    'safeName': safe_name(fname, lang), 'source': text, 'functions': fns})

# Forum attachments: signatures from every public .ndbx that links the file by name.
sigs = defaultdict(dict)
for doc in ports:
    for key, info in doc['functions'].items():
        ns, name = key.split('/', 1)
        rec = sigs[ns].setdefault(name, {'outputType': info['outputType'], 'outputRange': info['outputRange'], 'variants': []})
        for v in info['variants']:
            if v not in rec['variants'] and len(rec['variants']) < 3: rec['variants'].append(v)

for f in corpus['files']:
    if f['sha256'] in nl_hashes: continue
    fname = f['names'][0]
    lang = 'python' if fname.endswith('.py') else 'clojure'
    fns = []
    for n in f['names']:
        for name, info in sorted(sigs.get(n.rsplit('.', 1)[0], {}).items()):
            if defines(f['text'], name, lang) and name not in [x['name'] for x in fns]:
                variants = pick_variants(info['variants'], arity(f['text'], name, lang))
                fns.append({'name': name, 'outputType': info['outputType'], 'outputRange': info['outputRange'],
                            'ports': variants[0], 'cases': cases_for(n + '/' + name, variants)})
    modules.append({'id': 'forum/%s-%s' % (f['sha256'][:8], fname), 'set': 'forum' if fns else 'forum-unsigned',
                    'lang': lang, 'filename': fname, 'safeName': safe_name(fname, lang), 'source': f['text'],
                    'origin': f['source'], 'functions': fns})

json.dump({'modules': modules}, sys.stdout, indent=1)
print('%d modules, %d with signatures, %d functions, %d cases' % (
    len(modules), sum(1 for m in modules if m['functions']), sum(len(m['functions']) for m in modules),
    sum(len(fn['cases']) for m in modules for fn in m['functions'])), file=sys.stderr)
