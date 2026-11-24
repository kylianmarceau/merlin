import AppKit
import WebKit

/// Video selection and presentation run in Merlin's script world. They act
/// on the original video element so WebKit keeps its playback session.
final class WebKitPictureInPicture: NSObject, WKScriptMessageHandler {
  private static let shared = WebKitPictureInPicture()
  private static let messageName = "merlinVideoMenu"
  private static let world = WKContentWorld.world(name: "MerlinPictureInPicture")

  static func install(on controller: WKUserContentController) {
    controller.add(shared, contentWorld: world, name: messageName)
    controller.addUserScript(WKUserScript(source: menuScript, injectionTime: .atDocumentStart,
                                          forMainFrameOnly: false, in: world))
  }

  // Use the WebKit presentation mode for a browser command, as WebKit's
  // native video menu does. The page's attribute is a hint for the standard
  // API; the video and its playback backend must still support PiP.
  private static let videoScript = """
    const pip = 'picture-in-picture';
    const isFloating = video => video.webkitPresentationMode === pip || document.pictureInPictureElement === video;
    const canFloat = video => video.webkitSupportsPresentationMode?.(pip) ||
      (document.pictureInPictureEnabled && !video.disablePictureInPicture && !!video.requestPictureInPicture);
    const enter = async video => {
      if (video.webkitSupportsPresentationMode?.(pip)) video.webkitSetPresentationMode(pip);
      else await video.requestPictureInPicture();
    };
    const exit = async video => {
      if (video.webkitPresentationMode === pip) video.webkitSetPresentationMode('inline');
      else if (document.pictureInPictureElement === video) await document.exitPictureInPicture();
    };
    """

  static let floatScript = videoScript + """

    const videos = [...document.querySelectorAll('video')];
    if (document.fullscreenElement || document.pictureInPictureElement ||
        videos.some(v => v.webkitPresentationMode && v.webkitPresentationMode !== 'inline')) return false;
    const watched = v => !v.paused && !v.ended && v.readyState >= 2 && !v.muted && v.volume > 0 && v.videoWidth > 0 && canFloat(v);
    const video = videos.filter(watched).sort((a, b) => b.clientWidth * b.clientHeight - a.clientWidth * a.clientHeight)[0];
    if (!video) return false;
    const changed = new Promise(resolve => {
      const done = result => {
        video.removeEventListener('webkitpresentationmodechanged', changedMode);
        video.removeEventListener('enterpictureinpicture', changedMode);
        clearTimeout(timer);
        resolve(result);
      };
      const changedMode = () => { if (isFloating(video)) done(true); };
      const timer = setTimeout(() => done(isFloating(video)), 1000);
      video.addEventListener('webkitpresentationmodechanged', changedMode);
      video.addEventListener('enterpictureinpicture', changedMode);
      enter(video).then(changedMode, () => done(false));
    });
    if (!await changed) return false;
    const owner = { video: new WeakRef(video), returning: false };
    globalThis.merlinFloated = owner;
    const clear = () => {
      if (isFloating(video) || owner.returning) return;
      if (globalThis.merlinFloated === owner) globalThis.merlinFloated = undefined;
      video.removeEventListener('webkitpresentationmodechanged', clear);
      video.removeEventListener('leavepictureinpicture', clear);
    };
    video.addEventListener('webkitpresentationmodechanged', clear);
    video.addEventListener('leavepictureinpicture', clear);
    return true;
    """

  static let returnScript = videoScript + """

    const owner = globalThis.merlinFloated;
    const video = owner?.video.deref();
    if (!video) return true;
    owner.returning = true;
    // AppKit can report the requested presentation mode before its transition
    // finishes. Keep the return request until the inline mode has settled.
    let inline = 0;
    for (let attempt = 0; attempt < 12 && inline < 3; attempt++) {
      if (isFloating(video)) {
        inline = 0;
        await exit(video).catch(() => {});
      } else {
        inline++;
      }
      await new Promise(resolve => setTimeout(resolve, 80));
    }
    owner.returning = false;
    if (isFloating(video)) return false;
    if (globalThis.merlinFloated === owner) globalThis.merlinFloated = undefined;
    return true;
    """

  static let floatingScript = videoScript + """

    const video = globalThis.merlinFloated?.video.deref();
    return !!video && isFloating(video);
    """

  // Custom controls can cover the video and cancel the page's context menu.
  // Catch a real secondary click over the visible video before those controls.
  private static let menuScript = """
    (() => {
      \(videoScript)
      window.addEventListener('contextmenu', event => {
        if (!event.isTrusted || (event.button !== 2 && !event.ctrlKey)) return;
        const direct = event.composedPath().find(node => node instanceof HTMLVideoElement);
        // Keep WebKit's full video menu for an ordinary video hit.
        if (direct && !direct.disablePictureInPicture) return;
        const { clientX: x, clientY: y } = event;
        const videos = [...document.querySelectorAll('video')].filter(video => {
          if (!isFloating(video) && (!video.videoWidth || !canFloat(video))) return false;
          const { left, top, right, bottom } = video.getBoundingClientRect();
          const style = getComputedStyle(video);
          return x >= left && x < right && y >= top && y < bottom &&
            style.visibility === 'visible' && style.opacity !== '0';
        });
        const video = videos.find(video => video === direct) ??
          videos.find(video => !video.paused && !video.ended) ?? videos[0];
        if (!video) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        const token = String(performance.timeOrigin + event.timeStamp);
        globalThis.merlinVideoMenu = { token, video: new WeakRef(video) };
        window.webkit.messageHandlers.\(messageName).postMessage({ token, floating: isFloating(video) });
      }, true);
    })();
    """

  private static let toggleScript = videoScript + """

    const target = globalThis.merlinVideoMenu;
    if (target?.token !== token) return;
    globalThis.merlinVideoMenu = undefined;
    const video = target.video.deref();
    if (!video?.isConnected) return;
    if (isFloating(video)) await exit(video);
    else if (canFloat(video)) await enter(video);
    """

  private struct Selection {
    let view: WKWebView
    let frame: WKFrameInfo
    let token: String
  }

  func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
    guard message.name == Self.messageName, let view = message.webView, view.window?.isVisible == true,
      !view.isHiddenOrHasHiddenAncestor, let body = message.body as? [String: Any],
      let token = body["token"] as? String, let floating = body["floating"] as? Bool else { return }
    let menu = NSMenu()
    let entry = NSMenuItem(title: floating ? "Exit Picture in Picture" : "Enter Picture in Picture",
                           action: #selector(toggle(_:)), keyEquivalent: "")
    entry.target = self
    entry.representedObject = Selection(view: view, frame: message.frameInfo, token: token)
    menu.addItem(entry)
    menu.popUp(positioning: nil, at: NSEvent.mouseLocation, in: nil)
  }

  @objc private func toggle(_ item: NSMenuItem) {
    guard let selection = item.representedObject as? Selection, selection.view.window != nil,
      !selection.view.isHiddenOrHasHiddenAncestor else { return }
    selection.view.callAsyncJavaScript(Self.toggleScript, arguments: ["token": selection.token],
                                       in: selection.frame, in: Self.world, completionHandler: nil)
  }

  static func evaluate(_ script: String, in view: WKWebView, completion: @escaping (Bool) -> Void) {
    view.callAsyncJavaScript(script, arguments: [:], in: nil, in: world) { result in
      if case .success(let value) = result { completion(value as? Bool ?? false) } else { completion(false) }
    }
  }
}
