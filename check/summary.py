"""Prints a report from compare.py as a short table, with every failing function.

    python3 check/summary.py data/report.json
"""
import json, sys

report = json.load(open(sys.argv[1]))
for name, s in report['summary'].items():
    print('%-6s %d/%d files identical, %d/%d functions, %d/%d cases, %d functions refused' % (
        name, s['modulesPassed'], s['modulesTested'], s['functionsPassed'], s['functionsTested'],
        s['casesPassed'], s['cases'], s['claimedNotConverted']))
print()
for m in report['modules']:
    if m['result'] != 'fail':
        continue
    for f in m['functions']:
        if f['result'] == 'fail':
            why = f['fails'][0]['why'] if f['fails'] else ''
            print('%s %s [%s] %s' % (m['id'], f['name'], f['claimed'], why[:140]))
    if not m.get('filesMatch', True):
        print('%s: written files differ' % m['id'])
bugs = [(m['id'], b) for m in report['modules'] for b in m.get('suspectedBugs', [])]
if bugs:
    print('\nSuspected bugs reported to users:')
    for mid, b in bugs:
        print('%s %s: %s' % (mid, b['function'], b['description']))
