import AppKit
import ExpoModulesCore

public final class MerlinEngineModule: Module {
  // Confined to the main queue. It outlives the module until queued cleanup runs.
  private let observation = EngineObservation()

  public func definition() -> ModuleDefinition {
    Name("MerlinEngine")
    Events("browserEvent")
    AsyncFunction("call") { (window: String, method: String, arguments: String) -> String in
      MerlinEngineBridge.callWindow(window, method: method, arguments: arguments)
    }.runOnQueue(.main)
    OnStartObserving {
      let observation = self.observation
      DispatchQueue.main.async { [weak self, observation] in
        guard let self, !observation.destroyed, observation.token == 0 else { return }
        observation.token = MerlinEngineBridge.subscribe { [weak self] json in
          self?.sendEvent("browserEvent", ["json": json])
        }
      }
    }
    OnStopObserving { self.observation.stop() }
    OnDestroy { self.observation.stop(destroy: true) }
    View(MerlinPageView.self) {
      ViewName("Page")
      Prop("windowId") { (view, value: String) in view.windowID = value }
      Prop("tabId") { (view, value: String) in view.tabID = value }
      OnViewDidUpdateProps { view in view.bind() }
    }
  }
  deinit { observation.stop(destroy: true) }
}

private final class EngineObservation {
  var token: UInt64 = 0
  var destroyed = false
  func stop(destroy: Bool = false) {
    DispatchQueue.main.async { [self] in
      destroyed = destroyed || destroy
      MerlinEngineBridge.unsubscribe(token)
      token = 0
    }
  }
}

final class MerlinPageView: ExpoView {
  var windowID = ""
  var tabID = ""
  private var attached: (String, String)?
  private weak var page: NSView?
  func bind() {
    guard window != nil, !windowID.isEmpty, !tabID.isEmpty else { detach(); return }
    if let attached, attached.0 == windowID, attached.1 == tabID { return }
    detach()
    if let view = MerlinEngineBridge.attachWindow(windowID, tab: tabID, parent: self) {
      page = view
      attached = (windowID, tabID)
      view.frame = bounds
      view.autoresizingMask = [.width, .height]
    }
  }
  override func setFrameSize(_ size: NSSize) {
    super.setFrameSize(size)
    page?.frame = bounds
  }
  override func viewDidMoveToWindow() {
    super.viewDidMoveToWindow()
    bind()
  }
  private func detach() {
    if let attached {
      MerlinEngineBridge.detachWindow(attached.0, tab: attached.1, parent: self)
    }
    attached = nil
    page = nil
  }
  deinit { detach() }
}
