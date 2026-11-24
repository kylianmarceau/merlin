import Foundation
import SQLite3
import Compression

/// Read only the browser data a person selected. Credential import stays in
/// Chromium's password manager, which owns the file picker and authentication.
enum SetupImport {
  private enum Family { case chromium, firefox, safari }
  private struct Source {
    let path: String
    let family: Family
  }
  private struct Profile {
    let id: String
    let name: String
    let directory: URL
  }
  private struct ImportFailure: LocalizedError {
    let errorDescription: String?
    init(_ message: String) { errorDescription = message }
  }
  private static let sources: [String: Source] = [
    "arc": Source(path: "Application Support/Arc/User Data", family: .chromium),
    "dia": Source(path: "Application Support/Dia/User Data", family: .chromium),
    "chrome": Source(path: "Application Support/Google/Chrome", family: .chromium),
    "brave": Source(path: "Application Support/BraveSoftware/Brave-Browser", family: .chromium),
    "edge": Source(path: "Application Support/Microsoft Edge", family: .chromium),
    "helium": Source(path: "Application Support/net.imput.helium", family: .chromium),
    "firefox": Source(path: "Application Support/Firefox", family: .firefox),
    "zen": Source(path: "Application Support/zen", family: .firefox),
    "safari": Source(path: "Safari", family: .safari),
  ]

  static let library = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library")

  static func list(_ browser: String, library: URL = library) throws -> [[String: String]] {
    guard let source = sources[browser] else { return [] }
    return try profiles(source, library: library)
      .map { ["id": $0.id, "name": $0.name] }
  }

  private static func dictionary(_ url: URL, plist: Bool = false) throws -> [String: Any] {
    let data = try Data(contentsOf: url, options: .mappedIfSafe)
    let object = try plist
      ? PropertyListSerialization.propertyList(from: data, format: nil)
      : JSONSerialization.jsonObject(with: data)
    guard let result = object as? [String: Any] else { throw ImportFailure("The source file has an unexpected format.") }
    return result
  }

  private static func profiles(_ source: Source, library: URL) throws -> [Profile] {
    let root = library.appendingPathComponent(source.path)
    if source.family == .safari { return [Profile(id: "default", name: "Safari", directory: root)] }
    let manager = FileManager.default
    if source.family == .chromium {
      let names = try manager.contentsOfDirectory(atPath: root.path)
      let state = try? dictionary(root.appendingPathComponent("Local State"))
      let metadata = (state?["profile"] as? [String: Any])?["info_cache"] as? [String: [String: Any]] ?? [:]
      return names.sorted().compactMap { name in
        let directory = root.appendingPathComponent(name)
        let files = (try? manager.contentsOfDirectory(atPath: directory.path)) ?? []
        guard files.contains("Preferences") || files.contains("Bookmarks") || files.contains("History") else { return nil }
        return Profile(id: name, name: metadata[name]?["name"] as? String ?? name, directory: directory)
      }
    }
    let ini = try String(contentsOf: root.appendingPathComponent("profiles.ini"), encoding: .utf8)
    return ini.components(separatedBy: "[Profile").dropFirst().compactMap { section in
      var fields = [String: String]()
      for line in section.components(separatedBy: .newlines).dropFirst() {
        if line.hasPrefix("[") { break }
        let pair = line.split(separator: "=", maxSplits: 1)
        if pair.count == 2 { fields[String(pair[0])] = String(pair[1]) }
      }
      guard let path = fields["Path"] else { return nil }
      let directory = fields["IsRelative"] == "0" ? URL(fileURLWithPath: path) : root.appendingPathComponent(path)
      return Profile(id: path, name: fields["Name"] ?? directory.lastPathComponent, directory: directory)
    }
  }

  static func run(window: String, browser: String, profile: String, categories: [String],
                  library: URL = library, send: (String, String) -> String = sendBatch) -> [[String: Any]] {
    let directory: URL
    let source: Source
    do {
      guard let found = sources[browser] else { throw ImportFailure("Choose a source browser.") }
      source = found
      guard let selected = try profiles(source, library: library).first(where: { $0.id == profile }) else {
        throw ImportFailure("The source profile is no longer available.")
      }
      directory = selected.directory
    } catch {
      return categories.map { ["category": $0, "count": 0, "error": error.localizedDescription] }
    }

    return categories.map { category in
      var count = 0
      var batch = [[String: Any]]()
      func writeBatch() throws {
        guard !batch.isEmpty else { return }
        let data = try JSONSerialization.data(withJSONObject: ["category": category, "entries": batch])
        let args = String(decoding: data, as: UTF8.self)
        let response = send(window, args)
        let result = try JSONSerialization.jsonObject(with: Data(response.utf8)) as? [String: Any]
        guard let added = result?["value"] as? Int, result?["ok"] as? Bool == true else {
          throw ImportFailure(result?["error"] as? String ?? "Merlin could not save this batch.")
        }
        count += added
        batch.removeAll(keepingCapacity: true)
      }

      do {
        let rows: [[String: Any]]
        switch category {
        case "bookmarks": rows = try bookmarks(directory, source.family)
        case "history": rows = try history(directory, source.family)
        case "tabs":
          if browser == "arc", let sidebar = try? arcTabs(directory) { rows = sidebar }
          else { rows = try tabs(directory, source.family) }
        default: throw ImportFailure("This category uses the native file importer.")
        }
        for row in rows {
          batch.append(row)
          if batch.count == 4 { try writeBatch() }
        }
        try writeBatch()
        return ["category": category, "count": count, "skipped": rows.count - count]
      } catch {
        return ["category": category, "count": count, "error": error.localizedDescription]
      }
    }
  }

  private static func sendBatch(_ window: String, _ args: String) -> String {
    DispatchQueue.main.sync {
      MerlinEngineBridge.callWindow(window, method: "setup.importBatch", arguments: args)
    }
  }

  private static func webURL(_ candidate: String?) -> String? {
    guard let candidate, candidate.utf8.count <= 4096,
      let parsed = URLComponents(string: candidate), parsed.host != nil,
      ["https", "http"].contains(parsed.scheme?.lowercased() ?? "") else { return nil }
    return candidate
  }

  private static func bookmarks(_ directory: URL, _ family: Family) throws -> [[String: Any]] {
    if family == .firefox {
      var children = [Int64: [(id: Int64, title: String, url: String, folder: Bool)]]()
      try query(directory.appendingPathComponent("places.sqlite"), """
        SELECT b.id, b.parent, COALESCE(b.title,''), COALESCE(p.url,''), b.type
        FROM moz_bookmarks b LEFT JOIN moz_places p ON b.fk=p.id
        WHERE b.type IN (1,2) ORDER BY b.parent,b.position
        """) { row in
        children[sqlite3_column_int64(row, 1), default: []].append(
          (sqlite3_column_int64(row, 0), column(row, 2), column(row, 3), sqlite3_column_int(row, 4) == 2))
      }
      var result = [[String: Any]]()
      func walk(_ parent: Int64, folders: [String]) {
        guard folders.count < 12 else { return }
        for child in children[parent] ?? [] {
          if child.folder { walk(child.id, folders: child.title.isEmpty ? folders : folders + [child.title]) }
          else if let url = webURL(child.url) { result.append(bookmark(url, child.title, folders)) }
        }
      }
      walk(0, folders: [])
      return result
    }
    let safari = family == .safari
    let document = try dictionary(directory.appendingPathComponent(safari ? "Bookmarks.plist" : "Bookmarks"), plist: safari)
    var result = [[String: Any]]()
    func walk(_ node: [String: Any], folders: [String], depth: Int) {
      guard depth < 12 else { return }
      let title = safari
        ? (node["URIDictionary"] as? [String: Any])?["title"] as? String ?? node["Title"] as? String ?? ""
        : node["name"] as? String ?? ""
      if let url = webURL(node[safari ? "URLString" : "url"] as? String) {
        result.append(bookmark(url, title, folders))
      }
      for child in node[safari ? "Children" : "children"] as? [[String: Any]] ?? [] {
        walk(child, folders: title.isEmpty ? folders : folders + [title], depth: depth + 1)
      }
    }
    if safari { walk(document, folders: [], depth: 0) }
    else {
      let roots = document["roots"] as? [String: [String: Any]] ?? [:]
      for key in roots.keys.sorted() {
        if let root = roots[key] { walk(root, folders: [], depth: 0) }
      }
    }
    return result
  }

  private static func bookmark(_ url: String, _ title: String, _ folders: [String]) -> [String: Any] {
    ["url": url, "title": String(title.prefix(160)), "folders": folders.map { String($0.prefix(48)) }]
  }

  private static func history(_ directory: URL, _ family: Family) throws -> [[String: Any]] {
    let name: String
    let sql: String
    switch family {
    case .chromium:
      name = "History"
      sql = "SELECT url, title, last_visit_time / 1000000.0 - 11644473600, visit_count FROM urls WHERE last_visit_time > 0 ORDER BY last_visit_time DESC"
    case .firefox:
      name = "places.sqlite"
      sql = "SELECT url, title, last_visit_date / 1000000.0, visit_count FROM moz_places WHERE last_visit_date > 0 ORDER BY last_visit_date DESC"
    case .safari:
      name = "History.db"
      sql = """
        SELECT i.url, v.title, v.visit_time + 978307200, i.visit_count FROM history_items i
        JOIN history_visits v ON v.id=(SELECT id FROM history_visits WHERE history_item=i.id ORDER BY visit_time DESC LIMIT 1)
        ORDER BY v.visit_time DESC
        """
    }
    var result = [[String: Any]]()
    try query(directory.appendingPathComponent(name), sql) { row in
      guard let url = webURL(column(row, 0)) else { return }
      result.append(["url": url, "title": String(column(row, 1).prefix(160)),
                     "time": sqlite3_column_double(row, 2), "visits": Int(sqlite3_column_int(row, 3))])
    }
    return result
  }

  private static func query(_ file: URL, _ sql: String, row: (OpaquePointer) -> Void) throws {
    var database: OpaquePointer?
    defer { sqlite3_close(database) }
    guard sqlite3_open_v2(file.path, &database, SQLITE_OPEN_READONLY | SQLITE_OPEN_PRIVATECACHE, nil) == SQLITE_OK else {
      throw ImportFailure("Couldn’t read \(file.lastPathComponent). Check macOS access and try again.")
    }
    sqlite3_busy_timeout(database, 1000)
    var statement: OpaquePointer?
    defer { sqlite3_finalize(statement) }
    guard sqlite3_prepare_v2(database, sql, -1, &statement, nil) == SQLITE_OK, let statement else {
      throw ImportFailure("The source database is busy or its format isn’t supported.")
    }
    var status = sqlite3_step(statement)
    while status == SQLITE_ROW {
      row(statement)
      status = sqlite3_step(statement)
    }
    guard status == SQLITE_DONE else { throw ImportFailure("Reading the source database was interrupted. Try again.") }
  }

  private static func column(_ row: OpaquePointer, _ index: Int32) -> String {
    sqlite3_column_text(row, index).map { String(cString: $0) } ?? ""
  }

  // Arc records its sidebar separately from the Chromium session files.
  private static func arcTabs(_ directory: URL) throws -> [[String: Any]] {
    let file = directory.deletingLastPathComponent().deletingLastPathComponent().appendingPathComponent("StorableSidebar.json")
    let archive = try dictionary(file)
    let containers = (archive["sidebar"] as? [String: Any])?["containers"] as? [[String: Any]] ?? []
    guard let sidebar = containers.first(where: { $0["spaces"] != nil && $0["items"] != nil }) else {
      throw ImportFailure("Arc’s sidebar data could not be read.")
    }
    typealias Item = [String: Any]
    var children = [String: [Item]]()
    for item in sidebar["items"] as? [Item] ?? [] {
      if let parent = item["parentID"] as? String { children[parent, default: []].append(item) }
    }
    func profileName(_ descriptor: Any?) -> String {
      let profile = descriptor as? Item
      let custom = profile?["custom"] as? Item
      let path = custom?["_0"] as? Item
      return path?["directoryBasename"] as? String ?? "Default"
    }
    var result = [[String: Any]]()
    var visited = Set<String>()
    func visit(_ root: String, pinned: Bool, depth: Int = 0) {
      guard depth < 20, visited.insert(root).inserted else { return }
      for item in children[root] ?? [] {
        let data = item["data"] as? Item
        let tab = data?["tab"] as? Item
        if let url = webURL(tab?["savedURL"] as? String) {
          result.append(["url": url, "pinned": pinned])
        }
        if let id = item["id"] as? String { visit(id, pinned: pinned, depth: depth + 1) }
      }
    }
    func pairs(_ value: Any?) -> [(Any, Any)] {
      let list = value as? [Any] ?? []
      return stride(from: 0, to: list.count - 1, by: 2).map { (list[$0], list[$0 + 1]) }
    }
    for (descriptor, id) in pairs(sidebar["topAppsContainerIDs"]) where profileName(descriptor) == directory.lastPathComponent {
      if let root = id as? String { visit(root, pinned: true) }
    }
    for space in sidebar["spaces"] as? [Item] ?? [] where profileName(space["profile"]) == directory.lastPathComponent {
      for (key, id) in pairs(space["newContainerIDs"]) + pairs(space["containerIDs"]) {
        let role = key as? String ?? (key as? Item)?.keys.first
        guard role == "pinned" || role == "unpinned", let root = id as? String else { continue }
        visit(root, pinned: role == "pinned")
      }
    }
    return result
  }

  private static func tabs(_ directory: URL, _ family: Family) throws -> [[String: Any]] {
    switch family {
    case .safari:
      let snapshot = try dictionary(directory.appendingPathComponent("LastSession.plist"), plist: true)
      return (snapshot["SessionWindows"] as? [[String: Any]] ?? []).flatMap { window in
        (window["TabStates"] as? [[String: Any]] ?? []).compactMap { item in
          webURL(item["TabURL"] as? String).map { ["url": $0, "pinned": false] }
        }
      }
    case .firefox:
      for file in ["sessionstore.jsonlz4", "sessionstore-backups/recovery.jsonlz4", "sessionstore-backups/recovery.baklz4"] {
        guard let data = try? Data(contentsOf: directory.appendingPathComponent(file)),
          let decoded = try? firefoxSession(data) else { continue }
        return (decoded["windows"] as? [[String: Any]] ?? []).flatMap { window in
          (window["tabs"] as? [[String: Any]] ?? []).compactMap { tab in
            let entries = tab["entries"] as? [[String: Any]] ?? []
            let current = (tab["index"] as? Int ?? entries.count) - 1
            guard entries.indices.contains(current), let url = webURL(entries[current]["url"] as? String) else { return nil }
            return ["url": url, "pinned": tab["pinned"] as? Bool ?? false]
          }
        }
      }
      throw ImportFailure("No readable saved session. Close the source browser and try again.")
    case .chromium:
      let folder = directory.appendingPathComponent("Sessions")
      let names = ((try? FileManager.default.contentsOfDirectory(atPath: folder.path)) ?? [])
        .filter { $0.hasPrefix("Session_") }.sorted(by: >)
      let files = names.map { folder.appendingPathComponent($0) }
        + ["Current Session", "Last Session"].map { directory.appendingPathComponent($0) }
      for file in files {
        if let data = try? Data(contentsOf: file, options: .mappedIfSafe),
          let rows = chromiumSession(data) { return rows }
      }
      throw ImportFailure("No readable session. If the browser encrypts its tabs, use its export or bookmark those tabs first.")
    }
  }

  private static func firefoxSession(_ data: Data) throws -> [String: Any] {
    guard data.count > 12, data.prefix(8) == Data("mozLz40\0".utf8) else { throw ImportFailure("Unknown session format.") }
    let size = Int(data.withUnsafeBytes { $0.loadUnaligned(fromByteOffset: 8, as: UInt32.self).littleEndian })
    guard size > 0, size <= 64 * 1024 * 1024 else { throw ImportFailure("The session is too large to read.") }
    var decoded = Data(count: size)
    let written = decoded.withUnsafeMutableBytes { destination in
      data.withUnsafeBytes { bytes in
        compression_decode_buffer(destination.bindMemory(to: UInt8.self).baseAddress!, size,
          bytes.bindMemory(to: UInt8.self).baseAddress! + 12, data.count - 12, nil, COMPRESSION_LZ4_RAW)
      }
    }
    guard written == size, let object = try JSONSerialization.jsonObject(with: decoded) as? [String: Any] else {
      throw ImportFailure("The saved session could not be decoded.")
    }
    return object
  }

  private struct SessionTab {
    var window = 0
    var position = 0
    var current = 0
    var pinned = false
    var navigations = [Int: String]()
  }

  // Read the public Chromium SNSS session record layout. Encrypted sessions use
  // the source browser's export rather than sharing a key between applications.
  private static func chromiumSession(_ data: Data) -> [[String: Any]]? {
    data.withUnsafeBytes { bytes in
      func number<T: FixedWidthInteger>(_ type: T.Type, at offset: Int) -> Int {
        Int(clamping: bytes.loadUnaligned(fromByteOffset: offset, as: type).littleEndian)
      }
      guard bytes.count >= 8, number(UInt32.self, at: 0) == 0x53534e53 else { return nil }
      let version = number(UInt32.self, at: 4)
      guard version == 1 || version == 3 else { return nil }
      var tabs = [Int: SessionTab]()
      var closedWindows = Set<Int>()
      var complete = version == 1
      var offset = 8
      while offset + 3 <= bytes.count {
        let size = number(UInt16.self, at: offset)
        offset += 2
        guard size > 0, offset + size <= bytes.count else { break }
        let command = bytes[offset]
        let start = offset + 1
        offset += size
        if command == 255 && size == 1 { complete = true }
        guard size >= 5 else { continue }
        let first = number(Int32.self, at: start)
        switch command {
        case 0 where size >= 9:
          tabs[number(Int32.self, at: start + 4), default: SessionTab()].window = first
        case 2 where size >= 9:
          tabs[first, default: SessionTab()].position = number(Int32.self, at: start + 4)
        case 6 where size >= 17:
          let tab = number(Int32.self, at: start + 4)
          let index = number(Int32.self, at: start + 8)
          let length = number(Int32.self, at: start + 12)
          guard length > 0, length <= min(4096, size - 17) else { continue }
          let url = String(decoding: bytes[(start + 16)..<(start + 16 + length)], as: UTF8.self)
          tabs[tab, default: SessionTab()].navigations[index] = url
        case 7 where size >= 9: tabs[first, default: SessionTab()].current = number(Int32.self, at: start + 4)
        case 12 where size >= 6: tabs[first, default: SessionTab()].pinned = bytes[start + 4] != 0
        case 16: tabs[first] = nil
        case 17: closedWindows.insert(first)
        default: break
        }
      }
      guard complete else { return nil }
      return tabs.values.filter { !closedWindows.contains($0.window) }.sorted { ($0.window, $0.position) < ($1.window, $1.position) }.compactMap { tab in
        let fallback = tab.navigations.keys.sorted().last.flatMap { tab.navigations[$0] }
        return webURL(tab.navigations[tab.current] ?? fallback).map { ["url": $0, "pinned": tab.pinned] }
      }
    }
  }
}
