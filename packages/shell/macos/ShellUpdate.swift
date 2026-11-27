import AppKit
import CryptoKit
import Security

enum ShellUpdate {
  private static let bundleID = "io.github.kylianmarceau.merlin"
  private static let downloads = "https://github.com/kylianmarceau/merlin/releases/download"
  private static let stagePrefix = ".merlin-update-"
  private static let files = FileManager.default

  private struct Failure: LocalizedError {
    let message: String
    init(_ message: String) { self.message = message }
    var errorDescription: String? { message }
  }

  // Compare the numeric fields and SemVer pre-release identifiers without
  // coercing identifiers into fixed-width integers.
  private struct Version: Comparable {
    let numbers: [String]
    let prerelease: [String]

    init?(_ text: String) {
      guard text.wholeMatch(of: #/[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?/#) != nil else { return nil }
      let parts = text.split(separator: "-", maxSplits: 1)
      numbers = parts[0].split(separator: ".").map(String.init)
      prerelease = parts.dropFirst().first?.split(separator: ".").map(String.init) ?? []
    }

    static func < (left: Self, right: Self) -> Bool {
      for (a, b) in zip(left.numbers, right.numbers) {
        let order = a.compare(b, options: .numeric)
        if order != .orderedSame { return order == .orderedAscending }
      }
      if left.prerelease.isEmpty { return false }
      if right.prerelease.isEmpty { return true }
      for (a, b) in zip(left.prerelease, right.prerelease) {
        let aNumeric = a.allSatisfy(\.isNumber)
        let bNumeric = b.allSatisfy(\.isNumber)
        if aNumeric != bNumeric { return aNumeric }
        let order = a.compare(b, options: aNumeric ? .numeric : .literal)
        if order != .orderedSame { return order == .orderedAscending }
      }
      return left.prerelease.count < right.prerelease.count
    }
  }

  static func canInstall() -> Bool {
    Bundle.main.bundleIdentifier == bundleID && (try? runningSignature()) != nil
  }

  static func install(tag: String, current: String) async throws {
    let version = tag.hasPrefix("v") ? String(tag.dropFirst()) : tag
    guard let next = Version(version), let previous = Version(current), previous < next,
          current == Bundle.main.object(forInfoDictionaryKey: "MerlinVersion") as? String else {
      throw Failure("This release is not newer than the installed version.")
    }
    guard let executable = Bundle.main.executableURL else {
      throw Failure("Merlin could not find its installer.")
    }
    let target = Bundle.main.bundleURL.resolvingSymlinksInPath()
    let stage = try await prepare(tag: tag, version: version, target: target)
    let installer = Process()
    installer.executableURL = executable
    installer.arguments = ["--merlin-install-update", String(getpid()), stage.path, current, version]
    // Chromium can cancel a quit while a page or download still needs attention.
    // The installer waits for the actual process exit, and gives up if it stays open.
    try await withCheckedThrowingContinuation { (completion: CheckedContinuation<Void, Error>) in
      installer.terminationHandler = { process in
        try? files.removeItem(at: stage)
        let message = process.terminationStatus == 2
          ? "Merlin stayed open. Finish or close anything blocking the quit, then try again."
          : "Merlin could not start the update installer. You can still open the release page."
        completion.resume(throwing: Failure(message))
      }
      do {
        try installer.run()
        DispatchQueue.main.async { NSApp.terminate(nil) }
      } catch {
        try? files.removeItem(at: stage)
        completion.resume(throwing: error)
      }
    }
  }

  private static func prepare(tag: String, version: String, target: URL) async throws -> URL {
    let signature = try runningSignature()
    let stage = target.deletingLastPathComponent().appendingPathComponent(stagePrefix + UUID().uuidString)
    do {
      try files.createDirectory(at: stage, withIntermediateDirectories: false, attributes: [.posixPermissions: 0o700])
    } catch {
      throw Failure("Merlin needs permission to update in this folder. You can install the release from the disk image.")
    }
    var prepared = false
    defer { if !prepared { try? files.removeItem(at: stage) } }

    let imageName = "Merlin-\(version)-arm64.dmg"
    let base = URL(string: "\(downloads)/\(tag)/")!
    let session = URLSession(configuration: .ephemeral, delegate: ReleaseDownload(), delegateQueue: nil)
    defer { session.finishTasksAndInvalidate() }
    let checksum = stage.appendingPathComponent("checksum")
    try await download(base.appendingPathComponent(imageName + ".sha256"), to: checksum, using: session)
    let expected = try checksumDigest(at: checksum, imageName: imageName)
    let image = stage.appendingPathComponent("update.dmg")
    try await download(base.appendingPathComponent(imageName), to: image, using: session)
    guard try sha256(image) == expected else {
      throw Failure("The download did not match the release checksum.")
    }

    let mount = stage.appendingPathComponent("image")
    try files.createDirectory(at: mount, withIntermediateDirectories: false)
    try run("/usr/bin/hdiutil", ["attach", image.path, "-readonly", "-nobrowse", "-noautoopen",
                                 "-mount", "required", "-mountpoint", mount.path],
            failure: "Merlin could not open the downloaded disk image.")
    // Always detach before deleting the temporary directory. Never remove an
    // attached volume recursively, even if the copy or validation failed.
    do {
      let source = mount.appendingPathComponent("Merlin.app")
      guard try source.resourceValues(forKeys: [.isDirectoryKey, .isSymbolicLinkKey]).isDirectory == true,
            source.resolvingSymlinksInPath() == source.standardizedFileURL else {
        throw Failure("The disk image does not contain Merlin.app.")
      }
      try run("/usr/bin/ditto", [source.path, stagedApp(in: stage).path],
              failure: "Merlin could not copy the update. Check that there is enough free space.")
      try verify(stagedApp(in: stage), against: signature, version: version)
    } catch {
      // If detach fails, leave the read-only mount intact for Disk Utility.
      if !detach(mount) { prepared = true }
      throw error
    }
    guard detach(mount) else {
      prepared = true
      throw Failure("Merlin could not eject the update disk image.")
    }
    try files.removeItem(at: image)
    prepared = true
    return stage
  }

  private final class ReleaseDownload: NSObject, URLSessionTaskDelegate {
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) {
      let hosts = ["github.com", "release-assets.githubusercontent.com", "objects.githubusercontent.com"]
      let allow = request.url?.scheme == "https" && hosts.contains(request.url?.host ?? "")
      completionHandler(allow ? request : nil)
    }
  }

  private static func download(_ url: URL, to destination: URL, using session: URLSession) async throws {
    var request = URLRequest(url: url, timeoutInterval: 60)
    request.setValue("Merlin", forHTTPHeaderField: "User-Agent")
    let (file, response) = try await session.download(for: request)
    defer { try? files.removeItem(at: file) }
    guard (response as? HTTPURLResponse)?.statusCode == 200 else {
      throw Failure("GitHub could not provide the update file. Try again or open the release page.")
    }
    try files.moveItem(at: file, to: destination)
  }

  static func checksumDigest(at url: URL, imageName: String) throws -> String {
    let file = try FileHandle(forReadingFrom: url)
    defer { try? file.close() }
    let bytes = try file.read(upToCount: 1024) ?? Data()
    let fields = String(data: bytes, encoding: .utf8)?.split(whereSeparator: \.isWhitespace) ?? []
    guard bytes.count < 1024, fields.count == 2, fields[1] == imageName,
          fields[0].wholeMatch(of: #/[0-9a-fA-F]{64}/#) != nil else {
      throw Failure("The release checksum file is invalid.")
    }
    return fields[0].lowercased()
  }

  static func sha256(_ url: URL) throws -> String {
    let file = try FileHandle(forReadingFrom: url)
    defer { try? file.close() }
    var hasher = SHA256()
    while let data = try file.read(upToCount: 1024 * 1024), !data.isEmpty {
      hasher.update(data: data)
    }
    return hasher.finalize().map { String(format: "%02x", $0) }.joined()
  }

  private struct Signature {
    let requirement: SecRequirement
    let certificate: Data
    let hash: Data
  }

  private static func runningSignature() throws -> Signature {
    var running: SecCode?
    var code: SecStaticCode?
    var requirement: SecRequirement?
    guard SecCodeCopySelf([], &running) == errSecSuccess, let running,
          SecCodeCopyStaticCode(running, [], &code) == errSecSuccess, let code,
          SecCodeCheckValidity(running, [], nil) == errSecSuccess,
          SecCodeCopyDesignatedRequirement(code, [], &requirement) == errSecSuccess, let requirement,
          let info = signingInfo(code), let certificate = leafCertificate(info),
          let hash = info[kSecCodeInfoUnique as String] as? Data else {
      throw Failure("This copy of Merlin needs a manual update from the release page.")
    }
    return Signature(requirement: requirement, certificate: certificate, hash: hash)
  }

  private static func signingInfo(_ code: SecStaticCode) -> [String: Any]? {
    var info: CFDictionary?
    guard SecCodeCopySigningInformation(code, SecCSFlags(rawValue: kSecCSSigningInformation), &info) == errSecSuccess else { return nil }
    return info as? [String: Any]
  }

  private static func leafCertificate(_ info: [String: Any]) -> Data? {
    guard let leaf = (info[kSecCodeInfoCertificates as String] as? [SecCertificate])?.first else { return nil }
    return SecCertificateCopyData(leaf) as Data
  }

  private static func staticCode(_ app: URL) -> SecStaticCode? {
    var code: SecStaticCode?
    guard SecStaticCodeCreateWithPath(app as CFURL, [], &code) == errSecSuccess else { return nil }
    return code
  }

  private static func verify(_ app: URL, against original: Signature, version: String) throws {
    let flags = SecCSFlags(rawValue: kSecCSStrictValidate | kSecCSCheckAllArchitectures | kSecCSCheckNestedCode)
    guard app.resolvingSymlinksInPath() == app.standardizedFileURL, let code = staticCode(app),
          SecStaticCodeCheckValidity(code, flags, original.requirement) == errSecSuccess,
          let info = signingInfo(code), leafCertificate(info) == original.certificate,
          let plist = info[kSecCodeInfoPList as String] as? [String: Any],
          plist["CFBundleIdentifier"] as? String == bundleID,
          plist["MerlinVersion"] as? String == version else {
      throw Failure("The download does not match Merlin’s release signature and version.")
    }
  }

  private static func stagedApp(in stage: URL) -> URL {
    stage.appendingPathComponent("Merlin.app")
  }

  private static func run(_ path: String, _ arguments: [String], failure: String) throws {
    let process = Process()
    process.executableURL = URL(fileURLWithPath: path)
    process.arguments = arguments
    process.standardInput = FileHandle.nullDevice
    try process.run()
    process.waitUntilExit()
    guard process.terminationStatus == 0 else { throw Failure(failure) }
  }

  private static func detach(_ mount: URL) -> Bool {
    (try? run("/usr/bin/hdiutil", ["detach", mount.path, "-force"], failure: "Could not eject the update image.")) != nil
  }

  private static func waitForExit(_ pid: pid_t) -> Bool {
    let queue = kqueue()
    guard queue >= 0 else { return false }
    defer { close(queue) }
    var watch = kevent(ident: UInt(pid), filter: Int16(EVFILT_PROC), flags: UInt16(EV_ADD | EV_ONESHOT),
                       fflags: UInt32(NOTE_EXIT), data: 0, udata: nil)
    // Register separately so ESRCH means the original process already exited.
    if kevent(queue, &watch, 1, nil, 0, nil) < 0 { return errno == ESRCH }
    var event = kevent()
    var timeout = timespec(tv_sec: 90, tv_nsec: 0)
    return kevent(queue, nil, 0, &event, 1, &timeout) == 1 && event.fflags & UInt32(NOTE_EXIT) != 0
  }

  private static func swap(_ left: URL, _ right: URL) throws {
    guard renamex_np(left.path, right.path, UInt32(RENAME_SWAP)) == 0 else {
      throw Failure("macOS could not replace Merlin.app. Check App Management in Privacy & Security or install the update from the disk image.")
    }
  }

  // This runs in a separate invocation of the current, signed host executable.
  // It enters before loading Chromium and only replaces the bundle after quit.
  static func finish(pid: pid_t, stagePath: String, current: String, version: String) -> Int32 {
    let target = Bundle.main.bundleURL.resolvingSymlinksInPath()
    let stage = URL(fileURLWithPath: stagePath, isDirectory: true).standardizedFileURL
    let name = stage.lastPathComponent
    guard pid > 1, pid == getppid() || getppid() == 1,
          stage.deletingLastPathComponent().path == target.deletingLastPathComponent().path,
          name.hasPrefix(stagePrefix), UUID(uuidString: String(name.dropFirst(stagePrefix.count))) != nil,
          stage.resolvingSymlinksInPath() == stage else { return 1 }
    guard waitForExit(pid) else { return 2 }
    let replacement = stagedApp(in: stage)
    var keepBackup = false
    defer { if !keepBackup { try? files.removeItem(at: stage) } }
    let relaunchFailure = "macOS could not reopen Merlin. Open Merlin from Applications."
    do {
      let signature = try runningSignature()
      guard let installed = staticCode(target), signingInfo(installed)?[kSecCodeInfoUnique as String] as? Data == signature.hash,
            let before = Version(current), let after = Version(version), before < after,
            Bundle.main.object(forInfoDictionaryKey: "MerlinVersion") as? String == current else {
        throw Failure("The installed app changed before Merlin could update it.")
      }
      try verify(replacement, against: signature, version: version)
      try swap(target, replacement)
      do {
        try run("/usr/bin/open", [target.path], failure: relaunchFailure)
      } catch {
        keepBackup = true
        try swap(target, replacement)
        keepBackup = false
        throw error
      }
      return 0
    } catch {
      let alert = NSAlert()
      alert.messageText = "Merlin Update Couldn’t Finish"
      alert.informativeText = keepBackup
        ? "The previous copy is still at \(replacement.path)."
        : error.localizedDescription
      NSApplication.shared.activate(ignoringOtherApps: true)
      alert.runModal()
      if !keepBackup { try? run("/usr/bin/open", [target.path], failure: relaunchFailure) }
      return 1
    }
  }
}

@_cdecl("MerlinRunUpdateInstaller")
public func merlinRunUpdateInstaller(_ pid: Int32, _ stage: UnsafePointer<CChar>,
                                     _ current: UnsafePointer<CChar>, _ version: UnsafePointer<CChar>) -> Int32 {
  ShellUpdate.finish(pid: pid, stagePath: String(cString: stage), current: String(cString: current), version: String(cString: version))
}
