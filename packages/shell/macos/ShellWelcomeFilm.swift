import AppKit
import AVFoundation
import ExpoModulesCore

/// The bundled opening plays in the browser window without creating a web tab.
final class MerlinWelcomeFilm: ExpoView {
  let onFinished = EventDispatcher()
  private let picture = AVPlayerLayer()
  private var player: AVPlayer?
  private var observations: [NSObjectProtocol] = []
  private var deadline: DispatchWorkItem?
  private var finished = false

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    wantsLayer = true
    picture.videoGravity = .resizeAspectFill
    layer?.masksToBounds = true
    layer?.addSublayer(picture)
  }

  override func hitTest(_ point: NSPoint) -> NSView? { nil }

  override func layout() {
    super.layout()
    CATransaction.begin()
    CATransaction.setDisableActions(true)
    picture.frame = bounds
    CATransaction.commit()
  }

  override func viewDidMoveToWindow() {
    super.viewDidMoveToWindow()
    guard window != nil else { stop(); return }
    guard player == nil, !finished else { return }
    guard let url = Bundle.main.url(forResource: "MerlinFirstLight", withExtension: "mp4") else {
      DispatchQueue.main.async { [weak self] in self?.finish() }
      return
    }
    let item = AVPlayerItem(url: url)
    let movie = AVPlayer(playerItem: item)
    movie.isMuted = true
    movie.actionAtItemEnd = .pause
    player = movie
    picture.player = movie
    observations = [AVPlayerItem.didPlayToEndTimeNotification, AVPlayerItem.failedToPlayToEndTimeNotification].map { name in
      NotificationCenter.default.addObserver(forName: name, object: item, queue: .main) { [weak self] _ in self?.finish() }
    }
    // A decoder that stalls must still let a new profile reach setup.
    let timeout = DispatchWorkItem { [weak self] in self?.finish() }
    deadline = timeout
    DispatchQueue.main.asyncAfter(deadline: .now() + 9, execute: timeout)
    movie.play()
  }

  private func finish() {
    guard window != nil, !finished else { return }
    finished = true
    deadline?.cancel()
    onFinished([:])
  }

  private func stop() {
    deadline?.cancel()
    for token in observations { NotificationCenter.default.removeObserver(token) }
    observations.removeAll()
    player?.pause()
    picture.player = nil
    player = nil
  }

  deinit { stop() }
}
