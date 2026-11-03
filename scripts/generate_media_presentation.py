#!/usr/bin/env python3
"""Opt-in media layout parameters and Merlin-owned Views, retaining all services."""
import argparse
import difflib
from pathlib import Path
from generate_password_headers import base
from generate_design_tokens import ROOT

PATCH = '0044-merlin-media-layout.patch'


def edits(src):
    changes = {}
    def edit(path, transform):
        before = base(src, path, PATCH)
        after = transform(before)
        if before == after:
            raise ValueError('missing media presentation hook: ' + path)
        changes[path] = before, after
    def rep(text, old, new):
        if text.count(old) != 1:
            raise ValueError('media source boundary changed: ' + old[:90])
        return text.replace(old, new)
    path = 'components/global_media_controls/public/views/media_item_ui_updated_view.h'
    def header(text):
        text = rep(text, '#include <vector>', '#include <vector>\n\n#include "base/functional/callback.h"')
        text = rep(text, 'class MediaItemUIObserver;', '''class MediaItemUIObserver;

// Optional presentation-only customization. Defaults retain the upstream
// layout. All controls continue to be owned and updated by this media item.
struct MediaItemUIPresentationViews {
  raw_ptr<views::View> card;
  raw_ptr<views::ImageView> artwork;
  raw_ptr<views::ImageView> favicon;
  raw_ptr<views::ImageView> casting_indicator;
  raw_ptr<views::Label> source;
  raw_ptr<views::Label> title;
  raw_ptr<views::Label> artist;
  raw_ptr<views::Label> elapsed;
  raw_ptr<views::Label> duration;
  raw_ptr<MediaProgressView> progress;
  raw_ptr<MediaLiveStatusView> live_status;
  std::vector<raw_ptr<MediaActionButton>> actions;
  raw_ptr<MediaActionButton> save_frame;
  raw_ptr<MediaActionButton> picture_in_picture;
  raw_ptr<MediaActionButton> cast;
};

struct MediaItemUIPresentation {
  int width = 400;
  gfx::Size artwork_size = gfx::Size(80, 80);
  int artwork_radius = 8;
  gfx::Size primary_action_size = gfx::Size(48, 48);
  int primary_action_icon_size = 24;
  int primary_action_radius = 24;
  bool persistent_timestamps = false;
  bool hide_empty_artist = false;
  base::OnceCallback<void(MediaItemUIPresentationViews)> layout;
};''')
        text = rep(text, '      std::unique_ptr<MediaItemUIFooter> footer_view);',
                   '      std::unique_ptr<MediaItemUIFooter> footer_view,\n      MediaItemUIPresentation presentation = {});')
        return rep(text, '  // Init parameters.', '  MediaItemUIPresentation presentation_;\n\n  // Init parameters.')
    edit(path, header)
    path = 'components/global_media_controls/public/views/media_item_ui_updated_view.cc'
    def implementation(text):
        text = rep(text, '    std::unique_ptr<MediaItemUIFooter> footer_view)\n',
                   '    std::unique_ptr<MediaItemUIFooter> footer_view,\n    MediaItemUIPresentation presentation)\n')
        text = rep(text, '    : id_(id), item_(std::move(item)), media_color_theme_(media_color_theme) {',
                   '    : presentation_(std::move(presentation)),\n      id_(id), item_(std::move(item)), media_color_theme_(media_color_theme) {')
        for line in ('constexpr int kFixedWidth = 400;\n',
                     'constexpr int kArtworkCornerRadius = 8;\n',
                     'constexpr int kPlayPauseButtonIconSize = 24;\n',
                     'constexpr gfx::Size kArtworkSize = gfx::Size(80, 80);\n',
                     'constexpr gfx::Size kPlayPauseButtonSize = gfx::Size(48, 48);\n'):
            text = rep(text, line, '')
        for old, new in (
            ('kFixedWidth', 'presentation_.width'),
            ('kArtworkCornerRadius', 'presentation_.artwork_radius'),
            ('kArtworkSize', 'presentation_.artwork_size'),
            ('kPlayPauseButtonIconSize', 'presentation_.primary_action_icon_size'),
            ('kPlayPauseButtonSize', 'presentation_.primary_action_size')):
            text = text.replace(old, new)
        text = rep(text, 'views::CreatePillBackground(\n      media_color_theme_.play_button_container_color_id)',
                   'views::CreateRoundedRectBackground(\n      media_color_theme_.play_button_container_color_id, presentation_.primary_action_radius)')
        for state in ('play', 'pause'):
            text = rep(text, f'views::CreatePillBackground(\n        media_color_theme_.{state}_button_container_color_id)',
                       f'views::CreateRoundedRectBackground(\n        media_color_theme_.{state}_button_container_color_id, presentation_.primary_action_radius)')
        text = rep(text, '  item_->SetView(this);', '''  if (presentation_.layout) {
    std::move(presentation_.layout).Run({
        this, artwork_view_, favicon_view_, casting_indicator_view_,
        source_label_, title_label_, artist_label_,
        current_timestamp_label_, duration_timestamp_label_, progress_view_,
        live_status_view_, media_action_buttons_, save_video_frame_button_,
        picture_in_picture_button_, start_casting_button_});
  }
  item_->SetView(this);''')
        text = rep(text, '  artist_label_->SetText(metadata.artist);',
                   '  artist_label_->SetText(metadata.artist);\n  if (presentation_.hide_empty_artist) {\n    artist_label_->SetVisible(!metadata.artist.empty());\n  }')
        text = rep(text, '  is_live_ = position.duration().is_max();',
                   '  is_live_ = position.duration().is_max();\n  if (presentation_.persistent_timestamps) {\n    UpdateTimestampLabelsVisibility();\n  }')
        text = rep(text, 'current_timestamp_label_->SetVisible(drag_state_ == DragState::kDragStarted);',
                   'current_timestamp_label_->SetVisible(presentation_.persistent_timestamps ? !is_live_ : drag_state_ == DragState::kDragStarted);')
        return rep(text, 'duration_timestamp_label_->SetVisible(drag_state_ == DragState::kDragStarted);',
                   'duration_timestamp_label_->SetVisible(presentation_.persistent_timestamps ? !is_live_ : drag_state_ == DragState::kDragStarted);')
    edit(path, implementation)
    path = 'chrome/browser/ui/views/global_media_controls/media_dialog_view.cc'
    def dialog(text):
        text = rep(text, '#include "chrome/browser/profiles/profile.h"',
                   '#include "chrome/browser/profiles/profile.h"\n#include "chrome/browser/ui/modal_browser/merlin_media_controls.h"')
        needle = '''    SetLayoutManager(std::make_unique<views::FillLayout>());
    return;'''
        text = rep(text, needle, '''    SetLayoutManager(std::make_unique<views::FillLayout>());
    modal_browser::ApplyMerlinMediaDialog(
        {this, active_sessions_view_, nullptr, nullptr, nullptr, nullptr,
         nullptr, nullptr, nullptr});
    return;''')
        needle = '''    InitializeCaptionSettingsSection();
  }
}'''
        text = rep(text, needle, '''    InitializeCaptionSettingsSection();
  }
  modal_browser::ApplyMerlinMediaDialog(
      {this, active_sessions_view_, live_caption_container_, live_caption_title_,
       live_translate_container_, live_translate_title_,
       caption_settings_container_, caption_settings_button_, separator_});
}''')
        text = rep(text, '      id, item, media_color_theme_,\n',
                   '      id, item, modal_browser::MerlinMediaColors(media_color_theme_),\n')
        return rep(text, '      BuildFooter(id, item, profile_, media_color_theme_));\n}\n\nBEGIN_METADATA(MediaDialogView)',
                   '      BuildFooter(id, item, profile_, media_color_theme_),\n      modal_browser::MerlinMediaItemPresentation());\n}\n\nBEGIN_METADATA(MediaDialogView)')
    edit(path, dialog)
    path = 'chrome/browser/ui/views/global_media_controls/BUILD.gn'
    edit(path, lambda text: rep(text, 'source_set("impl") {',
         'source_set("impl") {\n  public_deps = [ "//chrome/browser/ui/modal_browser:media_presentation" ]'))
    return changes


def generate(src):
    return ''.join(''.join(difflib.unified_diff(a.splitlines(True), b.splitlines(True),
                   fromfile='a/' + path, tofile='b/' + path)) for path, (a,b) in edits(src).items())


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--src', type=Path, default=Path.home() / 'chromium/src')
    p.add_argument('--check', action='store_true')
    a = p.parse_args()
    content = generate(a.src)
    target = ROOT / 'patches' / PATCH
    if a.check:
        if target.read_text() != content:
            raise SystemExit('media layout patch is stale')
    else:
        target.write_text(content)
    print('Media layout patch: current' if a.check else 'Media layout patch: generated')


if __name__ == '__main__':
    main()
