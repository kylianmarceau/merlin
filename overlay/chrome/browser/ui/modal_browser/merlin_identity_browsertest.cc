// Copyright 2026 The Merlin Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#include "base/environment.h"
#include "base/files/file_util.h"
#include "base/files/scoped_temp_dir.h"
#include "base/run_loop.h"
#include "base/test/run_until.h"
#include "base/test/test_future.h"
#include "base/threading/thread_restrictions.h"
#include "chrome/app/chrome_command_ids.h"
#include "chrome/browser/devtools/devtools_window_testing.h"
#include "chrome/browser/printing/print_preview_dialog_controller.h"
#include "chrome/browser/printing/print_view_manager_common.h"
#include "chrome/browser/printing/test_print_preview_observer.h"
#include "chrome/browser/profiles/profile.h"
#include "chrome/browser/themes/theme_service.h"
#include "chrome/browser/themes/theme_service_factory.h"
#include "chrome/browser/ui/autofill/payments/save_card_bubble_controller_impl.h"
#include "chrome/browser/ui/browser_commands.h"
#include "chrome/browser/ui/global_media_controls/media_notification_service_factory.h"
#include "chrome/browser/ui/modal_browser/browserctl_server.h"
#include "chrome/browser/ui/modal_browser/config_file.h"
#include "chrome/browser/ui/modal_browser/merlin_address_editor.h"
#include "chrome/browser/ui/modal_browser/merlin_design_tokens.h"
#include "chrome/browser/ui/modal_browser/merlin_toolbar.h"
#include "chrome/browser/ui/modal_browser/modal_style.h"
#include "chrome/browser/ui/modal_browser/merlin_safety_controls.h"
#include "chrome/browser/ui/modal_browser/merlin_theme.h"
#include "chrome/browser/ui/modal_browser/modal_browser_controller.h"
#include "chrome/browser/ui/modal_browser/workspace_store.h"
#include "chrome/browser/ui/passwords/manage_passwords_test.h"
#include "chrome/browser/ui/passwords/manage_passwords_ui_controller.h"
#include "chrome/browser/ui/permission_bubble/permission_bubble_test_util.h"
#include "chrome/browser/ui/tabs/tab_strip_model.h"
#include "chrome/browser/ui/views/autofill/payments/save_card_offer_bubble_views.h"
#include "chrome/browser/ui/views/chrome_layout_provider.h"
#include "chrome/browser/ui/views/frame/browser_view.h"
#include "chrome/browser/ui/views/global_media_controls/cast_device_selector_view.h"
#include "chrome/browser/ui/views/global_media_controls/media_dialog_view.h"
#include "chrome/browser/ui/views/global_media_controls/media_item_ui_helper.h"
#include "chrome/browser/ui/views/page_info/page_info_bubble_view_base.h"
#include "chrome/browser/ui/views/passwords/password_bubble_view_base.h"
#include "chrome/browser/ui/views/passwords/password_save_update_view.h"
#include "chrome/browser/ui/views/permissions/permission_prompt_bubble_base_view.h"
#include "chrome/browser/ui/views/permissions/permission_prompt_bubble_view_factory.h"
#include "chrome/browser/ui/views/profiles/profile_menu_coordinator.h"
#include "chrome/browser/ui/views/profiles/profile_menu_view_base.h"
#include "chrome/browser/ui/views/toolbar/toolbar_view.h"
#include "chrome/browser/ui/views/webauthn/authenticator_request_dialog_view.h"
#include "chrome/browser/ui/views/webauthn/authenticator_request_dialog_view_controller_views.h"
#include "chrome/browser/webauthn/authenticator_request_dialog_model.h"
#include "chrome/test/base/interactive_test_utils.h"
#include "chrome/test/base/ui_test_utils.h"
#include "components/autofill/core/browser/data_model/payments/credit_card.h"
#include "components/autofill/core/browser/payments/payments_autofill_client.h"
#include "components/global_media_controls/public/views/media_action_button.h"
#include "components/global_media_controls/public/views/media_item_ui_updated_view.h"
#include "components/permissions/test/mock_permission_request.h"
#include "components/viz/common/frame_sinks/copy_output_request.h"
#include "components/viz/common/frame_sinks/copy_output_result.h"
#include "content/public/browser/plugin_service.h"
#include "content/public/browser/render_widget_host_view.h"
#include "content/public/browser/web_contents.h"
#include "content/public/test/browser_test.h"
#include "content/public/test/browser_test_utils.h"
#include "content/public/test/test_navigation_observer.h"
#include "net/test/embedded_test_server/embedded_test_server.h"
#include "services/media_session/public/mojom/media_session.mojom.h"
#include "ui/color/color_id.h"
#include "ui/color/color_provider.h"
#include "ui/color/color_provider_key.h"
#include "ui/compositor/compositor.h"
#include "ui/compositor/layer.h"
#include "ui/gfx/codec/png_codec.h"
#include "ui/gfx/color_utils.h"
#include "ui/views/bubble/bubble_border.h"
#include "ui/views/bubble/bubble_frame_view.h"
#include "ui/views/controls/button/md_text_button.h"
#include "ui/views/controls/image_view.h"
#include "ui/views/controls/styled_label.h"
#include "ui/views/controls/textfield/textfield.h"
#include "ui/views/merlin_style.h"
#include "ui/views/focus/focus_manager.h"
#include "ui/views/metrics.h"
#include "ui/views/test/button_test_api.h"
#include "ui/views/test/views_drawing_test_utils.h"
#include "ui/views/widget/widget.h"

namespace modal_browser {

// Real Chromium controllers and templates; synthetic profile/credentials only.
// Optional PNGs are captured from rendered WebContents/native Views, never
// mocks.
class MerlinIdentityBrowserTest : public ManagePasswordsTest {
 protected:
  void SetUpCommandLine(base::CommandLine* command_line) override {
    ManagePasswordsTest::SetUpCommandLine(command_line);
    base::ScopedAllowBlockingForTesting allow;
    if (!directory_.IsValid()) {
      ASSERT_TRUE(directory_.CreateUniqueTempDir());
    }
    command_line->AppendSwitchPath(kBrowserctlSocketSwitch,
                                   directory_.GetPath().Append("browser.sock"));
    // Printing deliberately uses a different service in headless Chromium.
    // Run this one case as a background, non-activating normal browser so it
    // exercises the actual preview service rather than substituting it.
    if (std::string_view(
            testing::UnitTest::GetInstance()->current_test_info()->name()) ==
        "PrintPreviewPresentation") {
      command_line->RemoveSwitch("headless");
    }
    command_line->AppendSwitch("mute-audio");
    command_line->AppendSwitchASCII("autoplay-policy",
                                    "no-user-gesture-required");
  }

  void SetUpInProcessBrowserTestFixture() override {
    ManagePasswordsTest::SetUpInProcessBrowserTestFixture();
    base::ScopedAllowBlockingForTesting allow;
    if (!directory_.IsValid()) {
      ASSERT_TRUE(directory_.CreateUniqueTempDir());
    }
    config_file::SetConfigPathForTesting(directory_.GetPath().Append("config"));
    workspace_store::SetDirectoryForTesting(
        directory_.GetPath().Append("workspaces"));
  }

  void TearDownOnMainThread() override {
    if (PasswordBubbleViewBase::manage_password_bubble()) {
      PasswordBubbleViewBase::CloseCurrentBubble();
    }
    MediaDialogView::HideDialog();
    base::RunLoop().RunUntilIdle();
    ManagePasswordsTest::TearDownOnMainThread();
  }

  content::WebContents* contents() {
    return browser()->GetTabStripModel()->GetActiveWebContents();
  }

  bool StartMedia(const std::string& title) {
    if (!ui_test_utils::NavigateToURL(
            browser(), embedded_test_server()->GetURL("/empty.html"))) {
      return false;
    }
    return content::EvalJs(contents(), content::JsReplace(R"JS((async () => {
      const media = document.createElement('video');
      media.id = 'media'; media.src = '/media/bigbuck.webm'; media.loop = true;
      document.body.append(media);
      const art = document.createElement('canvas');
      art.width = art.height = 384;
      const paint = art.getContext('2d');
      paint.scale(4, 4);
      paint.fillStyle = '#12352E'; paint.fillRect(0, 0, 96, 96);
      paint.fillStyle = '#F2ECE0'; paint.fillRect(16, 22, 64, 52);
      paint.fillStyle = '#C4552D'; paint.fillRect(28, 34, 40, 28);
      window.fixtureArtwork = [{src: art.toDataURL('image/png'), sizes: '384x384', type: 'image/png'}];
      navigator.mediaSession.metadata = new MediaMetadata({
        title: $1, artist: 'Browser UI verification',
        artwork: window.fixtureArtwork
      });
      const updatePosition = () => {
        if (Number.isFinite(media.duration)) {
          navigator.mediaSession.setPositionState({
            duration: window.fixtureLive ? Infinity : media.duration,
            position: media.currentTime, playbackRate: media.playbackRate
          });
          navigator.mediaSession.playbackState = media.paused ? 'paused' : 'playing';
        }
      };
      window.updateFixturePosition = updatePosition;
      for (const event of ['timeupdate', 'seeked', 'play', 'pause', 'ratechange']) {
        media.addEventListener(event, updatePosition);
      }
      navigator.mediaSession.setActionHandler('seekto', event => { media.currentTime = event.seekTime; });
      navigator.mediaSession.setActionHandler('seekbackward', () => { media.currentTime = Math.max(0, media.currentTime - 10); });
      navigator.mediaSession.setActionHandler('seekforward', () => { media.currentTime = Math.min(media.duration, media.currentTime + 10); });
      await media.play();
      updatePosition();
      return !media.paused;
    })())JS",
                                                          title))
        .ExtractBool();
  }

  void SetDark(bool dark) {
    ThemeServiceFactory::GetForProfile(browser()->GetProfile())
        ->SetBrowserColorScheme(dark
                                    ? ThemeService::BrowserColorScheme::kDark
                                    : ThemeService::BrowserColorScheme::kLight);
    base::RunLoop().RunUntilIdle();
  }

  void Save(const SkBitmap& bitmap, const std::string& name) {
    auto path =
        base::Environment::Create()->GetVar("MERLIN_IDENTITY_SCREENSHOTS");
    if (!path || path->empty()) {
      return;
    }
    base::ScopedAllowBlockingForTesting allow;
    ASSERT_TRUE(base::CreateDirectory(base::FilePath(*path)));
    auto png = gfx::PNGCodec::EncodeBGRASkBitmap(bitmap, false);
    ASSERT_TRUE(png);
    ASSERT_TRUE(base::WriteFile(
        base::FilePath(*path).AppendASCII(name + ".png"), *png));
  }

  void SnapPage(const std::string& name,
                content::WebContents* target = nullptr) {
    if (!target) {
      target = contents();
    }
    base::test::TestFuture<const content::CopyFromSurfaceResult&> capture;
    target->GetRenderWidgetHostView()->CopyFromSurface(
        gfx::Rect(), gfx::Size(), base::Seconds(5), capture.GetCallback());
    ASSERT_TRUE(capture.Get().has_value());
    Save(capture.Get()->bitmap, name);
  }

  void SnapWidget(views::Widget* widget, const std::string& name) {
    widget->LayoutRootViewIfNecessary();
    auto* compositor = widget->GetCompositor();
    ASSERT_TRUE(compositor);
    base::test::TestFuture<std::unique_ptr<viz::CopyOutputResult>> capture;
    auto request = std::make_unique<viz::CopyOutputRequest>(
        viz::CopyOutputRequest::ResultFormat::RGBA,
        viz::CopyOutputRequest::ResultDestination::kSystemMemory,
        capture.GetCallback());
    compositor->root_layer()->RequestCopyOfOutput(std::move(request));
    compositor->ScheduleDraw();
    auto result = capture.Take();
    ASSERT_FALSE(result->IsEmpty());
    auto pixels = result->ScopedAccessSkBitmap();
    Save(pixels.GetOutScopedBitmap(), name);
  }

 private:
  base::ScopedTempDir directory_;
};

IN_PROC_BROWSER_TEST_F(MerlinIdentityBrowserTest,
                       NativeTokensAndAccessibleOverrides) {
  for (bool dark : {false, true}) {
    SetDark(dark);
    const auto* provider =
        BrowserView::GetBrowserViewForBrowser(browser())->GetColorProvider();
    const auto& palette = dark ? design::kDark : design::kLight;
    EXPECT_EQ(provider->GetColor(ui::kColorSysSurface2), palette.surface);
    EXPECT_EQ(provider->GetColor(ui::kColorSysSurface5), palette.base_elevated);
    EXPECT_EQ(provider->GetColor(ui::kColorSysOnSurface), palette.on_surface);
    EXPECT_GE(
        color_utils::GetContrastRatio(palette.focus_ring, palette.surface),
        3.0f);
    EXPECT_EQ(ChromeLayoutProvider::Get()->GetCornerRadiusMetric(
                  views::kButtonRadius),
              design::kControlRadius);
    // Secondary buttons are a quiet fill with no Chromium outline.
    EXPECT_EQ(provider->GetColor(ui::kColorButtonBorder), SK_ColorTRANSPARENT);
    EXPECT_EQ(provider->GetColor(ui::kColorCheckboxContainer), palette.accent);
    // Pop-ups are grey panels with grey buttons, as macOS popovers are; the
    // default action is a stronger grey, not a different color.
    EXPECT_EQ(provider->GetColor(ui::kColorBubbleBackground), palette.popover);
    EXPECT_EQ(provider->GetColor(ui::kColorButtonBackgroundTonal),
              palette.popover_control);
    EXPECT_EQ(provider->GetColor(ui::kColorButtonBackgroundProminent),
              palette.popover_control_strong);
  }
  // Merlin's control shapes come on with its colors.
  EXPECT_TRUE(views::merlin_style::IsEnabled());
  ui::ColorProviderKey key;
  key.contrast_mode = ui::ColorProviderKey::ContrastMode::kHigh;
  EXPECT_FALSE(MerlinThemeApplies(key));
  key.contrast_mode = ui::ColorProviderKey::ContrastMode::kNormal;
  key.forced_colors = ui::ColorProviderKey::ForcedColors::kSystem;
  EXPECT_FALSE(MerlinThemeApplies(key));
}

IN_PROC_BROWSER_TEST_F(MerlinIdentityBrowserTest, InheritedWebUIPages) {
  struct Page {
    const char* url;
    const char* name;
  };
  constexpr Page pages[] = {
      {"chrome://merlin-settings/", "settings"},
      {"chrome://merlin-start/", "start"},
      {"chrome://merlin-history/", "history"},
      {"chrome://merlin-downloads/", "downloads"},
      {"chrome://merlin-bookmarks/", "bookmarks"},
      {"chrome://password-manager/passwords", "passwords"},
      {"chrome://password-manager/checkup", "password-checkup"},
      {"chrome://password-manager/settings", "password-settings"},
      {"chrome://settings/content", "permissions"},
      {"chrome://settings/addresses", "addresses"},
      {"chrome://settings/payments", "payments"},
      {"chrome://settings/security", "security"},
      {"chrome://extensions/", "extensions"},
      {"chrome://certificate-manager/", "certificates"},
  };
  auto* widget = BrowserView::GetBrowserViewForBrowser(browser())->GetWidget();
  for (bool dark : {false, true}) {
    SetDark(dark);
    const std::string mode = dark ? "dark-" : "light-";
    for (const auto& page : pages) {
      SCOPED_TRACE(page.url);
      ASSERT_TRUE(ui_test_utils::NavigateToURL(browser(), GURL(page.url)));
      ASSERT_TRUE(content::WaitForLoadStop(contents()));
      ASSERT_TRUE(content::EvalJs(contents(), R"JS(
        new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve(true)))))JS")
                      .ExtractBool());
      // --bg is generated once for both custom Merlin pages and inherited apps.
      EXPECT_EQ(dark ? "#161512" : "#FDFCF8",
                content::EvalJs(contents(),
                                "getComputedStyle(document.documentElement)."
                                "getPropertyValue('--bg').trim()"));
      EXPECT_EQ("", content::EvalJs(contents(), R"JS((() => {
        const text = root => Array.from(root.childNodes || []).map(node => {
          if (node.nodeType === Node.TEXT_NODE) {
            const parent = node.parentElement;
            return parent && parent.getClientRects().length ? node.textContent : '';
          }
          if (node.nodeType !== Node.ELEMENT_NODE ||
              /^(SCRIPT|STYLE|TEMPLATE)$/.test(node.tagName) ||
              getComputedStyle(node).visibility === 'hidden') return '';
          const accessible = node.getClientRects().length ?
              [node.getAttribute('aria-label'), node.getAttribute('title')].filter(Boolean).join(' ') : '';
          return accessible + ' ' + text(node.shadowRoot || node);
        }).join(' ');
        return (text(document.body).replaceAll('Chrome Root Store', '').replaceAll('Chrome Root Program', '').replaceAll('Chrome Web Store', '').replace(/\/(?:Users|var|private|tmp)\/[^\s\u200E]+/g, '').match(/.{0,60}\b(?:Chrome|Chromium)\b.{0,60}/g) || []).join(' | ');
      })())JS"));
      SnapPage(mode + page.name);
      widget->SetBounds(gfx::Rect(0, 0, 640, 800));
      base::RunLoop().RunUntilIdle();
      SnapPage(mode + page.name + "-narrow");
      widget->SetBounds(gfx::Rect(0, 0, 1280, 900));
    }
  }
}

IN_PROC_BROWSER_TEST_F(MerlinIdentityBrowserTest, PasswordPromptSaveAndCancel) {
  for (bool dark : {false, true}) {
    SetDark(dark);
    SetupPendingPassword();
    ASSERT_TRUE(base::test::RunUntil([] {
      return PasswordBubbleViewBase::manage_password_bubble() != nullptr;
    }));
    auto* bubble = static_cast<PasswordSaveUpdateView*>(
        PasswordBubbleViewBase::manage_password_bubble());
    ASSERT_TRUE(bubble->GetOkButtonForTesting());
    EXPECT_FALSE(bubble->GetWindowTitle().empty());
    auto* widget = bubble->GetWidget();
    bubble->GetOkButtonForTesting()->RequestFocus();
    EXPECT_EQ(widget->GetFocusManager()->GetFocusedView(),
              bubble->GetOkButtonForTesting());
    widget->GetFocusManager()->AdvanceFocus(false);
    EXPECT_NE(widget->GetFocusManager()->GetFocusedView(), nullptr);
    SnapWidget(widget, dark ? "dark-password-save" : "light-password-save");
    if (dark) {
      views::test::ButtonTestApi(bubble->GetOkButtonForTesting())
          .NotifyDefaultMouseClick();
      EXPECT_NE(GetController()->GetState(),
                password_manager::ui::PENDING_PASSWORD_STATE);
    } else {
      bubble->CancelDialog();
    }
    base::RunLoop().RunUntilIdle();
  }
}

IN_PROC_BROWSER_TEST_F(MerlinIdentityBrowserTest, PasswordSuccessHeader) {
  for (bool dark : {false, true}) {
    SetDark(dark);
    SetupSafeState();
    if (!PasswordBubbleViewBase::manage_password_bubble()) {
      PasswordBubbleViewBase::ShowBubble(
          contents(), LocationBarBubbleDelegateView::USER_GESTURE);
    }
    ASSERT_TRUE(PasswordBubbleViewBase::manage_password_bubble());
    SnapWidget(PasswordBubbleViewBase::manage_password_bubble()->GetWidget(),
               dark ? "dark-password-success" : "light-password-success");
    PasswordBubbleViewBase::CloseCurrentBubble();
    base::RunLoop().RunUntilIdle();
  }
}

IN_PROC_BROWSER_TEST_F(MerlinIdentityBrowserTest, PasswordReviewHeader) {
  for (bool dark : {false, true}) {
    SetDark(dark);
    SetupMoreToFixState();
    if (!PasswordBubbleViewBase::manage_password_bubble()) {
      PasswordBubbleViewBase::ShowBubble(
          contents(), LocationBarBubbleDelegateView::USER_GESTURE);
    }
    ASSERT_TRUE(PasswordBubbleViewBase::manage_password_bubble());
    SnapWidget(PasswordBubbleViewBase::manage_password_bubble()->GetWidget(),
               dark ? "dark-password-review" : "light-password-review");
    PasswordBubbleViewBase::CloseCurrentBubble();
    base::RunLoop().RunUntilIdle();
  }
}

IN_PROC_BROWSER_TEST_F(MerlinIdentityBrowserTest, MediaPlaybackControls) {
  ASSERT_TRUE(StartMedia("Merlin media fixture"));
  for (bool dark : {false, true}) {
    SetDark(dark);
    auto* view = BrowserView::GetBrowserViewForBrowser(browser());
    auto* service =
        MediaNotificationServiceFactory::GetForProfile(browser()->GetProfile());
    auto* widget = MediaDialogView::ShowDialogFromToolbar(
        views::BubbleAnchor(view->toolbar()), service, browser()->GetProfile());
    ASSERT_TRUE(widget);
    ASSERT_TRUE(base::test::RunUntil([] {
      return MediaDialogView::IsShowing() &&
             !MediaDialogView::GetDialogViewForTesting()
                  ->GetItemsForTesting()
                  .empty();
    }));
    auto* item = MediaDialogView::GetDialogViewForTesting()
                     ->GetItemsForTesting()
                     .begin()
                     ->second.get();
    ASSERT_TRUE(base::test::RunUntil([&] {
      return item->GetMediaActionButtonForTesting(
                 media_session::mojom::MediaSessionAction::kPause) != nullptr;
    }));
    ASSERT_TRUE(base::test::RunUntil(
        [&] { return item->GetArtworkViewForTesting()->GetVisible(); }));
    auto* primary = item->GetMediaActionButtonForTesting(
        media_session::mojom::MediaSessionAction::kPause);
    widget->LayoutRootViewIfNecessary();
    EXPECT_EQ(gfx::Size(44, 32), primary->GetPreferredSize());
    EXPECT_EQ(gfx::Size(48, 48),
              item->GetArtworkViewForTesting()->GetPreferredSize());
    EXPECT_GT(primary->GetBoundsInScreen().y(),
              item->GetProgressViewForTesting()->GetBoundsInScreen().bottom());
    SnapWidget(widget, dark ? "dark-media" : "light-media");
    views::test::ButtonTestApi(
        item->GetMediaActionButtonForTesting(
            media_session::mojom::MediaSessionAction::kPause))
        .NotifyDefaultMouseClick();
    ASSERT_TRUE(base::test::RunUntil([&] {
      return content::EvalJs(contents(),
                             "document.querySelector('#media').paused")
          .ExtractBool();
    }));
    ASSERT_TRUE(base::test::RunUntil([&] {
      return item->GetMediaActionButtonForTesting(
                 media_session::mojom::MediaSessionAction::kPlay) != nullptr;
    }));
    SnapWidget(widget, dark ? "dark-media-paused" : "light-media-paused");
    auto* progress = item->GetProgressViewForTesting();
    progress->RequestFocus();
    EXPECT_EQ(progress, progress->GetFocusManager()->GetFocusedView());
    const double before_seek =
        content::EvalJs(contents(),
                        "document.querySelector('#media').currentTime")
            .ExtractDouble();
    const double duration =
        content::EvalJs(contents(), "document.querySelector('#media').duration")
            .ExtractDouble();
    ASSERT_TRUE(base::test::RunUntil([&] {
      const double shown = progress->current_value_for_testing() * duration;
      return shown >= before_seek - 0.25 && shown <= before_seek + 0.25;
    }));
    EXPECT_TRUE(progress->OnKeyPressed(
        ui::KeyEvent(ui::EventType::kKeyPressed, ui::VKEY_RIGHT, ui::EF_NONE)));
    ASSERT_TRUE(base::test::RunUntil([&] {
      return content::EvalJs(contents(),
                             "document.querySelector('#media').currentTime")
                 .ExtractDouble() > before_seek + 1;
    }));
    views::test::ButtonTestApi(
        item->GetMediaActionButtonForTesting(
            media_session::mojom::MediaSessionAction::kPlay))
        .NotifyDefaultMouseClick();
    ASSERT_TRUE(base::test::RunUntil([&] {
      return !content::EvalJs(contents(),
                              "document.querySelector('#media').paused")
                  .ExtractBool();
    }));
    EXPECT_TRUE(content::ExecJs(contents(), R"JS(
      navigator.mediaSession.metadata = new MediaMetadata({
        title: 'Media without artwork', artist: 'Browser UI verification'
      });
    )JS"));
    ASSERT_TRUE(base::test::RunUntil(
        [&] { return !item->GetArtworkViewForTesting()->GetVisible(); }));
    SnapWidget(widget,
               dark ? "dark-media-no-artwork" : "light-media-no-artwork");
    EXPECT_TRUE(content::ExecJs(contents(), R"JS(
      window.fixtureLive = true;
      window.updateFixturePosition();
    )JS"));
    ASSERT_TRUE(base::test::RunUntil(
        [&] { return item->GetLiveStatusViewForTesting()->GetVisible(); }));
    EXPECT_FALSE(item->GetProgressViewForTesting()->GetVisible());
    EXPECT_FALSE(item->GetCurrentTimestampLabelForTesting()->GetVisible());
    EXPECT_FALSE(item->GetDurationTimestampLabelForTesting()->GetVisible());
    EXPECT_FALSE(item->GetMediaActionButtonForTesting(
                         media_session::mojom::MediaSessionAction::kSeekForward)
                     ->GetVisible());
    SnapWidget(widget, dark ? "dark-media-live" : "light-media-live");
    MediaDialogView::HideDialog();
    base::RunLoop().RunUntilIdle();
    if (!dark) {
      EXPECT_TRUE(content::ExecJs(contents(), R"JS(
        window.fixtureLive = false;
        window.updateFixturePosition();
        navigator.mediaSession.metadata = new MediaMetadata({
          title: 'Merlin media fixture', artist: 'Browser UI verification',
          artwork: window.fixtureArtwork
        });
      )JS"));
    }
  }
}

IN_PROC_BROWSER_TEST_F(MerlinIdentityBrowserTest, MediaMultipleSessions) {
  ASSERT_TRUE(StartMedia("First media session"));
  ASSERT_TRUE(chrome::ExecuteCommand(browser(), IDC_NEW_TAB));
  ASSERT_TRUE(
      StartMedia("Second media session with a long title that must fit"));
  auto* view = BrowserView::GetBrowserViewForBrowser(browser());
  view->GetWidget()->SetBounds(gfx::Rect(0, 0, 640, 800));
  auto* service =
      MediaNotificationServiceFactory::GetForProfile(browser()->GetProfile());
  for (bool dark : {false, true}) {
    SetDark(dark);
    auto* widget = MediaDialogView::ShowDialogFromToolbar(
        views::BubbleAnchor(view->toolbar()), service, browser()->GetProfile());
    ASSERT_TRUE(widget);
    ASSERT_TRUE(base::test::RunUntil([] {
      return MediaDialogView::GetDialogViewForTesting()
                 ->GetItemsForTesting()
                 .size() == 2;
    }));
    SnapWidget(widget, dark ? "dark-media-multiple-narrow"
                            : "light-media-multiple-narrow");
    MediaDialogView::HideDialog();
    base::RunLoop().RunUntilIdle();
  }
}

IN_PROC_BROWSER_TEST_F(MerlinIdentityBrowserTest, MediaCastPermissionLayout) {
  ASSERT_TRUE(StartMedia("Cast permission fixture"));
  auto* view = BrowserView::GetBrowserViewForBrowser(browser());
  auto* service =
      MediaNotificationServiceFactory::GetForProfile(browser()->GetProfile());
  for (bool dark : {false, true}) {
    SetDark(dark);
    auto* widget = MediaDialogView::ShowDialogFromToolbar(
        views::BubbleAnchor(view->toolbar()), service, browser()->GetProfile());
    ASSERT_TRUE(widget);
    ASSERT_TRUE(base::test::RunUntil([] {
      return !MediaDialogView::GetDialogViewForTesting()
                  ->GetItemsForTesting()
                  .empty();
    }));
    auto* item = MediaDialogView::GetDialogViewForTesting()
                     ->GetItemsForTesting()
                     .begin()
                     ->second.get();
    // Exercise the actual browser warning view. The two pipe endpoints stay
    // local; no OS permission request, discovery or device connection is made.
    mojo::PendingRemote<global_media_controls::mojom::DeviceListHost> host;
    auto host_receiver = host.InitWithNewPipeAndPassReceiver();
    mojo::PendingRemote<global_media_controls::mojom::DeviceListClient> client;
    auto selector = std::make_unique<CastDeviceSelectorView>(
        std::move(host), client.InitWithNewPipeAndPassReceiver(),
        GetMediaColorTheme(), true);
    auto* selector_view = selector.get();
    item->UpdateDeviceSelectorView(std::move(selector));
    selector_view->OnPermissionRejected();
    widget->LayoutRootViewIfNecessary();
    auto* warning = selector_view->GetPermissionRejectedViewForTesting();
    ASSERT_TRUE(warning->IsDrawn());
    auto* label =
        views::AsViewClass<views::StyledLabel>(warning->children()[0]);
    ASSERT_TRUE(label);
    EXPECT_LE(label->width(), warning->width());
    EXPECT_GE(label->height(), label->GetHeightForWidth(label->width()));
    SnapWidget(widget, dark ? "dark-media-cast-permission"
                            : "light-media-cast-permission");
    MediaDialogView::HideDialog();
    base::RunLoop().RunUntilIdle();
  }
}

IN_PROC_BROWSER_TEST_F(MerlinIdentityBrowserTest, PrivatePages) {
  auto* private_browser = CreateIncognitoBrowser();
  ASSERT_TRUE(private_browser->GetProfile()->IsOffTheRecord());
  for (bool dark : {false, true}) {
    SetDark(dark);
    ASSERT_TRUE(ui_test_utils::NavigateToURL(private_browser,
                                             GURL("chrome://newtab/")));
    auto* private_contents =
        private_browser->GetTabStripModel()->GetActiveWebContents();
    ASSERT_TRUE(content::WaitForLoadStop(private_contents));
    EXPECT_EQ(true, content::EvalJs(
                        private_contents,
                        "/incognito|private/i.test(document.body.innerText)"));
    SnapPage(dark ? "dark-private-start" : "light-private-start",
             private_contents);
    auto* widget =
        BrowserView::GetBrowserViewForBrowser(private_browser)->GetWidget();
    widget->SetBounds(gfx::Rect(0, 0, 640, 800));
    base::RunLoop().RunUntilIdle();
    SnapPage(dark ? "dark-private-start-narrow" : "light-private-start-narrow",
             private_contents);
    widget->SetBounds(gfx::Rect(0, 0, 1280, 900));
  }
}

IN_PROC_BROWSER_TEST_F(MerlinIdentityBrowserTest,
                       PermissionDecisionsAndSiteInfo) {
  class Delegate : public TestPermissionBubbleViewDelegate {
   public:
    void Accept(const PromptOptions&) override { decision = 1; }
    void AcceptThisTime(const PromptOptions&) override { decision = 2; }
    void Deny(const PromptOptions&) override { decision = 3; }
    int decision = 0;
  };
  ASSERT_TRUE(ui_test_utils::NavigateToURL(
      browser(), embedded_test_server()->GetURL("/empty.html")));
  for (bool dark : {false, true}) {
    SetDark(dark);
    auto* controller = ModalBrowserController::From(browser());
    auto* button =
        controller->safety_controls_for_testing()->site_button_for_testing();
    views::test::ButtonTestApi(button).NotifyDefaultMouseClick();
    ASSERT_TRUE(base::test::RunUntil([&] {
      return PageInfoBubbleViewBase::GetPageInfoBubbleForTesting(contents()) !=
             nullptr;
    }));
    auto* site_info =
        PageInfoBubbleViewBase::GetPageInfoBubbleForTesting(contents());
    // Site information hangs from the site controls at the right end of the
    // toolbar, with an arrow pointing at them.
    EXPECT_TRUE(site_info->GetBubbleFrameView()->GetDisplayVisibleArrow());
    EXPECT_EQ(site_info->arrow(), views::BubbleBorder::TOP_RIGHT);
    SnapWidget(site_info->GetWidget(),
               dark ? "dark-site-info" : "light-site-info");
    site_info->GetWidget()->CloseNow();
    for (auto [button_id, expected] :
         {std::pair{
              PermissionPromptBubbleBaseView::PermissionDialogButton::kAccept,
              1},
          std::pair{PermissionPromptBubbleBaseView::PermissionDialogButton::
                        kAcceptOnce,
                    2},
          std::pair{
              PermissionPromptBubbleBaseView::PermissionDialogButton::kDeny,
              3}}) {
      Delegate delegate;
      std::vector<std::unique_ptr<permissions::PermissionRequest>> requests;
      requests.push_back(std::make_unique<permissions::MockPermissionRequest>(
          contents()->GetLastCommittedURL(),
          permissions::RequestType::kMicStream,
          permissions::PermissionRequestGestureType::GESTURE));
      delegate.set_requests(std::move(requests));
      auto prompt =
          CreatePermissionPromptBubbleView(contents(), delegate.GetWeakPtr(),
                                           PermissionPromptStyle::kBubbleOnly);
      ASSERT_TRUE(prompt);
      prompt->Show();
      // A popover: an arrow, and no close button (Esc dismisses).
      EXPECT_TRUE(prompt->GetBubbleFrameView()->GetDisplayVisibleArrow());
      EXPECT_FALSE(prompt->ShouldShowCloseButton());
      if (expected == 1) {
        SnapWidget(prompt->GetWidget(),
                   dark ? "dark-permission" : "light-permission");
      }
      prompt->RunButtonCallback(static_cast<int>(button_id));
      EXPECT_EQ(delegate.decision, expected);
      prompt->GetWidget()->CloseNow();
    }
  }
}

// The address card runs to the end of the toolbar, as Dia's does, instead of
// stopping at the width of the address.
IN_PROC_BROWSER_TEST_F(MerlinIdentityBrowserTest, AddressCardSpansToolbar) {
  ASSERT_TRUE(ui_test_utils::NavigateToURL(
      browser(), embedded_test_server()->GetURL("/empty.html")));
  auto* controller = ModalBrowserController::From(browser());
  ASSERT_TRUE(controller);
  MerlinAddressEditor* editor = controller->address_editor_for_testing();
  ASSERT_TRUE(editor);
  views::View* field = controller->address_field_for_testing();
  ASSERT_TRUE(field && field->parent());
  for (bool dark : {false, true}) {
    SetDark(dark);
    controller->FocusAddressBar();
    ASSERT_TRUE(editor->editing());
    editor->textfield_for_testing()->InsertOrReplaceText(u"merlin");
    views::Widget* card = editor->textfield_for_testing()->GetWidget();
    ASSERT_TRUE(card);
    const gfx::Rect row = field->parent()->GetBoundsInScreen();
    const gfx::Rect bounds = card->GetWindowBoundsInScreen();
    // The card's own edge sits inside its shadow margin.
    EXPECT_GE(bounds.right() - style::kShadowMargin, row.right() - 10);
    EXPECT_GT(bounds.width() - 2 * style::kShadowMargin, row.width() / 2);
    SnapWidget(card, dark ? "dark-address-card" : "light-address-card");
    editor->End();
  }
}

// Merlin's profile card: avatar beside the name on a card, rows below.
IN_PROC_BROWSER_TEST_F(MerlinIdentityBrowserTest, ProfileMenuPresentation) {
  auto* coordinator = ProfileMenuCoordinator::From(browser());
  ASSERT_TRUE(coordinator);
  for (bool dark : {false, true}) {
    SetDark(dark);
    coordinator->Show(/*is_source_accelerator=*/false);
    ASSERT_TRUE(base::test::RunUntil([&] { return coordinator->IsShowing(); }));
    ProfileMenuViewBase* menu = coordinator->GetProfileMenuViewBaseForTesting();
    ASSERT_TRUE(menu);
    SnapWidget(menu->GetWidget(),
               dark ? "dark-profile-menu" : "light-profile-menu");
    menu->GetWidget()->CloseNow();
    ASSERT_TRUE(
        base::test::RunUntil([&] { return !coordinator->IsShowing(); }));
  }
}

IN_PROC_BROWSER_TEST_F(MerlinIdentityBrowserTest,
                       CertificateWarningBackToSafety) {
  net::EmbeddedTestServer https(net::EmbeddedTestServer::TYPE_HTTPS);
  https.SetSSLConfig(net::EmbeddedTestServer::CERT_EXPIRED);
  ASSERT_TRUE(https.Start());
  for (bool dark : {false, true}) {
    SetDark(dark);
    ASSERT_TRUE(ui_test_utils::NavigateToURL(
        browser(), embedded_test_server()->GetURL("/empty.html")));
    (void)ui_test_utils::NavigateToURL(browser(), https.GetURL("/empty.html"));
    // A failed TLS navigation is expected; the interstitial is the result.
    (void)content::WaitForLoadStop(contents());
    EXPECT_EQ(true,
              content::EvalJs(contents(),
                              "!!document.querySelector('#primary-button') && "
                              "document.querySelector('#error-code')?."
                              "textContent.includes('ERR_CERT_DATE_INVALID')"));
    SnapPage(dark ? "dark-certificate-warning" : "light-certificate-warning");
    content::TestNavigationObserver back(contents());
    content::ExecuteScriptAsync(
        contents(), "document.querySelector('#primary-button').click()");
    back.Wait();
    EXPECT_EQ(contents()->GetLastCommittedURL(),
              embedded_test_server()->GetURL("/empty.html"));
  }
}

IN_PROC_BROWSER_TEST_F(MerlinIdentityBrowserTest, NetworkErrorPresentation) {
  for (bool dark : {false, true}) {
    SetDark(dark);
    // Local, deterministic browser-generated error; no outside site is used.
    (void)ui_test_utils::NavigateToURL(browser(), GURL("http://127.0.0.1:1/"));
    (void)content::WaitForLoadStop(contents());
    ASSERT_TRUE(base::test::RunUntil([&] {
      return content::EvalJs(contents(),
                             "document.body.classList.contains('neterror') && "
                             "!!document.querySelector('#merlin-style')")
          .ExtractBool();
    }));
    EXPECT_EQ(dark ? "#161512" : "#FDFCF8",
              content::EvalJs(contents(),
                              "getComputedStyle(document.documentElement)."
                              "getPropertyValue('--bg').trim()"));
    SnapPage(dark ? "dark-network-error" : "light-network-error");
  }
}

IN_PROC_BROWSER_TEST_F(MerlinIdentityBrowserTest, PrintPreviewPresentation) {
  ASSERT_TRUE(ui_test_utils::NavigateToURL(
      browser(), embedded_test_server()->GetURL("/empty.html")));
  content::PluginService::GetInstance()->Init();
  printing::TestPrintPreviewObserver observer(/*wait_for_loaded=*/true);
  ASSERT_TRUE(printing::StartPrint(contents(), /*print_preview_disabled=*/false,
                                   /*has_selection=*/false));
  auto* preview = observer.WaitUntilPreviewIsReadyAndReturnPreviewDialog();
  ASSERT_TRUE(preview);
  for (bool dark : {false, true}) {
    SetDark(dark);
    ASSERT_TRUE(base::test::RunUntil([&] {
      return content::EvalJs(preview,
                             "getComputedStyle(document.documentElement)."
                             "getPropertyValue('--bg').trim()")
                 .ExtractString() == (dark ? "#161512" : "#FDFCF8");
    }));
    EXPECT_EQ("rgb(246, 212, 74)", content::EvalJs(preview, R"JS((() => {
      const find = root => {
        for (const node of root.querySelectorAll('*')) {
          if (node.matches('cr-button.action-button')) return node;
          if (node.shadowRoot) { const result = find(node.shadowRoot); if (result) return result; }
        }
      };
      return getComputedStyle(find(document)).backgroundColor;
    })())JS"));
    SnapPage(dark ? "dark-print-preview" : "light-print-preview", preview);
  }
}

IN_PROC_BROWSER_TEST_F(MerlinIdentityBrowserTest, DevToolsPresentation) {
  ASSERT_TRUE(ui_test_utils::NavigateToURL(
      browser(), embedded_test_server()->GetURL("/empty.html")));
  for (bool dark : {false, true}) {
    SetDark(dark);
    auto* window =
        DevToolsWindowTesting::OpenDevToolsWindowSync(contents(), false);
    ASSERT_TRUE(window);
    auto* frontend = DevToolsWindowTesting::Get(window)->main_web_contents();
    ASSERT_TRUE(frontend);
    EXPECT_EQ(true, content::EvalJs(frontend, R"JS((async () => {
      const Common = await import('./core/common/common.js');
      const SettingsUI = await import('./ui/settings/settings.js');
      Common.Settings.Settings.instance().resolve(SettingsUI.MainSettings.uiThemeSettingDescriptor)
          .set(matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'default');
      const Settings = await import('./panels/settings/settings.js');
      await Settings.SettingsScreen.SettingsScreen.showSettingsScreen({name: 'preferences'});
      return true;
    })())JS"));
    ASSERT_TRUE(base::test::RunUntil([&] {
      return content::EvalJs(frontend,
                             "document.documentElement.classList.contains('"
                             "merlin-default-theme')")
          .ExtractBool();
    }));
    EXPECT_EQ(
        dark ? "#1E1D19" : "#FDFCF8",
        content::EvalJs(frontend,
                        "getComputedStyle(document.documentElement)."
                        "getPropertyValue('--sys-color-surface').trim()"));
    EXPECT_EQ(dark ? "#F6D44A" : "#7A6000",
              content::EvalJs(
                  frontend,
                  "getComputedStyle(document.documentElement)."
                  "getPropertyValue('--sys-color-primary-bright').trim()"));
    EXPECT_EQ(dark ? "#4A3F12" : "#F7E7A8",
              content::EvalJs(frontend,
                              "getComputedStyle(document.documentElement)."
                              "getPropertyValue('--app-color-navigation-drawer-"
                              "background-selected').trim()"));
    EXPECT_EQ(dark ? "#F7E7A8" : "#2E2400",
              content::EvalJs(frontend,
                              "getComputedStyle(document.documentElement)."
                              "getPropertyValue('--app-color-navigation-drawer-"
                              "label-selected').trim()"));
    ASSERT_TRUE(base::test::RunUntil([&] {
      return content::EvalJs(frontend, R"JS((() => {
        const text = root => root.textContent +
            [...root.querySelectorAll('*')].map(node => node.shadowRoot ? text(node.shadowRoot) : '').join(' ');
        return text(document.body).includes('Match Merlin color scheme');
      })())JS")
          .ExtractBool();
    }));
    EXPECT_EQ(true, content::EvalJs(frontend, R"JS(
        new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve(true)))))JS"));
    SnapPage(dark ? "dark-devtools" : "light-devtools", frontend);
    DevToolsWindowTesting::CloseDevToolsWindowSync(window);
  }
}

IN_PROC_BROWSER_TEST_F(MerlinIdentityBrowserTest, PaymentPromptDecisions) {
  using Payments = autofill::payments::PaymentsAutofillClient;
  using Decision = Payments::SaveCardOfferUserDecision;
  ASSERT_TRUE(ui_test_utils::NavigateToURL(
      browser(), embedded_test_server()->GetURL("/empty.html")));
  auto ignore_activation = autofill::SaveCardBubbleControllerImpl::
      IgnoreWindowActivationForTesting();
  auto* controller = static_cast<autofill::SaveCardBubbleControllerImpl*>(
      autofill::SaveCardBubbleController::GetOrCreate(contents()));
  autofill::CreditCard card;
  card.SetRawInfo(autofill::CREDIT_CARD_NUMBER, u"4111111111111111");
  card.SetRawInfo(autofill::CREDIT_CARD_NAME_FULL, u"Synthetic Fixture");
  card.SetRawInfo(autofill::CREDIT_CARD_EXP_MONTH, u"12");
  card.SetRawInfo(autofill::CREDIT_CARD_EXP_4_DIGIT_YEAR, u"2040");
  for (bool dark : {false, true}) {
    SetDark(dark);
    for (bool accept : {false, true}) {
      base::test::TestFuture<Decision> decision;
      controller->OfferLocalSave(
          card, Payments::SaveCreditCardOptions().with_show_prompt(),
          decision.GetCallback());
      auto* bubble = static_cast<autofill::SaveCardOfferBubbleViews*>(
          controller->GetPaymentBubbleView());
      ASSERT_TRUE(bubble);
      if (!accept) {
        SnapWidget(bubble->GetWidget(),
                   dark ? "dark-card-save" : "light-card-save");
      }
      auto* button = accept ? bubble->GetOkButton() : bubble->GetCancelButton();
      ASSERT_TRUE(button);
      button->RequestFocus();
      EXPECT_EQ(button, bubble->GetFocusManager()->GetFocusedView());
      views::test::ButtonTestApi(button).NotifyClick(ui::MouseEvent(
          ui::EventType::kMouseReleased, gfx::Point(), gfx::Point(),
          base::TimeTicks::Now() + views::GetDoubleClickInterval(),
          ui::EF_LEFT_MOUSE_BUTTON, ui::EF_LEFT_MOUSE_BUTTON));
      ASSERT_TRUE(decision.Wait());
      EXPECT_EQ(accept ? Decision::kAccepted : Decision::kDeclined,
                decision.Get());
      base::RunLoop().RunUntilIdle();
    }
  }
}

IN_PROC_BROWSER_TEST_F(MerlinIdentityBrowserTest, PasskeyPromptDecisions) {
  class Decisions : public AuthenticatorRequestDialogModel::Observer {
   public:
    void OnChromeProfileCreatePasskeyAccepted() override { ++accepted; }
    int accepted = 0;
  };
  ASSERT_TRUE(ui_test_utils::NavigateToURL(
      browser(), embedded_test_server()->GetURL("/empty.html")));
  for (bool dark : {false, true}) {
    SetDark(dark);
    auto model = base::MakeRefCounted<AuthenticatorRequestDialogModel>(
        contents()->GetPrimaryMainFrame());
    model->relying_party_id = "example.test";
    model->request_type = device::FidoRequestType::kMakeCredential;
    model->user_entity.name = "synthetic@example.test";
    model->SetStep(
        AuthenticatorRequestDialogModel::Step::kChromeProfileCreatePasskey);
    Decisions decisions;
    model->AddObserver(&decisions);
    auto controller =
        std::make_unique<AuthenticatorRequestDialogViewControllerViews>(
            contents(), model.get());
    controller->OnStepTransition();
    base::RunLoop().RunUntilIdle();
    auto* view = controller->view_for_test();
    ASSERT_TRUE(view);
    EXPECT_NE(std::u16string::npos,
              view->GetWidget()->widget_delegate()->GetWindowTitle().find(
                  u"example.test"));
    SnapWidget(view->GetWidget(),
               dark ? "dark-passkey-create" : "light-passkey-create");
    auto* button = view->GetOkButton();
    ASSERT_TRUE(button);
    button->RequestFocus();
    EXPECT_EQ(button, view->GetFocusManager()->GetFocusedView());
    views::test::ButtonTestApi(button).NotifyClick(ui::MouseEvent(
        ui::EventType::kMouseReleased, gfx::Point(), gfx::Point(),
        base::TimeTicks::Now() + views::GetDoubleClickInterval(),
        ui::EF_LEFT_MOUSE_BUTTON, ui::EF_LEFT_MOUSE_BUTTON));
    EXPECT_EQ(1, decisions.accepted);
    model->RemoveObserver(&decisions);
  }
}

}  // namespace modal_browser
