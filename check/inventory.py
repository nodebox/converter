"""Collects the node signatures of a NodeBox 3 code library from the document that uses it.

    python3 inventory.py <library.ndbx> <code dir> > nl_inventory.json

For every node whose function lives in one of the .py or .clj files in <code dir> (or in a library the
document links), records its ports and output type. A function used by several nodes keeps up to three
distinct port lists ("variants").
"""
import json, os, sys
import xml.etree.ElementTree as ET

ndbx, code_dir = sys.argv[1:3]
libs = {f.rsplit('.', 1)[0] for f in os.listdir(code_dir) if f.endswith(('.py', '.clj'))}
out = {}
for _, el in ET.iterparse(ndbx, events=('end',)):
    if el.tag == 'link':
        href = el.get('href', '')
        if ':' in href:
            libs.add(href.split(':', 1)[1].rsplit('/', 1)[-1].rsplit('.', 1)[0])
    if el.tag == 'node':
        fn = el.get('function')
        if not fn or '/' not in fn or fn.split('/', 1)[0] not in libs:
            continue
        ports = [{k: v for k, v in p.attrib.items() if k in ('name', 'type', 'value', 'range', 'widget', 'min', 'max')}
                 for p in el.findall('port')]
        rec = out.setdefault(fn, {'outputType': el.get('outputType'), 'outputRange': el.get('outputRange'), 'variants': []})
        if ports not in rec['variants'] and len(rec['variants']) < 3:
            rec['variants'].append(ports)
json.dump(out, sys.stdout, indent=1, sort_keys=True)
