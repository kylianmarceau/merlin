#!/usr/bin/env python3
"""Use Merlin's decorative header component while retaining upstream dialog logic."""
import argparse
import difflib
import json
from pathlib import Path
import re
from generate_password_headers import base
from generate_design_tokens import ROOT

PATCH = '0041-merlin-autofill-passkey-headers.patch'
HEADERS = json.loads((ROOT / 'branding/native_header_overrides.json').read_text())


def generate(src):
    changes = {}
    targets = {}
    include = '#include "chrome/browser/ui/modal_browser/merlin_bubble_header.h"\n'
    for path, tone in HEADERS.items():
        before = base(src, path, PATCH)
        # Wrap only the decorative header. Controls, data/provider logos,
        # consent text and upstream experiment selection stay intact.
        after, count = re.subn(r'SetHeaderView\(std::move\((\w+)\)\);',
            lambda m: 'SetHeaderView(modal_browser::MerlinBubbleHeaderOrDefault(\n'
                      '      std::move(' + m[1] + '), modal_browser::BubbleHeaderTone::' + tone + '));', before)
        if count != 1 or 'GetThemedLottieImageNamed' not in before:
            raise ValueError('autofill decorative hook changed: ' + path)
        end = after.index('\n', after.index('#include ')) + 1
        after = after[:end] + include + after[end:]
        changes[path] = before, after
        build = str(Path(path).parent) + '/BUILD.gn'
        text = base(src, build, PATCH)
        blocks = list(re.finditer(r'source_set\("([^"]+)"\) \{', text))
        for i, match in enumerate(blocks):
            block = text[match.end():blocks[i+1].start() if i+1<len(blocks) else len(text)]
            if re.search(r'"' + re.escape(Path(path).name) + r'"', block) and 'testonly = true' not in block:
                targets.setdefault(build, set()).add(match[1])
                break
        else:
            raise ValueError('missing native header GN target: ' + path)
    for path, names in targets.items():
        before = base(src, path, PATCH)
        after = before
        for name in sorted(names):
            needle = f'source_set("{name}") {{'
            start = after.index(needle) + len(needle)
            end = after.find('\nsource_set(', start)
            end = len(after) if end < 0 else end
            block = after[start:end]
            pattern = r'(\n\s+(?:public_)?deps = \[)'
            block, count = re.subn(pattern, r'\1\n    "//chrome/browser/ui/modal_browser:presentation",', block, count=1)
            if count != 1:
                raise ValueError('native header dependencies changed: ' + name)
            after = after[:start] + block + after[end:]
        changes[path] = before, after
    path = 'chrome/browser/ui/views/webauthn/authenticator_request_sheet_view.cc'
    before = base(src, path, PATCH)
    needle = '  constexpr int kImageHeight = 112;'
    if before.count(needle) != 1:
        raise ValueError('authenticator illustration boundary changed')
    after = before.replace(needle, '''  if (model()->lottie_illustrations() &&
      !base::CommandLine::ForCurrentProcess()->HasSwitch(
          "modal-browser-upstream-defaults")) {
    using Tone = modal_browser::BubbleHeaderTone;
    // Only static passkey/PIN decoration. Phone/laptop instructions, QR,
    // connection animation, activity indicators and security controls stay.
    switch (model()->lottie_illustrations()->get(false)) {
      case IDR_WEBAUTHN_PASSKEY_LIGHT:
      case IDR_WEBAUTHN_GPM_PASSKEY_LIGHT:
        return modal_browser::CreateMerlinBubbleHeader(Tone::kPasskey);
      case IDR_WEBAUTHN_GPM_PIN_LOCKED_LIGHT:
        return modal_browser::CreateMerlinBubbleHeader(Tone::kDanger);
      default:
        break;
    }
  }
''' + needle)
    end = after.index('\n', after.index('#include ')) + 1
    after = after[:end] + include + '#include "chrome/grit/browser_resources.h"\n' + after[end:]
    changes[path] = before, after
    path = 'chrome/browser/ui/views/webauthn/BUILD.gn'
    before = base(src, path, PATCH)
    needle = '  public_deps = ['
    changes[path] = before, before.replace(needle,
        needle + '\n    "//chrome/browser/ui/modal_browser:presentation",', 1)
    return ''.join(''.join(difflib.unified_diff(a.splitlines(True), b.splitlines(True),
                   fromfile='a/' + path, tofile='b/' + path)) for path, (a,b) in changes.items())


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--src', type=Path, default=Path.home() / 'chromium/src')
    p.add_argument('--check', action='store_true')
    a = p.parse_args()
    content = generate(a.src)
    target = ROOT / 'patches' / PATCH
    if a.check:
        if target.read_text() != content:
            raise SystemExit('autofill/passkey header patch is stale')
    else:
        target.write_text(content)
    print('Autofill/passkey header patch: current' if a.check else 'Autofill/passkey header patch: generated')


if __name__ == '__main__':
    main()
