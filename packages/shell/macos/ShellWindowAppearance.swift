import AppKit
import ExpoModulesCore

// Puts the React root in the macOS appearance that matches the shell's theme.
// The shell draws its own colours, but AppKit still draws some parts itself:
// the text caret, text selection and native menus. They follow the view's
// appearance, not React's palette. Chromium sets the window's appearance
// from macOS's mode, so with Merlin set to Light on a Mac in dark mode the
// caret was drawn white on the shell's white fields and could not be seen.
//
// This sets the React root view rather than the window: Chromium resets the
// window's appearance whenever its own colour mode changes. "system" clears
// the override, so the root follows the window again. Web pages are
// unaffected: Chromium takes their colour scheme from the app.
final class MerlinWindowAppearance: ExpoView {
  var mode = "system" {
    didSet { apply() }
  }

  override func viewDidMoveToWindow() {
    super.viewDidMoveToWindow()
    apply()
  }

  override func hitTest(_ point: NSPoint) -> NSView? { nil }

  private func apply() {
    guard let root = reactRoot() else { return }
    let appearance: NSAppearance? = switch mode {
    case "light": NSAppearance(named: .aqua)
    case "dark": NSAppearance(named: .darkAqua)
    default: nil
    }
    if root.appearance?.name != appearance?.name { root.appearance = appearance }
  }

  // The RCTRootView this view was mounted in.
  private func reactRoot() -> NSView? {
    guard window != nil else { return nil }
    var view: NSView? = superview
    while let current = view {
      if NSStringFromClass(type(of: current)).contains("RCTRootView") { return current }
      view = current.superview
    }
    return nil
  }
}
