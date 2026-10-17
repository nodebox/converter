"""Runs every module in the test set through the Java harness.

    python3 run.py ref <testset.json> <out.json>                 originals (Jython / Clojure)
    python3 run.py js  <testset.json> <out.json> <converted dir> conversions (GraalJS)

Paths default to what check/setup.sh makes: .cache/cp.txt (classpath), .cache/harness (compiled
Harness.java), .cache/nodebox3/src/main/python and data/fixtures (the folder that becomes the working
directory, with the sample files the Node Library reads). HARNESS_CP, HARNESS_CLASSES, NB_PYTHON and
FIXTURES override them.
"""
import hashlib, json, os, re, shutil, subprocess, sys, tempfile
from concurrent.futures import ThreadPoolExecutor

here = os.path.dirname(os.path.abspath(__file__))
root = os.path.dirname(here)
mode, testset_path, out_path = sys.argv[1:4]
converted_dir = os.path.abspath(sys.argv[4]) if mode == 'js' else None
cp = open(os.environ.get('HARNESS_CP', os.path.join(root, '.cache', 'cp.txt'))).read().strip()
cp = os.environ.get('HARNESS_CLASSES', os.path.join(root, '.cache', 'harness')) + ':' + cp
fixtures = os.path.abspath(os.environ.get('FIXTURES', os.path.join(root, 'data', 'fixtures')))
nb_python = os.environ.get('NB_PYTHON', os.path.join(root, '.cache', 'nodebox3', 'src', 'main', 'python'))
work = tempfile.mkdtemp(prefix='convtest-')
modules = [m for m in json.load(open(testset_path))['modules'] if m['functions']]


def js_name(name):
    """Clojure and Python names as the converter is told to export them."""
    return re.sub(r'[-_]+([a-zA-Z0-9])', lambda m: m.group(1).upper(), name) if '-' in name else name


def run(i_m):
    i, m = i_m
    d = os.path.join(work, str(i))
    os.makedirs(d)
    if mode == 'ref':
        src = os.path.join(d, m['safeName'])
        open(src, 'w').write(m['source'])
        lang = m['lang']
    else:
        conv = os.path.join(converted_dir, m['id'].replace('/', '__') + '.mjs')
        if not os.path.exists(conv):
            return m['id'], {'loadError': 'no conversion'}
        src, lang = conv, 'js'
    job = {'lang': lang, 'file': src, 'adapter': os.path.join(here, "adapter"),
           'functions': [{'name': f['name'], 'jsName': js_name(f['name']), 'cases': f['cases']} for f in m['functions']]}
    jp = os.path.join(d, 'job.json')
    json.dump(job, open(jp, 'w'))
    # Every module gets a fresh copy of the fixtures, since some code writes files.
    cwd = os.path.join(d, 'cwd')
    shutil.copytree(fixtures, cwd)
    try:
        env = dict(os.environ, HOME=cwd)
        p = subprocess.run(['java', '-Djava.awt.headless=true', '-Duser.home=' + cwd, '-Dnb.python=' + nb_python, '-Xss8m',
                            '-cp', cp, 'Harness', mode, jp], cwd=cwd, env=env, capture_output=True, text=True, timeout=int(os.environ.get('TIMEOUT', '300')))
    except subprocess.TimeoutExpired:
        return m['id'], {'loadError': 'timeout'}
    line = [l for l in p.stdout.splitlines() if l.startswith('{')]
    if not line:
        return m['id'], {'loadError': 'harness crashed: ' + (p.stderr or p.stdout)[-800:]}
    res = json.loads(line[-1])
    res['$files'] = written_files(cwd)
    return m['id'], res


def written_files(cwd):
    """Files the module created or changed, so writes are compared too."""
    out = {}
    for dirpath, _, names in os.walk(cwd):
        for n in names:
            p = os.path.join(dirpath, n)
            rel = os.path.relpath(p, cwd)
            if rel.startswith(('.java/', '.cache/', 'Library/Caches/')): continue  # JVM and GraalJS caches (Library/Caches on macOS)
            src = os.path.join(fixtures, rel)
            data = open(p, 'rb').read()
            if not os.path.exists(src) or open(src, 'rb').read() != data:
                out[rel] = hashlib.sha256(data).hexdigest()[:16]
    return out


with ThreadPoolExecutor(int(os.environ.get('JOBS', '4'))) as ex:
    results = dict(ex.map(run, enumerate(modules)))
json.dump(results, open(out_path, 'w'), indent=1)
shutil.rmtree(work, ignore_errors=True)
print('%s: %d modules' % (mode, len(results)), file=sys.stderr)
