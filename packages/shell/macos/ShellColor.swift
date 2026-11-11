import AppKit

// Colours arrive as the shell's token strings: #RRGGBB, #RRGGBBAA or
// rgba(r, g, b, a). Anything else is ignored rather than guessed.
enum ShellColor {
  static func parse(_ value: String?) -> NSColor? {
    guard let raw = value?.trimmingCharacters(in: .whitespaces), !raw.isEmpty else { return nil }
    if raw == "transparent" { return .clear }
    if raw.hasPrefix("#") {
      let hex = String(raw.dropFirst())
      guard hex.count == 6 || hex.count == 8, let bits = UInt64(hex, radix: 16) else { return nil }
      let rgba = hex.count == 6 ? (bits << 8) | 0xFF : bits
      return NSColor(srgbRed: CGFloat((rgba >> 24) & 255) / 255, green: CGFloat((rgba >> 16) & 255) / 255,
                     blue: CGFloat((rgba >> 8) & 255) / 255, alpha: CGFloat(rgba & 255) / 255)
    }
    if raw.hasPrefix("rgba(") || raw.hasPrefix("rgb("), raw.hasSuffix(")"),
       let open = raw.firstIndex(of: "(") {
      let parts = raw[raw.index(after: open)..<raw.index(before: raw.endIndex)]
        .split(separator: ",").map { Double($0.trimmingCharacters(in: .whitespaces)) }
      guard parts.count == 3 || parts.count == 4, parts.allSatisfy({ $0 != nil }) else { return nil }
      let v = parts.map { $0! }
      return NSColor(srgbRed: v[0] / 255, green: v[1] / 255, blue: v[2] / 255, alpha: v.count == 4 ? v[3] : 1)
    }
    return nil
  }
}
