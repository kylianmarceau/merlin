#!/usr/bin/env python3
"""Replace residual desktop product names without changing services or identifiers.

Generate patch 0033 from 0007's output. --check audits the applied checkout;
new occurrences fail instead of silently extending the exception list.
"""
import argparse
import difflib
import html
import hashlib
import json
from pathlib import Path
import re
import subprocess
import rebrand_strings as strings

ROOT=Path(__file__).resolve().parent.parent
EXCEPTIONS=json.loads((ROOT/'branding/product_name_exceptions.json').read_text())
TAGS=re.compile(r'(<ex>.*?</ex>|<[^>]+>)',re.S)
FILES = strings.FILES + [
    'chrome/app/certificate_manager.grdp',
    'chrome/app/access_code_cast_strings.grdp',
    'chrome/app/actor_strings.grdp',
    'chrome/app/app_management_strings.grdp',
    'chrome/app/extensions_strings.grdp',
    'chrome/app/glic_strings.grdp',
    'chrome/app/media_router_strings.grdp',
    'chrome/app/profiles_strings.grdp',
    'chrome/app/shared_settings_strings.grdp',
    'chrome/app/skills_strings.grdp',
    'chrome/app/support_tool_strings.grdp',
    'components/browsing_data_strings.grdp',
    'components/collaboration_strings.grdp',
    'components/commerce_strings.grdp',
    'components/contextual_cueing_strings.grdp',
    'components/enterprise_strings.grdp',
    'components/heavy_ad_intervention_strings.grdp',
    'components/history_strings.grdp',
    'components/payments_strings.grdp',
    'components/policy_strings.grdp',
    'components/send_tab_to_self_strings.grdp',
    'components/smart_tab_sharing.grdp',
    'extensions/strings/extensions_strings.grd',
]
NAME=re.compile(r'\b(?:Google Chrome|Chrome)\b')


def message_name(m):
    name = re.search(r'''\bname\s*=\s*['"]([^'"]+)''', m.group(1))
    return name.group(1) if name else None


def transform(text):
    def message(m):
        if not message_name(m) or message_name(m) in EXCEPTIONS: return m.group(0)
        runs=TAGS.split(m.group(2))
        body=''.join(s if i%2 else NAME.sub('Merlin',s) for i,s in enumerate(runs))
        return m.group(1)+body+m.group(3)
    parts=re.split(r'(<!--.*?-->)',text,flags=re.S)
    return ''.join(part if i%2 else strings.MESSAGE.sub(message,part) for i,part in enumerate(parts))


def visible(m):
    body=strings.EXAMPLE.sub('',m.group(2))
    body=re.sub(r'<[^>]+>','',body)
    return html.unescape(body)


def audit(src):
    unexpected=[];allowed=[]
    for path in FILES:
        for m in strings.mac_messages(re.sub(r'<!--.*?-->', '', (src/path).read_text(), flags=re.S)):
            text=visible(m);name=message_name(m)
            if not re.search(r'\b(?:Chrome|Chromium)\b',text): continue
            # Attribution phrases kept by the original branding patch.
            if 'Chrome' not in text and strings.KEEP.search(text): continue
            normalized = re.sub(r'\s+', ' ', text).strip()
            if name in EXCEPTIONS:
                exception = EXCEPTIONS[name]
                if hashlib.sha256(normalized.encode()).hexdigest() != exception['text_sha256']:
                    unexpected.append(f'{path}:{name}: exception text changed; review required')
                else:
                    allowed.append({'source':path,'message':name,'reason':exception['reason'],'text':text.strip()})
            else: unexpected.append(f'{path}:{name}: ' + normalized)
    return unexpected,allowed


def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--src',type=Path,default=Path.home()/'chromium/src');p.add_argument('--check',action='store_true');p.add_argument('--report',type=Path);a=p.parse_args()
    if a.check:
        bad,allowed=audit(a.src)
        if a.report:a.report.write_text(json.dumps({'unexpected':bad,'exceptions':allowed},indent=2)+'\n')
        if bad:raise SystemExit('\n'.join(bad))
        print(f'desktop product names: no unexpected names; {len(allowed)} explicit exceptions');return
    patch=[]
    for path in FILES:
        before=strings.base_text(str(a.src),path,str(ROOT/'patches'))
        if path in strings.FILES:
            before=strings.rebrand(before)[0]
        def replacement(m):
            if message_name(m) in EXCEPTIONS:
                return m.group(0)
            return transform(strings.rebrand(m.group(0))[0])
        # Use the same platform reachability filter as the desktop audit;
        # do not rewrite Android/ChromeOS-only presentation.
        applicable = {m.start() for m in strings.mac_messages(before)}
        after = strings.MESSAGE.sub(lambda m: replacement(m) if m.start() in applicable else m.group(0), before)
        for line in difflib.unified_diff(before.splitlines(True),after.splitlines(True),fromfile='a/'+path,tofile='b/'+path):
            patch.append(line if line.endswith('\n') else line+'\n\\ No newline at end of file\n')
    (ROOT/'patches/0033-merlin-visible-product-names.patch').write_text(''.join(patch))
    print('residual product name patch: generated')

if __name__=='__main__':main()
