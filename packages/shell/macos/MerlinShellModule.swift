import AppKit
import ExpoModulesCore

// AppKit pieces the React shell draws with: symbols, vibrancy, shadowed
// surfaces, the window drag region, outside-press detection and native
// menus. It knows nothing about Chromium; browser state lives in MerlinEngine.
public final class MerlinShellModule: Module {
  public func definition() -> ModuleDefinition {
    Name("MerlinShell")

    AsyncFunction("showMenu") { (items: [[String: Any]], promise: Promise) in
      let choice = MenuChoice()
      choice.menu(items).popUp(positioning: nil, at: NSEvent.mouseLocation, in: nil)
      // AppKit sends the chosen item's action after tracking ends.
      DispatchQueue.main.async { promise.resolve(choice.chosen) }
    }.runOnQueue(.main)

    View(MerlinSymbolView.self) {
      ViewName("Symbol")
      Prop("name") { (view, value: String) in view.symbol = value }
      Prop("color") { (view, value: String) in view.tint = value }
      Prop("size") { (view, value: Double) in view.pointSize = value }
      Prop("weight") { (view, value: String) in view.weight = value }
    }
    View(MerlinVisualEffect.self) {
      ViewName("VisualEffect")
      Prop("material") { (view, value: String) in view.setMaterial(value) }
      Prop("blending") { (view, value: String) in view.setBlending(value) }
      Prop("alwaysActive") { (view, value: Bool) in view.setActive(value) }
      Prop("emphasized") { (view, value: Bool) in view.setEmphasized(value) }
      Prop("effectRadius") { (view, value: Double) in view.radius = value }
    }
    View(MerlinSurface.self) {
      ViewName("Surface")
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
    View(MerlinWindowDragRegion.self) {
      ViewName("WindowDragRegion")
    }
    View(MerlinOutsidePress.self) {
      ViewName("OutsidePress")
      Events("onOutsidePress")
    }
    View(MerlinContextMenuArea.self) {
      ViewName("ContextMenuArea")
      Events("onContextMenu")
    }
  }
}
