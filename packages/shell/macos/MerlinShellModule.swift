import AppKit
import ExpoModulesCore
import UniformTypeIdentifiers

// AppKit pieces the React shell draws with: symbols, vibrancy, shadowed
// surfaces, the window drag region, outside-press detection and native
// menus. It knows nothing about Chromium; browser state lives in MerlinEngine.
//
// Each view is the only view of its own module. On React Native's classic
// bridge, expo-modules-core 3.0 creates every view of a module from its first
// (default) definition, so a module with several views draws only one kind.
public final class MerlinShellModule: Module {
  public func definition() -> ModuleDefinition {
    Name("MerlinShell")

    // Shell-only preferences, such as opening new tabs as a pop-up. They are
    // the same for every profile, like the window layout AppKit remembers.
    AsyncFunction("preference") { (key: String) -> String? in
      UserDefaults.standard.string(forKey: "MerlinShell.\(key)")
    }
    AsyncFunction("setPreference") { (key: String, value: String?) in
      if let value { UserDefaults.standard.set(value, forKey: "MerlinShell.\(key)") }
      else { UserDefaults.standard.removeObject(forKey: "MerlinShell.\(key)") }
    }

    // Settings › General and Appearance: system state the shell reads and sets.
    Events("onPreferenceChanged", "onMenuCommand")
    OnCreate {
      MerlinMenus.shared.onCommand = { [weak self] id in self?.sendEvent("onMenuCommand", ["id": id]) }
      AppIcons.restore()
      QuitGuard.shared.onSuppressed = { [weak self] in
        self?.sendEvent("onPreferenceChanged", ["key": "warnBeforeQuitting", "value": nil])
      }
    }
    Function("isLiquidGlass") { LiquidGlass.available }
    AsyncFunction("fileIcon") { (ext: String, size: Double) -> String? in FileIcons.dataURL(ext: ext, size: size) }.runOnQueue(.main)
    AsyncFunction("isDefaultBrowser") { DefaultBrowser.isDefault }.runOnQueue(.main)
    AsyncFunction("makeDefaultBrowser") { (promise: Promise) in DefaultBrowser.make { promise.resolve($0) } }.runOnQueue(.main)
    AsyncFunction("loginItem") { LoginItem.status }.runOnQueue(.main)
    AsyncFunction("setLoginItem") { (on: Bool) -> String in
      try? LoginItem.set(on)
      return LoginItem.status
    }.runOnQueue(.main)
    AsyncFunction("setThinScrollBars") { (thin: Bool) in ThinScrollBars.set(thin) }.runOnQueue(.main)
    // The menu bar exists by the time a window's React root asks for this.
    AsyncFunction("installQuitGuard") { QuitGuard.shared.install() }.runOnQueue(.main)
    AsyncFunction("setBookmarksMenuHidden") { (hidden: Bool) in BookmarksMenu.setHidden(hidden) }.runOnQueue(.main)
    AsyncFunction("tidyMenuBar") { MenuTidy.install() }.runOnQueue(.main)
    AsyncFunction("appIcons") { (size: Double) in AppIcons.choices(size: size) }.runOnQueue(.main)
    AsyncFunction("appIcon") { AppIcons.current }
    // MERLIN_STARTUP_TRACE=<file>: the shell's own timing lines join the
    // host's startup trace, for benchmarks and probes. Off, they cost nothing.
    Function("traceEnabled") { ShellTrace.file != nil }
    Function("trace") { (line: String) in ShellTrace.write(line) }
    // Merlin's release version, stamped by scripts/package_mac.sh; nil for a local build.
    Function("releaseVersion") { Bundle.main.object(forInfoDictionaryKey: "MerlinVersion") as? String }
    // A save panel for a file Chromium then writes, such as exported bookmarks.
    AsyncFunction("chooseSaveFile") { (name: String, promise: Promise) in
      let panel = NSSavePanel()
      panel.nameFieldStringValue = name
      panel.canCreateDirectories = true
      if let ext = name.split(separator: ".").last, let type = UTType(filenameExtension: String(ext)) {
        panel.allowedContentTypes = [type]
      }
      panel.begin { response in promise.resolve(response == .OK ? panel.url?.path : nil) }
    }.runOnQueue(.main)
    AsyncFunction("copyText") { (text: String) in
      NSPasteboard.general.clearContents()
      NSPasteboard.general.setString(text, forType: .string)
    }.runOnQueue(.main)
    AsyncFunction("setAppIcon") { (id: String) in AppIcons.set(id) }.runOnQueue(.main)

    // A tick on a Force Touch trackpad: a dragged tab finding a new place, a
    // drop zone, a pin, the sidebar meeting its limit. Nothing elsewhere.
    Function("haptic") { (kind: String) in
      let pattern: NSHapticFeedbackManager.FeedbackPattern = kind == "level" ? .levelChange : kind == "generic" ? .generic : .alignment
      DispatchQueue.main.async { NSHapticFeedbackManager.defaultPerformer.perform(pattern, performanceTime: .now) }
    }
    // Whether a page icon is all one dark or one light colour, so the shell can
    // draw it as a template on a background where it would vanish.
    AsyncFunction("imageTone") { (url: String) -> String? in IconTone.tone(dataURL: url) }
    // The menu bar's View menu items for Merlin's own layout (see MerlinMenus).
    Function("setMenuState") { (state: [String: Bool]) in
      DispatchQueue.main.async { MerlinMenus.shared.state = state; MerlinMenus.shared.install() }
    }

    AsyncFunction("showMenu") { (items: [[String: Any]], promise: Promise) in
      let choice = MenuChoice()
      choice.menu(items).popUp(positioning: nil, at: NSEvent.mouseLocation, in: nil)
      // AppKit sends the chosen item's action after tracking ends.
      DispatchQueue.main.async { promise.resolve(choice.chosen) }
    }.runOnQueue(.main)
  }
}

public final class MerlinShellSymbolModule: Module {
  public func definition() -> ModuleDefinition {
    Name("MerlinShellSymbol")
    View(MerlinSymbolView.self) {
      Prop("name") { (view, value: String) in view.symbol = value }
      Prop("color") { (view, value: String) in view.tint = value }
      Prop("size") { (view, value: Double) in view.pointSize = value }
      Prop("weight") { (view, value: String) in view.weight = value }
    }
  }
}

public final class MerlinShellVisualEffectModule: Module {
  public func definition() -> ModuleDefinition {
    Name("MerlinShellVisualEffect")
    View(MerlinVisualEffect.self) {
      Prop("material") { (view, value: String) in view.setMaterial(value) }
      Prop("blending") { (view, value: String) in view.setBlending(value) }
      Prop("alwaysActive") { (view, value: Bool) in view.setActive(value) }
      Prop("emphasized") { (view, value: Bool) in view.setEmphasized(value) }
      Prop("effectRadius") { (view, value: Double) in view.radius = value }
    }
  }
}

public final class MerlinShellSurfaceModule: Module {
  public func definition() -> ModuleDefinition {
    Name("MerlinShellSurface")
    View(MerlinSurface.self) {
      // Prefixed so React Native's own view props never handle them.
      Prop("surfaceFill") { (view, value: String?) in view.plateFill = ShellColor.parse(value) }
      Prop("surfaceRadius") { (view, value: Double) in view.plateRadius = value }
      Prop("surfaceBorderColor") { (view, value: String?) in view.plateBorderColor = ShellColor.parse(value) }
      Prop("surfaceBorderWidth") { (view, value: Double) in view.plateBorderWidth = value }
      Prop("surfaceShadowColor") { (view, value: String?) in view.dropColor = ShellColor.parse(value) }
      Prop("surfaceShadowOpacity") { (view, value: Double) in view.dropOpacity = value }
      Prop("surfaceShadowRadius") { (view, value: Double) in view.dropRadius = value }
      Prop("surfaceShadowOffsetY") { (view, value: Double) in view.dropOffsetY = value }
    }
  }
}

public final class MerlinShellWindowDragRegionModule: Module {
  public func definition() -> ModuleDefinition {
    Name("MerlinShellWindowDragRegion")
    View(MerlinWindowDragRegion.self) {}
  }
}

public final class MerlinShellOutsidePressModule: Module {
  public func definition() -> ModuleDefinition {
    Name("MerlinShellOutsidePress")
    View(MerlinOutsidePress.self) {
      Events("onOutsidePress")
      Prop("closesOnEscape") { (view, value: Bool) in view.closesOnEscape = value }
    }
  }
}

public final class MerlinShellContextMenuAreaModule: Module {
  public func definition() -> ModuleDefinition {
    Name("MerlinShellContextMenuArea")
    View(MerlinContextMenuArea.self) {
      Events("onContextMenu")
    }
  }
}

public final class MerlinShellGradientModule: Module {
  public func definition() -> ModuleDefinition {
    Name("MerlinShellGradient")
    View(MerlinGradient.self) {
      Prop("gradientKind") { (view, value: String) in view.kind = value }
      Prop("gradientColors") { (view, value: [String]) in view.colors = value.compactMap { ShellColor.parse($0) } }
    }
  }
}

public final class MerlinShellWindowAppearanceModule: Module {
  public func definition() -> ModuleDefinition {
    Name("MerlinShellWindowAppearance")
    View(MerlinWindowAppearance.self) {
      Prop("appearanceMode") { (view, value: String) in view.mode = value }
    }
  }
}

public final class MerlinShellFadeModule: Module {
  public func definition() -> ModuleDefinition {
    Name("MerlinShellFade")
    View(MerlinFade.self) {
      Prop("fadeLength") { (view, value: Double) in view.length = value }
      Prop("fadeLeading") { (view, value: Double) in view.leading = value }
      Prop("flushScroll") { (view, value: Bool) in view.flushScroll = value }
    }
  }
}

public final class MerlinShellGlassModule: Module {
  public func definition() -> ModuleDefinition {
    Name("MerlinShellGlass")
    View(MerlinGlass.self) {
      Prop("glassRadius") { (view, value: Double) in view.radius = value }
      Prop("glassTint") { (view, value: String?) in view.tint = ShellColor.parse(value) }
      Prop("glassClear") { (view, value: Bool) in view.clear = value }
    }
  }
}

public final class MerlinShellPopoverBubbleModule: Module {
  public func definition() -> ModuleDefinition {
    Name("MerlinShellPopoverBubble")
    View(MerlinPopoverBubble.self) {
      Prop("bubbleRadius") { (view, value: Double) in view.cornerRadius = value }
      Prop("arrowEdge") { (view, value: String) in view.arrowEdge = MerlinPopoverBubble.Edge(rawValue: value) ?? .none }
      Prop("arrowX") { (view, value: Double) in view.arrowX = value }
      Prop("arrowWidth") { (view, value: Double) in view.arrowWidth = value }
      Prop("arrowHeight") { (view, value: Double) in view.arrowHeight = value }
      Prop("bubbleFill") { (view, value: String?) in view.fill = ShellColor.parse(value) }
      Prop("bubbleEdgeColor") { (view, value: String?) in view.edgeColor = ShellColor.parse(value) }
      Prop("bubbleEdgeWidth") { (view, value: Double) in view.edgeWidth = value }
      Prop("bubbleShadowColor") { (view, value: String?) in view.dropColor = ShellColor.parse(value) }
      Prop("bubbleShadowOpacity") { (view, value: Double) in view.dropOpacity = value }
      Prop("bubbleShadowRadius") { (view, value: Double) in view.dropRadius = value }
      Prop("bubbleShadowOffsetY") { (view, value: Double) in view.dropOffsetY = value }
      Prop("glass") { (view, value: Bool) in view.glass = value }
      Prop("glassFade") { (view, value: Double) in view.glassFade = value }
      Prop("glassTint") { (view, value: String?) in view.glassTint = ShellColor.parse(value) }
    }
  }
}

public final class MerlinShellWindowStateModule: Module {
  public func definition() -> ModuleDefinition {
    Name("MerlinShellWindowState")
    View(MerlinWindowState.self) {
      Events("onFullScreen", "onWindowState")
      Prop("windowButtons") { (view, value: Bool) in view.windowButtons = value }
      Prop("windowTitle") { (view, value: String?) in view.windowTitle = value }
    }
  }
}

public final class MerlinShellFileDragModule: Module {
  public func definition() -> ModuleDefinition {
    Name("MerlinShellFileDrag")
    View(MerlinFileDrag.self) {
      Prop("filePath") { (view, value: String) in view.path = value }
      Events("onDragEnd")
    }
  }
}

public final class MerlinShellProgressRingModule: Module {
  public func definition() -> ModuleDefinition {
    Name("MerlinShellProgressRing")
    View(MerlinProgressRing.self) {
      Prop("ringProgress") { (view, value: Double) in view.progress = value }
      Prop("ringColor") { (view, value: String?) in if let color = ShellColor.parse(value) { view.color = color } }
      Prop("ringTrackColor") { (view, value: String?) in if let color = ShellColor.parse(value) { view.trackColor = color } }
      Prop("ringWidth") { (view, value: Double) in view.lineWidth = value }
      Prop("ringReduceMotion") { (view, value: Bool) in view.reduceMotion = value }
    }
  }
}

/// Appends lines to $MERLIN_STARTUP_TRACE, as the host's startup trace does.
private enum ShellTrace {
  static let file: FileHandle? = {
    guard let path = ProcessInfo.processInfo.environment["MERLIN_STARTUP_TRACE"], !path.isEmpty else { return nil }
    if !FileManager.default.fileExists(atPath: path) { FileManager.default.createFile(atPath: path, contents: nil) }
    guard let handle = FileHandle(forWritingAtPath: path) else { return nil }
    handle.seekToEndOfFile()
    return handle
  }()
  private static let lock = NSLock()
  static func write(_ line: String) {
    guard let file, let data = (line + "\n").data(using: .utf8) else { return }
    lock.lock(); defer { lock.unlock() }
    file.seekToEndOfFile()
    file.write(data)
  }
}

public final class MerlinShellWelcomeFilmModule: Module {
  public func definition() -> ModuleDefinition {
    Name("MerlinShellWelcomeFilm")
    View(MerlinWelcomeFilm.self) {
      Prop("soundEnabled") { (view, value: Bool) in view.soundEnabled = value }
      Events("onFinished")
    }
  }
}
