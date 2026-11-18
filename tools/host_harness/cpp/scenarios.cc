// End-to-end scenarios: key events -> C++ ModalInputRouter -> cxx bridge ->
// Rust session -> actions -> BrowserOps (FakeBrowser).

#include "cpp/scenarios.h"

#include <cstdio>
#include <string>

#include "cpp/fake_browser.h"

namespace modal_browser::harness {

namespace {

int g_failures = 0;
const char* g_scenario = "";

#define CHECK_TRUE(cond)                                                     \
  do {                                                                       \
    if (!(cond)) {                                                           \
      std::fprintf(stderr, "[%s] %s:%d: CHECK failed: %s\n", g_scenario,     \
                   __FILE__, __LINE__, #cond);                               \
      g_failures++;                                                          \
    }                                                                        \
  } while (0)

#define CHECK_EQ_STR(actual, expected)                                       \
  do {                                                                       \
    const std::string a_ = (actual);                                         \
    const std::string e_ = (expected);                                       \
    if (a_ != e_) {                                                          \
      std::fprintf(stderr, "[%s] %s:%d: %s == \"%s\", expected \"%s\"\n",    \
                   g_scenario, __FILE__, __LINE__, #actual, a_.c_str(),      \
                   e_.c_str());                                              \
      g_failures++;                                                          \
    }                                                                        \
  } while (0)

#define CHECK_EQ_INT(actual, expected)                                       \
  do {                                                                       \
    const long long a_ = (actual);                                           \
    const long long e_ = (expected);                                         \
    if (a_ != e_) {                                                          \
      std::fprintf(stderr, "[%s] %s:%d: %s == %lld, expected %lld\n",        \
                   g_scenario, __FILE__, __LINE__, #actual, a_, e_);         \
      g_failures++;                                                          \
    }                                                                        \
  } while (0)

// A window: the router plus the fake browser it drives, and the focus
// state the host would read from Chromium.
struct Window {
  ModalInputRouter router;
  FakeBrowser browser;
  PageFocus focus = PageFocus::kPage;

  // Presses one key; returns whether the page would have received it.
  bool Press(std::string_view dom_key,
             bool shift = false,
             bool ctrl = false,
             bool meta = false) {
    KeyDown key;
    key.dom_key = dom_key;
    key.shift = shift;
    key.ctrl = ctrl;
    key.meta = meta;
    return !router.OnKeyDown(key, focus, browser);
  }

  // Presses each character of `keys` as an unmodified key. Returns how many
  // reached the page.
  int Type(std::string_view keys) {
    int forwarded = 0;
    for (char c : keys) {
      forwarded += Press(std::string_view(&c, 1)) ? 1 : 0;
    }
    return forwarded;
  }

  void Focus(PageFocus f) {
    focus = f;
    router.OnFocusChanged(f, browser);
  }

  // Types into the palette's field and presses Enter, as the real text
  // field does.
  void Submit(std::string_view text) {
    router.OnPaletteTextChanged(text, browser);
    router.OnPaletteKey(ffi::PaletteKey::Accept, browser);
  }

  void PaletteKey(ffi::PaletteKey key) { router.OnPaletteKey(key, browser); }

  // Presses a hint key and answers the collection request with the fake
  // page's targets.
  void ShowHints(std::string_view key) {
    Press(key, key.size() == 1 && key[0] >= 'A' && key[0] <= 'Z');
    std::vector<ffi::HintKind> kinds = browser.page_targets;
    router.OnHintsCollected(browser.collect_generation, kinds, browser);
  }

  // Runs a command line as the `:` line does.
  std::string Run(std::string_view line) {
    return router.OnCommandLineSubmitted(line, browser);
  }

  // Answers a pending SnapshotWorkspace with the fake window's tabs, as
  // the real host does.
  void AnswerSnapshot(int64_t now = 1000) {
    ::rust::Vec<ffi::WindowTab> tabs;
    for (size_t i = 0; i < browser.tabs.size(); ++i) {
      const FakeBrowser::Tab& t = browser.tabs[i];
      tabs.push_back(ffi::WindowTab{
          ::rust::String(t.url()), ::rust::String(t.title), t.pinned,
          static_cast<int>(i) == browser.active_index,
          t.split == 0 ? -1 : t.split, t.layout, /*split_ratio=*/0,
          /*group=*/-1, ::rust::String(), ::rust::String(),
          /*group_collapsed=*/false});
    }
    router.OnWorkspaceSnapshot(browser.snapshot_request, browser.snapshot_quiet,
                               std::move(tabs), ffi::WindowState{0, 0, 0, 0, false},
                               now, browser);
  }
};

ffi::PageBlock MakeBlock(ffi::BlockKind kind,
                         uint32_t level,
                         std::string text,
                         uint32_t element) {
  return ffi::PageBlock{kind, level, false, false, ::rust::String(""),
                        ::rust::String(text), element,
                        ::rust::Vec<ffi::PageSpan>()};
}

void TabnewThroughCommandLine() {
  g_scenario = "tabnew through command line";
  Window w;
  CHECK_TRUE(!w.Press(":", /*shift=*/true));
  CHECK_TRUE(w.browser.palette_visible);
  CHECK_EQ_STR(w.browser.indicator, "COMMAND");
  CHECK_TRUE(w.router.mode() == ffi::Mode::Command);

  w.Submit("tabnew https://docs.rs");
  CHECK_TRUE(!w.browser.palette_visible);
  CHECK_EQ_INT(w.browser.tabs.size(), 2);
  CHECK_EQ_INT(w.browser.active_index, 1);
  CHECK_EQ_STR(w.browser.active().url(), "https://docs.rs");
  CHECK_EQ_STR(w.browser.indicator, "NORMAL");
}

void OpenPrefillAndSearch() {
  g_scenario = "o prefills open, search terms";
  Window w;
  w.Press("o");
  CHECK_TRUE(w.browser.palette_visible);
  CHECK_EQ_STR(w.browser.palette_text, "open ");
  w.Submit("open rust lifetimes");
  CHECK_EQ_INT(w.browser.tabs.size(), 1);
  CHECK_EQ_STR(w.browser.active().url(), "search:rust lifetimes");
  w.Press("H", /*shift=*/true);
  CHECK_EQ_STR(w.browser.active().url(), "https://example.com/");
  w.Press("L", /*shift=*/true);
  CHECK_EQ_STR(w.browser.active().url(), "search:rust lifetimes");
}

void BareHostGetsHttps() {
  g_scenario = "bare host";
  Window w;
  w.Press(":", true);
  w.Submit("open docs.rs");
  CHECK_EQ_STR(w.browser.active().url(), "https://docs.rs");
}

void CommandErrorsKeepLineOpen() {
  g_scenario = "command errors";
  Window w;
  w.Press(":", true);
  w.Submit("tabnw docs.rs");
  CHECK_TRUE(w.browser.palette_visible);
  CHECK_EQ_STR(w.browser.palette_error,
               "unknown command 'tabnw' (did you mean 'tabnew'?)");
  CHECK_EQ_INT(w.browser.tabs.size(), 1);

  w.Submit("open javascript:alert(1)");
  CHECK_TRUE(w.browser.palette_visible);
  CHECK_EQ_STR(w.browser.palette_error,
               "':open': 'javascript:' URLs cannot be opened from commands");
  CHECK_EQ_STR(w.browser.active().url(), "https://example.com/");

  w.PaletteKey(ffi::PaletteKey::Cancel);
  CHECK_TRUE(!w.browser.palette_visible);
  CHECK_EQ_STR(w.browser.indicator, "NORMAL");
}

void TypingInTextFieldsIsNeverHijacked() {
  g_scenario = "text fields";
  Window w;
  w.Focus(PageFocus::kPlainTextField);
  CHECK_EQ_STR(w.browser.indicator, "INSERT");
  CHECK_EQ_INT(w.Type("jjkdgG:/ftu"), 11);
  CHECK_EQ_INT(w.browser.tabs.size(), 1);
  CHECK_EQ_INT(w.browser.active().scroll_y, 0);
  CHECK_TRUE(!w.browser.palette_visible);

  // A late focus notification: the key itself says the field is focused.
  Window late;
  late.focus = PageFocus::kRichTextField;
  CHECK_TRUE(late.Press("d"));
  CHECK_EQ_INT(late.browser.tabs.size(), 1);
  CHECK_EQ_STR(late.browser.indicator, "INSERT");
}

void EscapeLeavesTextField() {
  g_scenario = "escape from text field";
  Window w;
  w.Focus(PageFocus::kPlainTextField);
  CHECK_TRUE(!w.Press("Escape"));
  CHECK_EQ_INT(w.browser.blur_count, 1);
  CHECK_EQ_STR(w.browser.indicator, "NORMAL");
  // The host blurred the field; focus is back on the page.
  w.focus = PageFocus::kPage;
  CHECK_TRUE(!w.Press("j"));
  CHECK_EQ_INT(w.browser.active().scroll_y, 60);
}

void EscapeInNormalReachesPage() {
  g_scenario = "escape in normal";
  Window w;
  CHECK_TRUE(w.Press("Escape"));
  CHECK_EQ_STR(w.browser.indicator, "NORMAL");
}

void SequencesTimersAndCounts() {
  g_scenario = "sequences";
  Window w;
  w.Press("G", true);
  CHECK_EQ_INT(w.browser.active().scroll_y, 9200);
  CHECK_TRUE(!w.Press("g"));
  CHECK_EQ_STR(w.browser.pending, "g");
  CHECK_EQ_INT(w.browser.timer_ms, 1000);
  CHECK_TRUE(!w.Press("g"));
  CHECK_EQ_INT(w.browser.active().scroll_y, 0);
  CHECK_EQ_STR(w.browser.pending, "");
  CHECK_EQ_INT(w.browser.timer_ms, 0);

  w.Type("5j");
  CHECK_EQ_INT(w.browser.active().scroll_y, 300);

  // Prefix timeout clears without acting.
  w.Press("g");
  w.router.OnSequenceTimeout(w.browser);
  CHECK_EQ_STR(w.browser.pending, "");
  CHECK_EQ_INT(w.browser.timer_ms, 0);
  CHECK_EQ_INT(w.browser.active().scroll_y, 300);

  // Ctrl chords.
  w.Press("d", false, /*ctrl=*/true);
  CHECK_EQ_INT(w.browser.active().scroll_y, 700);
}

void TabKeys() {
  g_scenario = "tabs";
  Window w;
  w.Press(":", true);
  w.Submit("tabnew a.example");
  w.Press(":", true);
  w.Submit("tabnew b.example");
  CHECK_EQ_INT(w.browser.tabs.size(), 3);
  CHECK_EQ_INT(w.browser.active_index, 2);
  w.Press("J", true);
  CHECK_EQ_INT(w.browser.active_index, 0);
  w.Type("2");
  w.Press("J", true);
  CHECK_EQ_INT(w.browser.active_index, 2);
  w.Press("K", true);
  CHECK_EQ_INT(w.browser.active_index, 1);
  w.Type("d");
  CHECK_EQ_INT(w.browser.tabs.size(), 2);
  w.Type("u");
  CHECK_EQ_INT(w.browser.tabs.size(), 3);
  CHECK_EQ_STR(w.browser.active().url(), "https://a.example");
  w.Type("t");
  CHECK_EQ_INT(w.browser.tabs.size(), 4);
  CHECK_TRUE(w.browser.address_bar_focused);
}

void BrowserShortcutsAndModifierKeysPassThrough() {
  g_scenario = "browser shortcuts";
  Window w;
  CHECK_TRUE(w.Press("t", false, false, /*meta=*/true));  // Cmd+T
  CHECK_TRUE(w.Press("l", false, false, /*meta=*/true));  // Cmd+L
  CHECK_TRUE(w.Press("Shift", true));
  CHECK_TRUE(w.Press("Meta", false, false, true));
  CHECK_TRUE(w.Press("Dead"));
  CHECK_TRUE(w.Press("Process"));
  CHECK_EQ_INT(w.browser.tabs.size(), 1);
  // Cmd+T in the middle of a sequence still reaches the browser.
  w.Press("g");
  CHECK_TRUE(w.Press("t", false, false, true));
  CHECK_EQ_STR(w.browser.pending, "");
}

void BrowserUiFocusAndImeAreUntouched() {
  g_scenario = "browser ui and ime";
  Window w;
  w.focus = PageFocus::kBrowserUi;
  CHECK_EQ_INT(w.Type("jjd:"), 4);
  CHECK_EQ_INT(w.browser.tabs.size(), 1);

  Window ime;
  KeyDown key;
  key.dom_key = "j";
  key.ime_composing = true;
  CHECK_TRUE(!ime.router.OnKeyDown(key, PageFocus::kPage, ime.browser));
  CHECK_EQ_INT(ime.browser.active().scroll_y, 0);
}

void Passthrough() {
  g_scenario = "passthrough";
  Window w;
  CHECK_TRUE(!w.Press("v", false, /*ctrl=*/true));
  CHECK_EQ_STR(w.browser.indicator, "PASSTHROUGH");
  CHECK_TRUE(w.Press("Escape"));
  CHECK_EQ_INT(w.Type("jd:"), 3);
  CHECK_EQ_INT(w.browser.tabs.size(), 1);
  CHECK_TRUE(!w.Press("Escape", /*shift=*/true));
  CHECK_EQ_STR(w.browser.indicator, "NORMAL");
  CHECK_TRUE(!w.Press("j"));
}

void Hints() {
  g_scenario = "hints";
  Window w;
  w.browser.page_targets = {ffi::HintKind::Link, ffi::HintKind::Editable,
                            ffi::HintKind::Other, ffi::HintKind::Link};
  w.browser.page_target_urls = {"https://a.example/", "", "",
                                "https://b.example/"};
  w.Press("f");
  CHECK_EQ_STR(w.browser.indicator, "HINT");
  CHECK_EQ_INT(w.browser.collect_requests, 1);
  CHECK_TRUE(!w.browser.hints_visible);  // until the page answers
  w.router.OnHintsCollected(w.browser.collect_generation,
                            w.browser.page_targets, w.browser);
  CHECK_TRUE(w.browser.hints_visible);
  CHECK_EQ_INT(w.browser.shown_hints.size(), 4);
  // Four targets: labels s, a, d, f in page order.
  CHECK_EQ_STR(w.browser.shown_hints[3].label, "f");
  w.Type("f");
  CHECK_TRUE(!w.browser.hints_visible);
  CHECK_EQ_INT(w.browser.activated_target, 3);
  CHECK_EQ_STR(w.browser.active().url(), "https://b.example/");
  CHECK_EQ_STR(w.browser.indicator, "NORMAL");

  // F: links only, opened in a background tab.
  w.ShowHints("F");
  CHECK_EQ_INT(w.browser.shown_hints.size(), 2);
  CHECK_EQ_INT(w.browser.shown_hints[0].target, 0);
  w.Type(w.browser.shown_hints[0].label);
  CHECK_EQ_INT(w.browser.tabs.size(), 2);
  CHECK_EQ_INT(w.browser.active_index, 0);

  // yf copies the link.
  w.Press("y");
  w.ShowHints("f");
  w.Type(w.browser.shown_hints[1].label);
  CHECK_EQ_STR(w.browser.clipboard, "https://b.example/");

  // gi with one field focuses it at once; the page reports the focus.
  w.Press("g");
  w.ShowHints("i");
  CHECK_EQ_INT(w.browser.activated_target, 1);
  CHECK_TRUE(w.browser.activated_action == ffi::HintAction::FocusInput);
  w.Focus(PageFocus::kPlainTextField);
  CHECK_EQ_STR(w.browser.indicator, "INSERT");
}

void HintsCancelAndStale() {
  g_scenario = "hints cancel and stale answers";
  Window w;
  w.browser.page_targets = std::vector<ffi::HintKind>(30, ffi::HintKind::Link);
  w.Press("f");
  const uint32_t first = w.browser.collect_generation;
  w.Press("Escape");
  CHECK_EQ_STR(w.browser.indicator, "NORMAL");
  // The page answers after Esc: ignored.
  w.router.OnHintsCollected(first, w.browser.page_targets, w.browser);
  CHECK_TRUE(!w.browser.hints_visible);

  w.ShowHints("f");
  CHECK_EQ_INT(w.browser.shown_hints.size(), 30);
  w.Type("s");
  CHECK_EQ_STR(w.browser.hint_filter, "s");
  w.Press("Backspace");
  CHECK_EQ_STR(w.browser.hint_filter, "");
  // Navigation away hides hints.
  w.router.OnPageChanged("other.example", w.browser);
  CHECK_TRUE(!w.browser.hints_visible);
  CHECK_EQ_STR(w.browser.indicator, "NORMAL");
}

void ReloadFindAddressHelp() {
  g_scenario = "reload, find, address bar, help";
  Window w;
  w.Type("r");
  CHECK_EQ_INT(w.browser.reload_count, 1);
  CHECK_TRUE(!w.browser.last_reload_bypassed_cache);
  w.Press("R", true);
  CHECK_TRUE(w.browser.last_reload_bypassed_cache);
  w.Type("/");
  CHECK_TRUE(w.browser.find_bar_open);
  w.Press("l", false, /*ctrl=*/true);
  CHECK_TRUE(w.browser.address_bar_focused);
  w.Press(":", true);
  w.Submit("help tabnew");
  CHECK_TRUE(w.browser.message.rfind(":tabnew", 0) == 0);
  w.Press(":", true);
  w.Submit("script x");
  CHECK_TRUE(w.browser.palette_visible);
  CHECK_EQ_STR(w.browser.palette_error, "unknown command 'script' (try ':help')");
}

void CompletionAndBinding() {
  g_scenario = "completion and binding";
  Window w;
  auto candidates = w.router.Complete("tabn");
  CHECK_TRUE(!candidates.empty());
  CHECK_EQ_STR(candidates[0].first, "tabnew");

  CHECK_EQ_STR(w.router.Bind(ffi::Mode::Normal, "x", "tabnew docs.rs"), "");
  w.Type("x");
  CHECK_EQ_INT(w.browser.tabs.size(), 2);
  CHECK_EQ_STR(w.browser.active().url(), "https://docs.rs");

  CHECK_EQ_STR(w.router.Bind(ffi::Mode::Insert, "jj", "mode normal"),
               "insert mode does not accept key bindings");
}

void TabSwitcher() {
  g_scenario = "tab switcher";
  Window w;
  w.browser.AddTab("https://docs.rs/", "Docs.rs");
  w.browser.AddTab("https://developer.mozilla.org/", "MDN Web Docs");
  w.router.OnTabActivated(w.browser.tabs[2].id);
  w.router.OnTabActivated(w.browser.tabs[0].id);
  w.Press("b");
  CHECK_TRUE(w.browser.palette_visible);
  CHECK_TRUE(w.browser.palette_kind == ffi::PaletteKind::Tabs);
  CHECK_EQ_INT(w.browser.palette_rows.size(), 3);
  // Most recent first, current tab last.
  CHECK_EQ_STR(w.browser.palette_rows[0], "MDN Web Docs");
  CHECK_EQ_STR(w.browser.palette_rows[2], "Example");
  w.router.OnPaletteTextChanged("docs.rs", w.browser);
  CHECK_EQ_STR(w.browser.palette_rows[0], "Docs.rs");
  w.PaletteKey(ffi::PaletteKey::Accept);
  CHECK_TRUE(!w.browser.palette_visible);
  CHECK_EQ_INT(w.browser.active_index, 1);
  CHECK_EQ_STR(w.browser.indicator, "NORMAL");

  // :b with a number and with a query.
  w.Press(":", true);
  w.Submit("b 3");
  CHECK_EQ_INT(w.browser.active_index, 2);
  w.Press(":", true);
  w.Submit("b example");
  CHECK_EQ_INT(w.browser.active_index, 0);
  // g0 / g$.
  w.Type("g$");
  CHECK_EQ_INT(w.browser.active_index, 2);
  w.Type("g0");
  CHECK_EQ_INT(w.browser.active_index, 0);
}

void CommandPaletteAndCompletion() {
  g_scenario = "command palette and completion";
  Window w;
  w.Press("?", true);
  CHECK_TRUE(w.browser.palette_kind == ffi::PaletteKind::Commands);
  w.router.OnPaletteTextChanged("new tab", w.browser);
  CHECK_EQ_STR(w.browser.palette_rows[0], "New tab");
  w.PaletteKey(ffi::PaletteKey::Accept);
  CHECK_EQ_INT(w.browser.tabs.size(), 2);

  // ':' completion: Tab writes the completion into the field.
  w.Press(":", true);
  w.router.OnPaletteTextChanged("tabn", w.browser);
  CHECK_EQ_STR(w.browser.palette_rows[0], "tabnew");
  w.PaletteKey(ffi::PaletteKey::Next);
  CHECK_EQ_STR(w.browser.palette_text, "tabnew");
  CHECK_EQ_INT(w.browser.palette_selected, 0);
  w.PaletteKey(ffi::PaletteKey::Cancel);

  // History with Up.
  w.Press(":", true);
  w.Submit("open docs.rs");
  w.Press(":", true);
  w.PaletteKey(ffi::PaletteKey::Up);
  CHECK_EQ_STR(w.browser.palette_text, "open docs.rs");
}

void ClipboardYankAndPaste() {
  g_scenario = "yank and paste";
  Window w;
  w.Type("yy");
  CHECK_EQ_STR(w.browser.clipboard, "https://example.com/");
  w.Type("ym");
  CHECK_EQ_STR(w.browser.clipboard, "[Example](https://example.com/)");
  w.Press("P", true);
  CHECK_EQ_INT(w.browser.clipboard_reads, 1);
  CHECK_TRUE(w.browser.clipboard_disposition ==
             ffi::OpenDisposition::NewForegroundTab);
  w.router.OnClipboardText("docs.rs", w.browser.clipboard_disposition,
                           w.browser);
  CHECK_EQ_INT(w.browser.tabs.size(), 2);
  CHECK_EQ_STR(w.browser.active().url(), "https://docs.rs");
  w.Type("p");
  w.router.OnClipboardText("javascript:alert(1)",
                           w.browser.clipboard_disposition, w.browser);
  CHECK_EQ_INT(w.browser.active().history.size(), 1);
  CHECK_TRUE(w.browser.message.rfind("error: Clipboard:", 0) == 0);
}

void UrlMotions() {
  g_scenario = "gu and gU";
  Window w;
  w.browser.OpenUrl("https://example.com/a/b/c", ffi::OpenDisposition::CurrentTab);
  w.Type("gu");
  CHECK_EQ_STR(w.browser.active().url(), "https://example.com/a/b/");
  w.Type("gU");
  CHECK_EQ_STR(w.browser.active().url(), "https://example.com/");
  w.Type("n");
  w.Press("N", true);
  w.Type("n");
  CHECK_EQ_INT(w.browser.find_steps, 1);
}

void WhichKeyInStatus() {
  g_scenario = "which-key";
  Window w;
  w.Press("g");
  CHECK_TRUE(w.browser.which_key.size() >= 6);
  bool has_top = false;
  for (const KeyHintView& h : w.browser.which_key) {
    has_top |= h.keys == "g" && h.desc == "Top of page";
  }
  CHECK_TRUE(has_top);
  w.Press("Escape");
  CHECK_EQ_INT(w.browser.which_key.size(), 0);
}

void ConfigLoadAndReload() {
  g_scenario = "config";
  Window w;
  w.router.OnConfigRead(true,
                        "[options]\nscroll_step = 100\nsmooth_scroll = false\n"
                        "passthrough_sites = [\"mail.google.com\"]\n"
                        "[keys.normal]\nx = \"tabclose\"\n",
                        "~/.config/modal_browser/config.toml",
                        /*announce=*/false, w.browser);
  CHECK_EQ_STR(w.browser.message, "");
  w.Type("j");
  CHECK_EQ_INT(w.browser.active().scroll_y, 100);
  CHECK_TRUE(!w.browser.last_scroll_smooth);
  w.browser.AddTab("https://docs.rs/", "Docs");
  w.Type("x");
  CHECK_EQ_INT(w.browser.tabs.size(), 1);

  // Site passthrough.
  w.router.OnPageChanged("mail.google.com", w.browser);
  CHECK_EQ_STR(w.browser.indicator, "PASSTHROUGH");
  CHECK_TRUE(w.Press("j"));
  w.router.OnPageChanged("docs.rs", w.browser);
  CHECK_EQ_STR(w.browser.indicator, "NORMAL");

  // :config-reload asks the host to read the file again.
  w.Press(":", true);
  w.Submit("config-reload");
  CHECK_EQ_INT(w.browser.config_reads, 1);
  w.router.OnConfigRead(true, "[options]\nscroll_step = 5\n", "cfg.toml",
                        /*announce=*/true, w.browser);
  CHECK_TRUE(w.browser.message.rfind("error: Config cfg.toml: line 2:", 0) ==
             0);
  w.router.OnConfigRead(false, "", "cfg.toml", /*announce=*/true, w.browser);
  CHECK_EQ_STR(w.browser.message, "No config at cfg.toml; using defaults");
  w.Type("j");
  CHECK_EQ_INT(w.browser.last_scroll_step, 60);
}

void BrowserShell() {
  g_scenario = "vertical tabs and sidebar";
  Window w;
  // The config default applies until the user picks a layout.
  w.router.OnConfigRead(false, "", "cfg.toml", false, w.browser);
  CHECK_TRUE(w.browser.vertical_tabs());
  w.Type("gs");
  CHECK_TRUE(w.browser.sidebar_collapsed);
  w.Type("gs");
  CHECK_TRUE(!w.browser.sidebar_collapsed);
  w.Press(":", true);
  w.Submit("vertical-tabs off");
  CHECK_TRUE(!w.browser.vertical_tabs());
  w.Type("gs");
  CHECK_EQ_STR(w.browser.message, "error: tabs are not in a sidebar");
  // A config that says "vertical" no longer overrides the user's choice.
  w.router.OnConfigRead(true, "[options]\nvertical_tabs = true\n", "cfg.toml",
                        false, w.browser);
  CHECK_TRUE(!w.browser.vertical_tabs());
  w.Press(":", true);
  w.Submit("vtabs");
  CHECK_TRUE(w.browser.vertical_tabs());
}

void Splits() {
  g_scenario = "splits and pins";
  Window w;
  w.Press("w", false, /*ctrl=*/true);
  w.Press("v");
  CHECK_EQ_INT(w.browser.tabs.size(), 2);
  CHECK_EQ_INT(w.browser.active_index, 1);
  CHECK_EQ_STR(w.browser.active().url(), "chrome://newtab/");
  CHECK_TRUE(w.browser.split_partner() == 0);
  w.Press("w", false, true);
  w.Press("w");
  CHECK_EQ_INT(w.browser.active_index, 0);
  // Already split: the host says so.
  CHECK_EQ_STR(w.Run("vsplit docs.rs"), "");
  CHECK_EQ_STR(w.browser.message, "error: this tab is already split");
  w.Press("w", false, true);
  w.Press("o");
  CHECK_TRUE(w.browser.split_partner() < 0);
  CHECK_EQ_STR(w.Run("split docs.rs"), "");
  CHECK_EQ_STR(w.browser.active().url(), "https://docs.rs");
  CHECK_TRUE(w.browser.active().layout == ffi::SplitLayout::Stacked);
  w.Type("gp");
  CHECK_TRUE(w.browser.active().pinned);
  CHECK_EQ_STR(w.Run("pin off"), "");
  CHECK_TRUE(!w.browser.active().pinned);
  CHECK_TRUE(!w.Run("vsplit javascript:alert(1)").empty());
}

void Workspaces() {
  g_scenario = "workspaces save and restore";
  Window w;
  w.browser.AddTab("https://docs.rs", "Docs", /*background=*/false);
  w.Run("vsplit github.com");
  w.browser.tabs[0].pinned = true;
  CHECK_EQ_STR(w.Run("workspace project /tmp/research-project"), "");
  CHECK_EQ_STR(w.Run("workspace save research"), "");
  CHECK_EQ_STR(w.browser.snapshot_request, "research");
  w.AnswerSnapshot();
  CHECK_EQ_STR(w.browser.message, "Saved workspace research (3 tabs)");
  CHECK_EQ_STR(w.router.workspace(), "research");
  CHECK_EQ_STR(w.router.autosave_workspace(), "research");
  CHECK_TRUE(w.browser.workspace_files.count("research") == 1);

  // A second window, with only a new tab, opens it in place.
  Window other;
  other.browser.tabs[0].history = {"chrome://newtab/"};
  other.Type("gw");
  CHECK_TRUE(other.browser.palette_visible);
  CHECK_TRUE(other.browser.items_source == ffi::ItemSource::Workspaces);
  ::rust::Vec<ffi::ListItem> items;
  items.push_back(ffi::ListItem{"research", "", "research", 940, false});
  other.router.OnItems(ffi::ItemSource::Workspaces, std::move(items), 1000,
                       other.browser);
  CHECK_EQ_INT(other.browser.palette_rows.size(), 1);
  other.PaletteKey(ffi::PaletteKey::Accept);
  CHECK_EQ_STR(other.browser.workspace_read_request, "research");
  other.router.OnWorkspaceRead("research", true,
                               w.browser.workspace_files["research"],
                               other.browser);
  CHECK_TRUE(other.browser.restored);
  const WorkspaceRestore& r = other.browser.last_restore;
  CHECK_TRUE(!r.new_window);
  CHECK_EQ_STR(r.project, "/tmp/research-project");
  CHECK_EQ_INT(r.tabs.size(), 3);
  CHECK_TRUE(r.tabs[0].pinned);
  CHECK_EQ_INT(r.tabs[1].split_with, 2);
  CHECK_EQ_INT(r.tabs[2].split_with, 1);
  CHECK_EQ_INT(r.active, 2);
  CHECK_EQ_STR(other.router.workspace(), "research");
  CHECK_EQ_STR(other.browser.message, "Opened workspace research (3 tabs)");

  // Project metadata survives the real bridge/router and the new-window
  // handoff, then remains in the destination's next autosave.
  Window occupied;
  occupied.browser.tabs[0].history = {"https://example.com/"};
  occupied.router.OnWorkspaceRead("research", true,
                                  w.browser.workspace_files["research"],
                                  occupied.browser);
  const WorkspaceRestore& fresh = occupied.browser.last_restore;
  CHECK_TRUE(fresh.new_window);
  CHECK_EQ_STR(fresh.project, "/tmp/research-project");
  Window destination;
  destination.router.SetWorkspace(fresh.name, fresh.project);
  destination.Run("workspace save research");
  destination.AnswerSnapshot();
  CHECK_TRUE(destination.browser.workspace_files["research"].find(
                 "\"project\": \"/tmp/research-project\"") !=
             std::string::npos);

  other.router.OnWorkspaceRead("nope", false, "", other.browser);
  CHECK_EQ_STR(other.browser.message,
               "error: No workspace named nope (:workspace lists them)");
  CHECK_EQ_STR(other.Run("workspace delete research"), "");
  CHECK_TRUE(other.browser.workspace_files.count("research") == 0);

  Window priv;
  priv.router.SetWindow(true);
  CHECK_TRUE(!priv.Run("workspace save x").empty());
  priv.router.SetWorkspace("x");
  CHECK_EQ_STR(priv.router.autosave_workspace(), "");
}

void ListsAndBrowserPages() {
  g_scenario = "history, browser pages";
  Window w;
  w.Type("gh");
  CHECK_TRUE(w.browser.items_source == ffi::ItemSource::History);
  ::rust::Vec<ffi::ListItem> items;
  items.push_back(ffi::ListItem{"Rust book", "https://doc.rust-lang.org/book/",
                                "https://doc.rust-lang.org/book/", 0, false});
  items.push_back(ffi::ListItem{"Bookmarklet", "javascript:x", "javascript:x",
                                0, false});
  w.router.OnItems(ffi::ItemSource::History, std::move(items), 0, w.browser);
  CHECK_EQ_INT(w.browser.palette_rows.size(), 2);
  w.router.OnPaletteTextChanged("rust", w.browser);
  w.PaletteKey(ffi::PaletteKey::Accept);
  CHECK_EQ_STR(w.browser.active().url(), "https://doc.rust-lang.org/book/");

  w.Run("private");
  CHECK_EQ_INT(w.browser.private_windows_opened, 1);
  w.Run("downloads");
  CHECK_TRUE(w.browser.last_page == ffi::BrowserPage::Downloads);
  w.Type("gB");
  CHECK_EQ_INT(w.browser.bookmarks_added, 1);
  w.Run("devtools");
  CHECK_EQ_INT(w.browser.devtools_toggles, 1);
}

void OutlineAndExtract() {
  g_scenario = "outline, jumps and extraction";
  Window w;
  w.Type("gO");
  CHECK_TRUE(w.browser.palette_visible);
  CHECK_TRUE(w.browser.palette_kind == ffi::PaletteKind::Outline);
  CHECK_EQ_INT(w.browser.document_requests, 1);
  ::rust::Vec<ffi::PageBlock> blocks;
  blocks.push_back(MakeBlock(ffi::BlockKind::Heading, 1, "Intro", 0));
  blocks.push_back(MakeBlock(ffi::BlockKind::Heading, 2, "Install", 1));
  blocks.push_back(MakeBlock(ffi::BlockKind::Code, 1, "cargo add x", 2));
  w.router.OnDocumentCollected(w.browser.document_generation, "Page",
                               "https://x.example/", std::move(blocks),
                               w.browser);
  CHECK_EQ_INT(w.browser.palette_rows.size(), 3);
  w.router.OnPaletteTextChanged("inst", w.browser);
  w.PaletteKey(ffi::PaletteKey::Accept);
  CHECK_EQ_INT(w.browser.revealed_element, 1);
  CHECK_TRUE(!w.browser.palette_visible);

  w.Type("]]");
  CHECK_EQ_STR(w.browser.last_jump, "heading+1");
  w.Type("2[c");
  CHECK_EQ_STR(w.browser.last_jump, "code-2");

  w.Type("yM");
  ::rust::Vec<ffi::PageBlock> page;
  page.push_back(MakeBlock(ffi::BlockKind::Paragraph, 1, "Hello *world*", 0));
  w.router.OnDocumentCollected(w.browser.document_generation, "T", "",
                               std::move(page), w.browser);
  CHECK_EQ_STR(w.browser.clipboard, "# T\n\nHello \\*world\\*\n");
  CHECK_EQ_STR(w.browser.copied_what, "page as Markdown");
}

void EditorAndSelection() {
  g_scenario = "external editor and Visual mode";
  Window w;
  w.router.SetEnvironment("", "");
  CHECK_EQ_STR(w.Run("edit"), "");
  CHECK_EQ_INT(w.browser.field_inspections, 1);
  ffi::FieldInfo field{ffi::FieldKind::TextArea, "", "", "comment", 5, false};
  w.router.OnFieldInfo(field, false, w.browser);
  CHECK_TRUE(w.browser.message.find("No editor configured") !=
             std::string::npos);
  w.router.SetEnvironment("neovide --no-fork", "");
  w.router.OnFieldInfo(field, false, w.browser);
  CHECK_EQ_INT(w.browser.editor_argv.size(), 3);
  if (w.browser.editor_argv.size() == 3) {
    CHECK_EQ_STR(w.browser.editor_argv[2], "{file}");
  }
  ffi::FieldInfo password{ffi::FieldKind::Input, "password", "", "", 5, false};
  w.browser.editor_argv.clear();
  w.router.OnFieldInfo(password, true, w.browser);
  CHECK_TRUE(w.browser.editor_argv.empty());
  CHECK_EQ_STR(w.browser.message,
               "error: Password fields never leave the browser");

  // v: hints over text blocks, then motions and y.
  w.browser.page_targets = {ffi::HintKind::Block, ffi::HintKind::Block};
  w.ShowHints("v");
  CHECK_TRUE(w.browser.hint_targets == ffi::HintTargets::Text);
  w.Type("s");
  CHECK_TRUE(w.router.mode() == ffi::Mode::Visual);
  w.Type("j2w");
  CHECK_EQ_STR(w.browser.selection_moves, "+line*1 +word*2 ");
  w.Type("y");
  CHECK_EQ_STR(w.browser.clipboard, "selected text");
  CHECK_EQ_INT(w.browser.selection_clears, 1);
  CHECK_TRUE(w.router.mode() == ffi::Mode::Normal);
}

void BrowserctlRequests() {
  g_scenario = "browserctl protocol through the bridge";
  ffi::IpcRequest r = ffi::ipc_parse(
      R"({"v":1,"id":3,"cmd":"open","url":"docs.rs","where":"background"})");
  CHECK_TRUE(r.kind == ffi::IpcKind::Open);
  CHECK_EQ_INT(r.id, 3);
  CHECK_TRUE(r.disposition == ffi::OpenDisposition::NewBackgroundTab);
  Window w;
  CHECK_EQ_STR(w.router.OnOpenText(std::string(r.text), r.disposition,
                                   "browserctl", w.browser),
               "");
  CHECK_EQ_INT(w.browser.tabs.size(), 2);
  CHECK_EQ_STR(w.browser.tabs[1].url(), "https://docs.rs");
  CHECK_TRUE(!w.router
                  .OnOpenText("javascript:alert(1)",
                              ffi::OpenDisposition::CurrentTab, "browserctl",
                              w.browser)
                  .empty());

  ffi::IpcRequest bad = ffi::ipc_parse(R"({"id":4,"cmd":"rm"})");
  CHECK_TRUE(bad.kind == ffi::IpcKind::Invalid);
  CHECK_EQ_INT(bad.id, 4);
  CHECK_EQ_STR(std::string(ffi::ipc_reply_error(bad.id, std::string(bad.error))),
               R"({"v":1,"id":4,"ok":false,"error":"unknown command 'rm'"})");
  CHECK_EQ_STR(std::string(ffi::ipc_reply_pong(-1)),
               R"({"v":1,"ok":true,"result":{"protocol":1,"product":"modal_browser"}})");
  CHECK_TRUE(ffi::is_workspace_name("research"));
  CHECK_TRUE(!ffi::is_workspace_name("../x"));
  ::rust::Vec<::rust::String> argv;
  argv.push_back("nvim");
  argv.push_back("{file}");
  ::rust::Vec<::rust::String> out = ffi::editor_argv(
      ::rust::Slice<const ::rust::String>(argv.data(), argv.size()),
      "/tmp/a b.md");
  CHECK_EQ_STR(std::string(out[1]), "/tmp/a b.md");
}

void MarksMacrosAliasesProjects() {
  g_scenario = "marks, macros, aliases, projects";
  Window w;
  w.Type("ma");
  CHECK_EQ_STR(w.browser.mark_request, "a");
  w.router.OnMarkRecorded("a", w.browser.active().url(), 0, 700, w.browser);
  CHECK_EQ_STR(w.browser.message, "Mark a set");
  w.Type("G");
  w.Type("'a");
  CHECK_EQ_STR(w.browser.last_mark_jump, "a https://example.com/ 700");
  CHECK_EQ_INT(w.browser.active().scroll_y, 700);

  w.Type("qbjjq");
  CHECK_EQ_STR(w.browser.message, "Recorded @b (2 keys)");
  const int before = w.browser.active().scroll_y;
  w.Type("@b");
  CHECK_EQ_INT(w.browser.active().scroll_y, before + 120);

  w.router.OnConfigRead(true, "[aliases]\nrs = \"open docs.rs\"\n", "cfg.toml",
                        false, w.browser);
  CHECK_EQ_STR(w.Run("rs"), "");
  CHECK_EQ_STR(w.browser.active().url(), "https://docs.rs");

  CHECK_EQ_STR(w.Run("workspace project /tmp/proj"), "");
  CHECK_EQ_STR(w.Run("workspace save p"), "");
  w.AnswerSnapshot();
  ::rust::Vec<::rust::String> names;
  names.push_back("p");
  ::rust::Vec<::rust::String> texts;
  texts.push_back(::rust::String(w.browser.workspace_files["p"]));
  CHECK_EQ_STR(std::string(ffi::workspace_for_dir(
                   ::rust::Slice<const ::rust::String>(names.data(), names.size()),
                   ::rust::Slice<const ::rust::String>(texts.data(), texts.size()),
                   "/tmp/proj/src")),
               "p");
  ffi::IpcRequest here = ffi::ipc_parse(
      R"({"cmd":"workspace","action":"here","dir":"/tmp/proj"})");
  CHECK_TRUE(here.kind == ffi::IpcKind::WorkspaceHere);
  CHECK_EQ_STR(std::string(here.text), "/tmp/proj");
}

}  // namespace

int32_t RunAllScenarios() {
  g_failures = 0;
  TabnewThroughCommandLine();
  OpenPrefillAndSearch();
  BareHostGetsHttps();
  CommandErrorsKeepLineOpen();
  TypingInTextFieldsIsNeverHijacked();
  EscapeLeavesTextField();
  EscapeInNormalReachesPage();
  SequencesTimersAndCounts();
  TabKeys();
  BrowserShortcutsAndModifierKeysPassThrough();
  BrowserUiFocusAndImeAreUntouched();
  Passthrough();
  Hints();
  HintsCancelAndStale();
  ReloadFindAddressHelp();
  CompletionAndBinding();
  TabSwitcher();
  CommandPaletteAndCompletion();
  ClipboardYankAndPaste();
  UrlMotions();
  WhichKeyInStatus();
  ConfigLoadAndReload();
  BrowserShell();
  Splits();
  Workspaces();
  ListsAndBrowserPages();
  OutlineAndExtract();
  EditorAndSelection();
  BrowserctlRequests();
  MarksMacrosAliasesProjects();
  std::fprintf(stderr, "host harness: 30 scenarios, %d failed checks\n",
               g_failures);
  return g_failures;
}

}  // namespace modal_browser::harness
