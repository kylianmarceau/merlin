//! What currently has keyboard focus, as reported by the host.
//!
//! The core never inspects the DOM. The browser host fills a
//! [`FocusContext`] from information Chromium already tracks:
//!
//! * `content::WebContents::IsFocusedElementEditable()` and
//!   `WebContentsObserver::OnFocusChangedInPage()` (whose
//!   `FocusedNodeDetails::editable_level` maps onto [`Editable`]) tell us
//!   whether an `<input>`, `<textarea>`, or `contenteditable` element in any
//!   frame of the page is focused.
//! * Keys only reach the modal layer through
//!   `BrowserView::PreHandleKeyboardEvent`, which Chromium calls for key
//!   events headed to web content. Omnibox, dialog and command-line keys
//!   never arrive there; [`FocusTarget::BrowserUi`] exists so other hosts
//!   (tests, a future CLI) can state it explicitly.
//! * IME composition keys are flagged `skip_if_unhandled` by Chromium and
//!   skip `PreHandleKeyboardEvent` entirely (see
//!   `RenderWidgetHostImpl::ForwardKeyboardEventWithCommands`). The
//!   `ime_composing` flag is still honoured as a second line of defence.
//!
//! Not handled yet, and the reason Passthrough mode exists: pages that build
//! their own editors out of non-editable elements and keydown listeners
//! (some canvas editors, terminals, games). Site-specific rules are planned.

/// How editable the focused page element is. Mirrors
/// `content::EditableLevel` (kPlaintextEditable / kRichlyEditable).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum Editable {
    PlainText,
    RichText,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Hash)]
pub enum FocusTarget {
    /// The page has focus and the focused element is not editable.
    #[default]
    Page,
    /// An editable element in the page has focus.
    PageEditable(Editable),
    /// Browser chrome has focus: omnibox, command line, dialogs, menus.
    BrowserUi,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Hash)]
pub struct FocusContext {
    pub target: FocusTarget,
    /// An input method composition is in progress.
    pub ime_composing: bool,
}

impl FocusContext {
    pub const PAGE: Self = Self {
        target: FocusTarget::Page,
        ime_composing: false,
    };
    pub const EDITABLE: Self = Self {
        target: FocusTarget::PageEditable(Editable::PlainText),
        ime_composing: false,
    };
    pub const BROWSER_UI: Self = Self {
        target: FocusTarget::BrowserUi,
        ime_composing: false,
    };

    pub fn is_editable(&self) -> bool {
        matches!(self.target, FocusTarget::PageEditable(_))
    }

    /// Keys in this context must never be touched by the modal layer,
    /// whatever the mode.
    pub fn is_off_limits(&self) -> bool {
        self.ime_composing || self.target == FocusTarget::BrowserUi
    }
}
