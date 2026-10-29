// Copyright 2026 The modal_browser Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#ifndef CHROME_BROWSER_UI_MODAL_BROWSER_BROWSERCTL_SERVER_H_
#define CHROME_BROWSER_UI_MODAL_BROWSER_BROWSERCTL_SERVER_H_

#include <string>

#include "base/files/file_path.h"
#include "base/functional/callback.h"
#include "base/memory/weak_ptr.h"
#include "base/threading/sequence_bound.h"

namespace modal_browser {

// Command-line switch: the socket path to use instead of the default (tests,
// or several browsers side by side).
inline constexpr char kBrowserctlSocketSwitch[] = "modal-browser-socket";

// The `browserctl` endpoint: a Unix-domain socket, never a network port.
//
// Security model:
//  * The socket lives in a directory created with mode 0700 and owned by
//    this user, so other users cannot even reach it; peers whose user id
//    differs from ours are also refused by credential check.
//  * One JSON request line per connection, at most 64 KiB, answered with
//    one reply line; idle connections close after 30 seconds; at most 8 at
//    a time.
//  * Requests are parsed and validated in Rust (modal_browser_core::ipc).
//    What they may do is decided by the handler (ModalBrowserController),
//    which never exposes private windows.
//
// Socket I/O runs on the browser's IO thread; the handler runs on the UI
// thread.
class BrowserctlServer {
 public:
  // Handles one request line; must call `reply` exactly once.
  using Handler = base::RepeatingCallback<
      void(std::string line, base::OnceCallback<void(std::string)> reply)>;

  // Starts listening at `socket_path`. `on_ready` receives an empty string
  // once listening, or why it could not (another browser is listening).
  BrowserctlServer(base::FilePath socket_path,
                   Handler handler,
                   base::OnceCallback<void(std::string error)> on_ready);
  BrowserctlServer(const BrowserctlServer&) = delete;
  BrowserctlServer& operator=(const BrowserctlServer&) = delete;
  ~BrowserctlServer();

  const base::FilePath& socket_path() const { return socket_path_; }

  // --modal-browser-socket, else $MODAL_BROWSER_SOCKET, else
  // $TMPDIR/modal_browser/browserctl.sock. browserctl uses the same rule.
  static base::FilePath DefaultSocketPath();

 private:
  class Core;

  void OnPrepared(base::OnceCallback<void(std::string)> on_ready,
                  std::string error);

  const base::FilePath socket_path_;
  Handler handler_;
  base::SequenceBound<Core> core_;
  base::WeakPtrFactory<BrowserctlServer> weak_factory_{this};
};

}  // namespace modal_browser

#endif  // CHROME_BROWSER_UI_MODAL_BROWSER_BROWSERCTL_SERVER_H_
