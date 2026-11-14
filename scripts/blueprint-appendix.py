import os, re, glob, io, sys
# Run from the repository root:  python scripts/blueprint-appendix.py
# Rewrites the appendices of docs/PLATFORM-BLUEPRINT.md from the migrations and the
# source files, so the blueprint stays true to the code. Rerun after changing either.
out = io.StringIO()
W = lambda s='': out.write(s + '\n')

# ---------- migrations: header comments
W('## A. Migrations (in order) and what each does\n')
migs = sorted(glob.glob('supabase/migrations/*.sql'))
alltext = ''
for m in migs:
    s = open(m, encoding='utf8').read(); alltext += '\n' + s
    head = []
    for line in s.splitlines():
        if line.startswith('--'): head.append(line[2:].strip())
        elif line.strip() == '' and not head: continue
        else: break
    W(f'### `{os.path.basename(m)}` ({len(s.splitlines())} lines)\n')
    W('\n'.join(('> ' + h) if h else '>' for h in head) + '\n')

# ---------- tables and columns
W('## B. Tables (schema `uniattend`) and their columns\n')
tables = {}
for mt in re.finditer(r'create table (?:if not exists )?uniattend\.(\w+)\s*\((.*?)\n\);', alltext, re.S):
    name, body = mt.group(1), mt.group(2)
    cols = []
    for line in body.splitlines():
        l = line.strip().rstrip(',')
        if not l or l.startswith('--'): continue
        if re.match(r'(unique|foreign key|check|primary key|constraint)\b', l): cols.append('  - _' + re.sub(r'\s+', ' ', l) + '_'); continue
        mm = re.match(r'(\w+)\s+(.*)', l)
        if mm: cols.append(f'  - `{mm.group(1)}` {re.sub(chr(32)+"+", " ", mm.group(2))}')
    tables.setdefault(name, []).extend(cols)
for mt in re.finditer(r'alter table uniattend\.(\w+)\s+((?:add column if not exists [^;]+?)+);', alltext, re.S):
    for c in re.finditer(r'add column if not exists (\w+)\s+([^,;]+(?:\([^)]*\)[^,;]*)*)', mt.group(2)):
        tables.setdefault(mt.group(1), []).append(f'  - `{c.group(1)}` {re.sub(chr(92)+"s+", " ", c.group(2)).strip()} _(added later)_')
dropped = set(re.findall(r'drop table if exists uniattend\.(\w+)', alltext))
for name in sorted(tables):
    if name in dropped: continue
    W(f'- **{name}**'); W('\n'.join(tables[name]))
W(f'\nDropped by later migrations (do not recreate): {", ".join(sorted(dropped)) or "none"}\n')

# ---------- policies
W('## C. Row-level security policies (final definition of each)\n')
pol = {}
for mt in re.finditer(r'create policy (\w+) on uniattend\.(\w+) for (\w+) to (\w+)\s*(.*?);', alltext, re.S):
    pol[(mt.group(2), mt.group(1))] = (mt.group(3), mt.group(4), re.sub(r'\s+', ' ', mt.group(5)))
for (t, p), (cmd, role, body) in sorted(pol.items()):
    W(f'- `{t}`.`{p}` — {cmd} to {role}: `{body[:400]}`')
W()

# ---------- functions (last definition wins) + who may call
W('## D. Database functions (last definition wins)\n')
fns = {}
for mt in re.finditer(r'create or replace function uniattend\.(\w+)\s*\((.*?)\)\s*returns\s+(.*?)\s+language', alltext, re.S):
    fns[mt.group(1)] = (re.sub(r'\s+', ' ', mt.group(2)), re.sub(r'\s+', ' ', mt.group(3)))
grants = {}
for mt in re.finditer(r'grant execute on function uniattend\.(\w+)\([^;]*?\) to ([\w, ]+);', alltext):
    grants[mt.group(1)] = mt.group(2).strip()
droppedf = set(re.findall(r'drop function if exists uniattend\.(\w+)', alltext))
for n in sorted(fns):
    if n in droppedf and n not in grants: continue
    a, r = fns[n]
    W(f'- `{n}({a})` → {r}' + (f' — callable by: {grants[n]}' if n in grants else ' — internal'))
W()

# ---------- source files
W('## E. Every source file, with its purpose\n')
def first_comment(path):
    try: lines = open(path, encoding='utf8').read().splitlines()
    except Exception: return '', 0
    desc = ''
    for l in lines[:25]:
        t = l.strip()
        if t.startswith('//') and len(t) > 5: desc = t[2:].strip(); break
        if t.startswith('/**') or t.startswith('/*'):
            desc = t.strip('/* ').strip();
            if desc: break
        if t.startswith('*') and len(t) > 3: desc = t.strip('* /').strip(); break
    return desc, len(lines)
for root in ['src/app', 'src/components', 'src/lib', 'src', 'public', 'scripts', 'tests/db', 'tests/unit', 'supabase/functions', 'mobile', 'loadtest', 'tools']:
    files = []
    for dp, dn, fn in os.walk(root):
        if root == 'src' and dp != 'src': continue
        for f in fn:
            if f.endswith(('.ts', '.tsx', '.js', '.mjs', '.css', '.html', '.json', '.webmanifest', '.sql')) and 'node_modules' not in dp:
                files.append(os.path.join(dp, f).replace('\\', '/'))
    if not files: continue
    W(f'### `{root}/`\n')
    for f in sorted(files):
        d, n = first_comment(f)
        W(f'- `{f}` ({n} lines)' + (f' — {d[:170]}' if d else ''))
    W()
doc = 'docs/PLATFORM-BLUEPRINT.md'
text = open(doc, encoding='utf8').read()
i = text.index('<!-- GENERATED-APPENDIX')
head = text[:text.index('\n', i) + 1]
open(doc, 'w', encoding='utf8', newline='\n').write(head + '\n# Appendices (generated from the code)\n\n' + out.getvalue())
print(len(out.getvalue()), 'chars;', len(tables), 'tables;', len(fns), 'functions;', len(pol), 'policies;', len(migs), 'migrations')
