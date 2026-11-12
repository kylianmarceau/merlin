import AppKit
import ExpoModulesCore

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
