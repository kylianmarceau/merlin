// Keeps the browser under test from taking focus while a benchmark runs, so
// the Mac can be used meanwhile. Whenever an app inside one of the given
// bundles becomes active, the last other active app is reactivated. Runs
// until stdin closes.
//   focus_keeper "/Applications/Brave Browser.app" [more bundles...]
import AppKit

let bundles = CommandLine.arguments.dropFirst().map {
  URL(fileURLWithPath: $0).standardizedFileURL.path
}
func isUnderTest(_ app: NSRunningApplication) -> Bool {
  guard let path = app.bundleURL?.standardizedFileURL.path else { return false }
  return bundles.contains { path == $0 || path.hasPrefix($0 + "/") }
}

var user = NSWorkspace.shared.frontmostApplication
if let app = user, isUnderTest(app) { user = nil }

NSWorkspace.shared.notificationCenter.addObserver(
  forName: NSWorkspace.didActivateApplicationNotification, object: nil, queue: .main
) { note in
  guard let app = note.userInfo?[NSWorkspace.applicationUserInfoKey] as? NSRunningApplication
  else { return }
  if !isUnderTest(app) {
    user = app
    return
  }
  if let back = user, !back.isTerminated {
    back.activate(options: [])
  }
}

FileHandle.standardInput.readabilityHandler = { handle in
  if handle.availableData.isEmpty { exit(0) }
}
print("ready")
fflush(stdout)
RunLoop.main.run()
