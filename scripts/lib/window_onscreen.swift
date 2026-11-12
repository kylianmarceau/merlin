// Prints the Unix-epoch time in ms at which process <pid> first has a window
// on screen (at least 300×200, not transparent), or -1 after <timeout-ms>.
// The benchmark compiles and runs this alongside each launch.
//
//   swiftc -O scripts/lib/window_onscreen.swift -o /tmp/window_onscreen
//   /tmp/window_onscreen <pid> [timeout-ms]
import CoreGraphics
import Foundation

let args = CommandLine.arguments
guard args.count >= 2, let pid = Int32(args[1]) else {
  FileHandle.standardError.write("usage: window_onscreen <pid> [timeout-ms]\n".data(using: .utf8)!)
  exit(2)
}
let timeout = args.count >= 3 ? (Double(args[2]) ?? 15000) : 15000
let deadline = Date().addingTimeInterval(timeout / 1000)

func hasWindow() -> Bool {
  guard let list = CGWindowListCopyWindowInfo([.optionOnScreenOnly], kCGNullWindowID) as? [[String: Any]] else { return false }
  return list.contains { window in
    guard (window[kCGWindowOwnerPID as String] as? Int32) == pid,
          let bounds = window[kCGWindowBounds as String] as? [String: CGFloat] else { return false }
    return (bounds["Width"] ?? 0) >= 300 && (bounds["Height"] ?? 0) >= 200 &&
      ((window[kCGWindowAlpha as String] as? Double) ?? 0) > 0
  }
}

while Date() < deadline {
  if hasWindow() {
    print(String(format: "%.1f", Date().timeIntervalSince1970 * 1000))
    exit(0)
  }
  usleep(2000)
}
print("-1")
