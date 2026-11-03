#!/usr/bin/env python3
"""Narrow hooks for themed password headers; controllers/actions are untouched."""
import argparse
import difflib
from pathlib import Path
import subprocess
import tempfile

ROOT=Path(__file__).resolve().parent.parent
PATCH='0037-merlin-password-status-headers.patch'


def base(src,path,before_patch=PATCH):
    with tempfile.TemporaryDirectory() as directory:
        target=Path(directory)/path;target.parent.mkdir(parents=True,exist_ok=True)
        dependency='third_party/devtools-frontend/src'
        if path.startswith(dependency+'/'):
            revision=subprocess.check_output(['git','-C',str(src),'rev-parse','HEAD:'+dependency],text=True).strip()
            original=subprocess.check_output(['git','-C',str(src/dependency),'show',revision+':'+path[len(dependency)+1:]])
        else:
            original=subprocess.check_output(['git','-C',str(src),'show','HEAD:'+path])
        target.write_bytes(original)
        for patch in sorted((ROOT/'patches').glob('*.patch')):
            if patch.name>=before_patch:break
            if f'+++ b/{path}\n' in patch.read_text():
                subprocess.run(['git','apply',f'--include={path}',str(patch)],cwd=directory,check=True)
        return target.read_text()


def generate(src):
    edits={}
    path='chrome/browser/ui/views/passwords/password_bubble_view_base.cc';before=base(src,path)
    after=before.replace('#include "base/functional/bind.h"','#include "base/functional/bind.h"\n#include "chrome/browser/ui/modal_browser/merlin_bubble_header.h"\n#include "chrome/grit/theme_resources.h"')
    needle='''void PasswordBubbleViewBase::SetBubbleHeader(int light_image_id,
                                             int dark_image_id) {'''
    # Upstream indentation is retained verbatim by the earlier patches.
    if needle not in after:
        import re
        match=re.search(r'void PasswordBubbleViewBase::SetBubbleHeader\(int light_image_id,\s+int dark_image_id\) \{',after)
        if not match:raise ValueError('missing password header hook')
        needle=match.group(0)
    after=after.replace(needle,needle+'''
  if (!base::CommandLine::ForCurrentProcess()->HasSwitch(
          "modal-browser-upstream-defaults")) {
    using Tone = modal_browser::BubbleHeaderTone;
    std::optional<Tone> tone;
    switch (light_image_id) {
      case IDR_BIOMETRIC_AUTHENTICATION_PROMPT_LIGHT:
        tone = Tone::kAuthentication;
        break;
      case IDR_BIOMETRIC_AUTHENTICATION_CONFIRMATION_PROMPT_LIGHT:
      case IDR_SAVED_PASSWORDS_SAFE_STATE:
        tone = Tone::kSuccess;
        break;
      case IDR_SAVED_PASSWORDS_NEUTRAL_STATE:
        tone = Tone::kReview;
        break;
      default:
        break;
    }
    if (tone) {
      GetBubbleFrameView()->SetHeaderView(
          modal_browser::CreateMerlinBubbleHeader(*tone));
      return;
    }
  }''')
    after=after.replace('#include "base/functional/bind.h"','#include <optional>\n\n#include "base/functional/bind.h"')
    start=after.index('  if (lottie_image_id == IDR_AUTOFILL_SAVE_PASSWORD_LOTTIE &&')
    end=after.index('  ui::ResourceBundle& bundle',start)
    after=after[:start]+'''  if (!base::CommandLine::ForCurrentProcess()->HasSwitch(
          "modal-browser-upstream-defaults") &&
      (lottie_image_id == IDR_AUTOFILL_SAVE_PASSWORD_LOTTIE ||
       lottie_image_id == IDR_PASSWORD_CHANGE_SUCCESS_LOTTIE)) {
    const auto tone = lottie_image_id == IDR_PASSWORD_CHANGE_SUCCESS_LOTTIE
        ? modal_browser::BubbleHeaderTone::kSuccess
        : modal_browser::BubbleHeaderTone::kPassword;
    GetBubbleFrameView()->SetHeaderView(
        modal_browser::CreateMerlinBubbleHeader(tone));
    return;
  }
''' +after[end:]
    edits[path]=(before,after)
    path='chrome/browser/ui/views/passwords/credential_leak_dialog_view.cc';before=base(src,path)
    after=before.replace('#include "chrome/browser/ui/views/passwords/credential_leak_dialog_view.h"','#include "chrome/browser/ui/views/passwords/credential_leak_dialog_view.h"\n#include "base/command_line.h"\n#include "chrome/browser/ui/modal_browser/merlin_bubble_header.h"')
    needle='void CredentialLeakDialogView::AddedToWidget() {'
    after=after.replace(needle,needle+'''
  if (!base::CommandLine::ForCurrentProcess()->HasSwitch(
          "modal-browser-upstream-defaults")) {
    GetBubbleFrameView()->SetHeaderView(modal_browser::CreateMerlinBubbleHeader(
        modal_browser::BubbleHeaderTone::kDanger));
    return;
  }''')
    edits[path]=(before,after)
    path='chrome/browser/ui/views/passwords/BUILD.gn';before=base(src,path)
    after=before.replace('source_set("impl") {','source_set("impl") {\n  public_deps = [ "//chrome/browser/ui/modal_browser:presentation" ]')
    edits[path]=(before,after)
    lines=[]
    for path,(before,after) in edits.items():
        if before==after:raise ValueError('missing password presentation context: '+path)
        for line in difflib.unified_diff(before.splitlines(True),after.splitlines(True),fromfile='a/'+path,tofile='b/'+path):
            lines.append(line if line.endswith('\n') else line+'\n\\ No newline at end of file\n')
    return ''.join(lines)


def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--src',type=Path,default=Path.home()/'chromium/src');p.add_argument('--check',action='store_true');a=p.parse_args();patch=ROOT/'patches'/PATCH;text=generate(a.src)
    if a.check:
        if patch.read_text()!=text:raise SystemExit('password header patch is stale')
        print('password header patch: current')
    else:patch.write_text(text);print('password header patch: generated')

if __name__=='__main__':main()
