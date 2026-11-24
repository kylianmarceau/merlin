// Run on macOS: swiftc packages/engine/macos/SetupImport.swift tests/import/SetupImportFixtures.swift -o /tmp/merlin-import-fixtures && /tmp/merlin-import-fixtures
import Compression
import Foundation
import SQLite3

enum MerlinEngineBridge {
  static func callWindow(_ window: String, method: String, arguments: String) -> String {
    fatalError("Fixtures must supply their own destination.")
  }
}

@main
struct SetupImportFixtures {
  static let manager = FileManager.default

  static func main() throws {
    let library = manager.temporaryDirectory.appendingPathComponent("merlin-import-fixtures-" + UUID().uuidString)
    defer { try? manager.removeItem(at: library) }
    let chromiumRoots = ["chrome": "Google/Chrome", "dia": "Dia/User Data",
                         "brave": "BraveSoftware/Brave-Browser", "edge": "Microsoft Edge",
                         "helium": "net.imput.helium"]
    for root in chromiumRoots.values {
      try chromium(library.appendingPathComponent("Application Support/" + root + "/Default"))
    }
    try firefox(library.appendingPathComponent("Application Support/zen"))
    try firefox(library.appendingPathComponent("Application Support/Firefox"))
    try safari(library.appendingPathComponent("Safari"))
    try arc(library.appendingPathComponent("Application Support/Arc"))
    let all = ["bookmarks", "history", "tabs"]
    let fixtureBrowsers = chromiumRoots.keys.sorted() + ["firefox", "zen", "safari", "arc"]
    for browser in fixtureBrowsers {
      let categories = browser == "arc" ? ["tabs"] : all
      let source = try SetupImport.list(browser, library: library)
      precondition(source.count == 1, browser)
      var rows = [String: [[String: Any]]]()
      let report = SetupImport.run(window: "fixture", browser: browser, profile: source[0]["id"]!, categories: categories,
        library: library) { window, args in
          precondition(window == "fixture")
          let batch = try! JSONSerialization.jsonObject(with: Data(args.utf8)) as! [String: Any]
          let category = batch["category"] as! String
          let data = batch["entries"] as! [[String: Any]]
          for row in data { precondition((row["url"] as? String)?.hasPrefix("https://example.test/") == true) }
          rows[category, default: []] += data
          return "{\"ok\":true,\"value\":\(data.count)}"
        }
      for (category, item) in zip(categories, report) {
        precondition(item["count"] as? Int == 1 && item["error"] == nil, "\(browser) \(category) \(item)")
      }
      if browser != "safari" { precondition(rows["tabs"]?.first?["pinned"] as? Bool == true, browser) }
    }
    let unreadable = SetupImport.run(window: "fixture", browser: "chrome", profile: "../unselected",
      categories: ["tabs"], library: library)
    precondition(unreadable.first?["error"] != nil)
    try manager.removeItem(at: library.appendingPathComponent("Safari/History.db"))
    let failures = SetupImport.run(window: "fixture", browser: "safari", profile: "default",
      categories: ["history"], library: library)
    precondition(failures.first?["error"] != nil)
    print("Passed import fixtures for all nine browser sources")
  }

  static func writeJSON(_ value: Any, _ file: URL) throws {
    try JSONSerialization.data(withJSONObject: value).write(to: file)
  }

  static func writePlist(_ value: Any, _ file: URL) throws {
    try PropertyListSerialization.data(fromPropertyList: value, format: .binary, options: 0).write(to: file)
  }

  static func database(_ path: URL, _ statement: String) {
    var connection: OpaquePointer?
    precondition(sqlite3_open(path.path, &connection) == SQLITE_OK)
    defer { sqlite3_close(connection) }
    precondition(sqlite3_exec(connection, statement, nil, nil, nil) == SQLITE_OK)
  }

  static func chromium(_ profile: URL) throws {
    let sessions = profile.appendingPathComponent("Sessions")
    try manager.createDirectory(at: sessions, withIntermediateDirectories: true)
    try writeJSON(["roots": ["bookmark_bar": ["name": "Bookmarks bar", "children": [
      ["name": "Example", "url": "https://example.test/bookmark"],
    ]]]], profile.appendingPathComponent("Bookmarks"))
    database(profile.appendingPathComponent("History"), """
      CREATE TABLE urls(url TEXT, title TEXT, last_visit_time INTEGER, visit_count INTEGER);
      INSERT INTO urls VALUES('https://example.test/history','Example',13390000000000000,2);
      """)
    func littleEndian<T: FixedWidthInteger>(_ value: T) -> Data {
      withUnsafeBytes(of: value.littleEndian) { Data($0) }
    }
    func record(_ command: UInt8, _ body: Data) -> Data {
      littleEndian(UInt16(body.count + 1)) + Data([command]) + body
    }
    let url = Data("https://example.test/tab".utf8)
    let navigated = littleEndian(Int32(0)) + littleEndian(Int32(1)) + littleEndian(Int32(0))
      + littleEndian(Int32(url.count)) + url
    let session = littleEndian(UInt32(0x53534e53)) + littleEndian(UInt32(3))
      + record(0, littleEndian(Int32(2)) + littleEndian(Int32(1)))
      + record(6, navigated) + record(12, littleEndian(Int32(1)) + Data([1])) + record(255, Data())
    try session.write(to: sessions.appendingPathComponent("Session_100"))
  }

  static func firefox(_ root: URL) throws {
    let profile = root.appendingPathComponent("Profiles/default")
    try manager.createDirectory(at: profile, withIntermediateDirectories: true)
    let ini = "[Profile0]\nName=Test profile\nIsRelative=1\nPath=Profiles/default\n"
    try Data(ini.utf8).write(to: root.appendingPathComponent("profiles.ini"))
    database(profile.appendingPathComponent("places.sqlite"), """
      CREATE TABLE moz_places(id INTEGER, url TEXT, title TEXT, last_visit_date INTEGER, visit_count INTEGER);
      CREATE TABLE moz_bookmarks(id INTEGER, parent INTEGER, position INTEGER, title TEXT, fk INTEGER, type INTEGER);
      INSERT INTO moz_places VALUES(1,'https://example.test/history','Example',1700000000000000,1);
      INSERT INTO moz_bookmarks VALUES(1,0,0,'Menu',NULL,2),(2,1,0,'Example',1,1);
      """)
    let data = try JSONSerialization.data(withJSONObject: ["windows": [["tabs": [
      ["index": 1, "pinned": true, "entries": [["url": "https://example.test/tab"]]],
    ]]]])
    var compressed = Data(count: 4096)
    let written = compressed.withUnsafeMutableBytes { target in
      data.withUnsafeBytes { source in
        compression_encode_buffer(target.bindMemory(to: UInt8.self).baseAddress!, target.count,
          source.bindMemory(to: UInt8.self).baseAddress!, source.count, nil, COMPRESSION_LZ4_RAW)
      }
    }
    precondition(written > 0)
    var length = UInt32(data.count).littleEndian
    let session = Data("mozLz40\0".utf8) + withUnsafeBytes(of: &length) { Data($0) } + compressed.prefix(written)
    try session.write(to: profile.appendingPathComponent("sessionstore.jsonlz4"))
  }

  static func safari(_ root: URL) throws {
    try manager.createDirectory(at: root, withIntermediateDirectories: true)
    try writePlist(["Children": [["Title": "Example", "URLString": "https://example.test/bookmark"]]],
                   root.appendingPathComponent("Bookmarks.plist"))
    database(root.appendingPathComponent("History.db"), """
      CREATE TABLE history_items(id INTEGER, url TEXT, visit_count INTEGER);
      CREATE TABLE history_visits(id INTEGER, history_item INTEGER, title TEXT, visit_time REAL);
      INSERT INTO history_items VALUES(1,'https://example.test/history',1);
      INSERT INTO history_visits VALUES(1,1,'Example',700000000);
      """)
    try writePlist(["SessionWindows": [["TabStates": [["TabURL": "https://example.test/tab"]]]]],
                   root.appendingPathComponent("LastSession.plist"))
  }

  static func arc(_ root: URL) throws {
    let profile = root.appendingPathComponent("User Data/Default")
    try manager.createDirectory(at: profile, withIntermediateDirectories: true)
    try writeJSON([String: String](), profile.appendingPathComponent("Preferences"))
    try writeJSON(["sidebar": ["containers": [[
      "spaces": [["containerIDs": ["pinned", "root"]]],
      "items": [["id": "a", "parentID": "root", "data": ["tab": ["savedURL": "https://example.test/arc"]]]],
    ]]]], root.appendingPathComponent("StorableSidebar.json"))
  }
}
