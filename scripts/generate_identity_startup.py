#!/usr/bin/env python3
"""Register Merlin's mixer before the profile picker or any browser window."""
import argparse
import difflib
from pathlib import Path
from generate_password_headers import base

ROOT=Path(__file__).resolve().parent.parent
PATCH='0038-merlin-theme-before-profile-ui.patch'


def generate(src):
    changes={}
    path='chrome/browser/chrome_browser_main.cc';before=base(src,path,PATCH)
    after=before.replace('#include "chrome/browser/ui/views/chrome_browser_main_extra_parts_views.h"','#include "chrome/browser/ui/views/chrome_browser_main_extra_parts_views.h"\n#include "chrome/browser/ui/modal_browser/merlin_theme.h"')
    needle='''  ui::ColorProviderManager::Get().AppendColorProviderInitializer(
      base::BindRepeating(AddChromeColorMixers));'''
    if needle not in after:raise ValueError('color initializer order changed')
    after=after.replace(needle,needle+'''
#if defined(TOOLKIT_VIEWS)
  // Register last, before first-run/profile-picker UI can request colors.
  modal_browser::InstallMerlinTheme();
#endif''')
    changes[path]=(before,after)
    path='chrome/browser/BUILD.gn';before=base(src,path,PATCH)
    needle='      "//chrome/browser/ui/modal_browser:url_rewrite",'
    if needle not in before:raise ValueError('desktop Merlin dependencies changed')
    after=before.replace(needle,needle+'\n      "//chrome/browser/ui/modal_browser:theme",')
    changes[path]=(before,after)
    return ''.join(''.join(difflib.unified_diff(a.splitlines(True),b.splitlines(True),fromfile='a/'+path,tofile='b/'+path)) for path,(a,b) in changes.items())


def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--src',type=Path,default=Path.home()/'chromium/src');p.add_argument('--check',action='store_true');a=p.parse_args();file=ROOT/'patches'/PATCH;text=generate(a.src)
    if a.check:
        if file.read_text()!=text:raise SystemExit('startup theme patch is stale')
        print('startup theme patch: current')
    else:file.write_text(text);print('startup theme patch: generated')

if __name__=='__main__':main()
