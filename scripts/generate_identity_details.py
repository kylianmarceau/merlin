#!/usr/bin/env python3
"""Generate targeted media, print/private-page and remaining product-icon hooks."""
import argparse
import difflib
from pathlib import Path
import subprocess
import merlin_mark

ROOT=Path(__file__).resolve().parent.parent


def generate(src):
    edits={}
    def edit(path,fn):
        before=subprocess.check_output(['git','-C',str(src),'show','HEAD:'+path],text=True)
        after=fn(before)
        if before==after:raise ValueError('no presentation hook: '+path)
        edits[path]=(before,after)
    def rep(s,a,b):
        if a not in s:raise ValueError('missing upstream context: '+a)
        return s.replace(a,b)
    edit('chrome/browser/ui/views/global_media_controls/media_dialog_view.cc',lambda s:rep(s,'      views::Emphasis::kHigh);','      views::kDialogRadius);'))
    edit('chrome/browser/ui/views/global_media_controls/media_item_ui_helper.cc',lambda s:rep(rep(s,'theme.play_button_foreground_color_id = ui::kColorSysOnPrimary;','theme.play_button_foreground_color_id = ui::kColorButtonForegroundProminent;'),'theme.play_button_container_color_id = ui::kColorSysPrimary;','theme.play_button_container_color_id = ui::kColorButtonBackgroundProminent;'))
    edit('chrome/browser/resources/print_preview/ui/print_preview_vars.css',lambda s:rep(rep(s,'var(--google-grey-300)','var(--sunk, var(--google-grey-300))'),'var(--google-grey-700)','var(--sunk, var(--google-grey-700))'))
    edit('chrome/browser/resources/print_preview/ui/sidebar.css',lambda s:rep(rep(s,'background-color: white;','background-color: var(--panel, white);'),'background-color: rgba(255, 255, 255, .04);','background-color: var(--panel, rgba(255, 255, 255, .04));'))
    edit('chrome/browser/resources/print_preview/ui/app.css',lambda s:rep(s,'background: var(--google-grey-900);','background: var(--bg, var(--google-grey-900));'))
    # These are product marks, not the third-party Web Store logo.
    for name in ('chrome_product_cr23','chrome_product_cr23_old'):
        edit(f'ui/webui/resources/cr_components/searchbox/icons/{name}.svg',lambda s:'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="16" height="16"><path d="'+merlin_mark.glyph_path(0,0,16)+'"/></svg>\n')
    page_css=(ROOT/'branding/generated/merlin_page_tokens.css').read_text().replace('"',"'")
    guarded='\n/* Generated Merlin page tokens; private disclosures and actions are upstream. */\n@media (forced-colors: none) and (prefers-contrast: no-preference) {\n'+page_css+'}\n'
    def incognito(s):
        for a,b in [('color: rgb(232, 234, 237);','color: var(--text);'),('color: white;','color: var(--text);'),('background-color: rgb(40, 40, 40);','background-color: var(--panel);'),('border-radius: 4px;','border-radius: var(--card-radius);'),('fill: rgba(234, 240, 249, 1);','fill: var(--text2);'),('color: rgb(138, 180, 248);','color: var(--link);'),('font-weight: 400;','font-weight: 650;')]:s=rep(s,a,b)
        return s+guarded
    edit('chrome/browser/resources/new_tab_page_incognito_guest/incognito_tab.css',incognito)
    edit('chrome/browser/resources/new_tab_page_incognito_guest/incognito_tab_theme.css',lambda s:rep(s,'background-color: $i18n{colorBackground};','background-color: var(--bg, $i18n{colorBackground});'))
    def guest(s):
        for a,b in [('background: rgb(53, 54, 58);','background: var(--bg);'),('color: rgb(232, 234, 237);','color: var(--text);'),('color: rgb(51, 103, 214);','color: var(--link);'),('color: rgb(66, 133, 244);','color: var(--link);'),('color: rgb(138, 180, 248);','color: var(--link);'),('font-weight: 400;','font-weight: 650;')]:s=rep(s,a,b)
        s=rep(s,'  font-size: 85%;','  font-size: 85%;\n  background: var(--bg);\n  color: var(--text);')
        return s+guarded
    edit('chrome/browser/resources/new_tab_page_incognito_guest/incognito_and_guest_tab.css',guest)
    result=[]
    for path,(before,after) in edits.items():
        for line in difflib.unified_diff(before.splitlines(True),after.splitlines(True),fromfile='a/'+path,tofile='b/'+path):
            result.append(line if line.endswith('\n') else line+'\n\\ No newline at end of file\n')
    return ''.join(result)


def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--src',type=Path,default=Path.home()/'chromium/src');p.add_argument('--check',action='store_true');a=p.parse_args()
    patch=ROOT/'patches/0035-merlin-media-print-private-details.patch';text=generate(a.src)
    if a.check:
        if patch.read_text()!=text:raise SystemExit('detail patch is stale')
        print('detail patch: current')
    else:patch.write_text(text);print('detail patch: generated')

if __name__=='__main__':main()
