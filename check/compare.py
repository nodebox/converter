"""Compares the conversions' outputs with the originals'.

    python3 compare.py <testset.json> <ref.json> <js.json> <converted dir> > report.json

A case counts only when the original ran without an error on it. A function passes when every such
case gives the same output (numbers within 1e-9) and the module wrote the same files.
"""
import json, math, os, sys
from collections import Counter

testset, ref, js = (json.load(open(p)) for p in sys.argv[1:4])
conv_dir = sys.argv[4]
EPS = 1e-9


def diff(a, b, path='$'):
    """The first place where a and b differ, or None."""
    # NodeBox 3 hands a Python True/False to the node as 1/0; NodeBox 4 keeps booleans.
    if isinstance(b, bool) and not isinstance(a, bool) and a in (0, 1):
        return None if a == int(b) else '%s: %r != %r' % (path, a, b)
    if isinstance(a, bool) or isinstance(b, bool):
        return None if a is b else '%s: %r != %r' % (path, a, b)
    if isinstance(a, (int, float)) and isinstance(b, (int, float)):
        if a == b or abs(a - b) <= EPS * max(1.0, abs(a), abs(b)):
            return None
        return '%s: %r != %r' % (path, a, b)
    if type(a) != type(b):
        return '%s: %s != %s' % (path, short(a), short(b))
    if isinstance(a, list):
        if len(a) != len(b):
            return '%s: length %d != %d' % (path, len(a), len(b))
        for i, (x, y) in enumerate(zip(a, b)):
            d = diff(x, y, '%s[%d]' % (path, i))
            if d: return d
        return None
    if isinstance(a, dict):
        if set(a) != set(b):
            return '%s: keys %s != %s' % (path, sorted(a)[:8], sorted(b)[:8])
        for k in a:
            d = diff(a[k], b[k], '%s.%s' % (path, k))
            if d: return d
        return None
    return None if a == b else '%s: %s != %s' % (path, short(a), short(b))


def short(v):
    s = json.dumps(v)
    return s if len(s) < 120 else s[:117] + '...'


report = {'modules': []}
for m in testset['modules']:
    if not m['functions']:
        continue
    r, j = ref.get(m['id'], {}), js.get(m['id'], {})
    meta_path = os.path.join(conv_dir, m['id'].replace('/', '__') + '.json')
    meta = json.load(open(meta_path)) if os.path.exists(meta_path) else {}
    claimed = {f['name']: f for f in meta.get('functions', [])}
    mod = {'id': m['id'], 'set': m['set'], 'lang': m['lang'], 'functions': [], 'warnings': meta.get('warnings', []),
           'suspectedBugs': meta.get('suspectedBugs', [])}
    if 'loadError' in r:
        mod['result'] = 'original-failed'
        mod['detail'] = r['loadError'][:300]
        report['modules'].append(mod)
        continue
    if 'loadError' in j:
        mod['jsLoadError'] = j['loadError'][:400]
    for f in m['functions']:
        name = f['name']
        jsname = name if '-' not in name else ''.join(p if i == 0 else p[:1].upper() + p[1:] for i, p in enumerate(name.replace('_', '-').split('-')))
        c = claimed.get(jsname) or claimed.get(name) or {}
        rc = r.get(name, [])
        jc = j.get(name, []) if 'loadError' not in j else []
        usable = [i for i, x in enumerate(rc) if 'error' not in x]
        fails = []
        for i in usable:
            if i >= len(jc):
                fails.append({'case': i, 'why': 'not run: ' + j.get('loadError', 'missing')[:200]})
            elif 'error' in jc[i]:
                fails.append({'case': i, 'why': 'error: ' + jc[i]['error'][:200]})
            else:
                d = diff(rc[i]['value'], jc[i]['value'])
                if d: fails.append({'case': i, 'why': d})
        fr = {'name': name, 'claimed': c.get('status'), 'notes': c.get('notes', ''), 'cases': len(usable),
              'passed': len(usable) - len(fails), 'fails': fails[:3]}
        fr['result'] = 'untestable' if not usable else ('pass' if not fails else 'fail')
        mod['functions'].append(fr)
    files_r, files_j = r.get('$files', {}), j.get('$files', {})
    mod['filesMatch'] = files_r == files_j
    if not mod['filesMatch']:
        mod['filesDiff'] = {'original': files_r, 'converted': files_j}
    tested = [f for f in mod['functions'] if f['result'] != 'untestable']
    if not tested:
        mod['result'] = 'untestable'
    elif all(f['result'] == 'pass' for f in tested) and mod['filesMatch']:
        mod['result'] = 'pass'
    else:
        mod['result'] = 'fail'
    report['modules'].append(mod)


def summarize(mods):
    fns = [f for m in mods for f in m['functions'] if f['result'] != 'untestable']
    cases = sum(f['cases'] for f in fns)
    return {
        'modules': len(mods),
        'modulesTested': sum(1 for m in mods if m['result'] in ('pass', 'fail')),
        'modulesPassed': sum(1 for m in mods if m['result'] == 'pass'),
        'functionsTested': len(fns),
        'functionsPassed': sum(1 for f in fns if f['result'] == 'pass'),
        'cases': cases,
        'casesPassed': sum(f['passed'] for f in fns),
        'claimedNotConverted': sum(1 for m in mods for f in m['functions'] if f['claimed'] == 'not-converted'),
        'results': dict(Counter(m['result'] for m in mods)),
    }


report['summary'] = {
    'known': summarize([m for m in report['modules'] if m['set'] == 'known']),
    'forum': summarize([m for m in report['modules'] if m['set'] == 'forum']),
}
json.dump(report, sys.stdout, indent=1)
