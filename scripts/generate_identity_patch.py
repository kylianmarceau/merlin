#!/usr/bin/env python3
"""Generate narrow presentation-only hooks for the pinned Chromium checkout.

Reads upstream HEAD; never mutates the checkout. Apply via apply_overlay.sh.
"""
import argparse
import difflib
from pathlib import Path
import subprocess
import merlin_mark

ROOT=Path(__file__).resolve().parent.parent


def generate(src):
    edits={}
    def original(path):
        return subprocess.check_output(['git','-C',str(src),'show','HEAD:'+path],text=True)
    def edit(path,fn):
        before=original(path); after=fn(before)
        if before==after: raise ValueError('hook did not match: '+path)
        edits[path]=(before,after)
    def replace(before,old,new):
        if old not in before: raise ValueError('missing upstream context: '+old[:70])
        return before.replace(old,new)

    edit('ui/webui/resources/cr_elements/cr_shared_vars.css',lambda s:s+'\n'+(ROOT/'branding/generated/merlin_webui_tokens.css').read_text())
    edit('ui/webui/resources/cr_elements/cr_button/cr_button.css',lambda s:replace(s,'border-radius: 100px;','border-radius: var(--cr-button-border-radius, 8px);'))
    edit('ui/webui/resources/css/text_defaults_md.css',lambda s:replace(s,'font-family: $i18nRaw{fontfamilyMd};','font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, sans-serif;'))

    def layout(s):
        s=replace(s,'#include "base/containers/fixed_flat_map.h"','#include "base/containers/fixed_flat_map.h"\n#include "base/command_line.h"\n#include "chrome/browser/ui/modal_browser/merlin_design_tokens.h"')
        s=replace(s,'  if (token < views::ShapeContextTokens::kShapeContextTokenEnd) {','''  if (!base::CommandLine::ForCurrentProcess()->HasSwitch(
          "modal-browser-upstream-defaults")) {
    using namespace modal_browser::design;
    switch (token) {
      case views::kButtonRadius:
      case views::kComboboxRadius:
      case views::kTextfieldRadius:
        return kControlRadius;
      case views::kDialogRadius:
      case views::kMenuRadius:
      case views::kMenuAuxRadius:
      case views::kMenuTouchRadius:
        return kDialogRadius;
      default:
        break;
    }
  }
  if (token < views::ShapeContextTokens::kShapeContextTokenEnd) {''')
        return s
    edit('chrome/browser/ui/views/chrome_layout_provider.cc',layout)
    # This header-only target avoids a dependency on Merlin's controller.
    edit('chrome/browser/ui/views/BUILD.gn',lambda s:replace(s, 'source_set("layout_provider_impl") {', 'source_set("layout_provider_impl") {\n  public_deps = [ "//chrome/browser/ui/modal_browser:design_tokens" ]'))
    # Save/add-username's decorative animation only. Compromise, biometric,
    # leak and passkey status/error illustrations retain their semantic art.
    def password(s):
        s=replace(s,'#include "base/functional/bind.h"','#include "base/functional/bind.h"\n#include "base/command_line.h"\n#include "chrome/grit/browser_resources.h"\n#include "components/vector_icons/vector_icons.h"\n#include "ui/base/models/image_model.h"\n#include "ui/color/color_id.h"\n#include "ui/views/controls/image_view.h"\n#include "ui/views/border.h"')
        return replace(s,'void PasswordBubbleViewBase::SetBubbleHeaderLottie(int lottie_image_id) {','''void PasswordBubbleViewBase::SetBubbleHeaderLottie(int lottie_image_id) {
  if (lottie_image_id == IDR_AUTOFILL_SAVE_PASSWORD_LOTTIE &&
      !base::CommandLine::ForCurrentProcess()->HasSwitch(
          "modal-browser-upstream-defaults")) {
    // A compact Merlin mark replaces promotional art, not status/warning art.
    auto image = std::make_unique<views::ImageView>(
        ui::ImageModel::FromVectorIcon(vector_icons::kProductIcon,
                                      ui::kColorIcon, 32));
    image->SetBorder(views::CreateEmptyBorder(gfx::Insets::VH(16, 20)));
    image->GetViewAccessibility().SetIsInvisible(true);
    GetBubbleFrameView()->SetHeaderView(std::move(image));
    return;
  }''')
    edit('chrome/browser/ui/views/passwords/password_bubble_view_base.cc',password)
    edit('chrome/browser/resources/password_manager/shared_vars.css',lambda s:replace(replace(s,'--side-bar-width: 300px;','--side-bar-width: 240px;'),'--section-min-height: 48px;','--section-min-height: 52px;'))
    edit('chrome/browser/resources/password_manager/shared_style_lit.css',lambda s:replace(s,'font-weight: 400;','font-weight: 650;\n  letter-spacing: -0.02em;'))
    edit('chrome/browser/resources/password_manager/checkup_section.css',lambda s:replace(replace(s,'background-color: var(--google-grey-50);','background-color: var(--cr-card-background-color);'),'background-color: #1F1F1F;','background-color: var(--cr-card-background-color);'))
    edit('chrome/browser/resources/password_manager/images/password_manager_logo.svg',lambda s:merlin_mark.tile_svg())
    patch=[]
    for path,(before,after) in edits.items():
        for line in difflib.unified_diff(before.splitlines(True),after.splitlines(True),fromfile='a/'+path,tofile='b/'+path):
            patch.append(line if line.endswith('\n') else line+'\n\\ No newline at end of file\n')
    return ''.join(patch)


def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--src',type=Path,default=Path.home()/'chromium/src');p.add_argument('--check',action='store_true');a=p.parse_args()
    patch=ROOT/'patches/0032-merlin-shared-presentation.patch';result=generate(a.src)
    if a.check:
        if not patch.exists() or patch.read_text()!=result: raise SystemExit('identity patch is stale')
        print('identity patch: current')
    else: patch.write_text(result);print('identity patch: generated')

if __name__=='__main__':main()
