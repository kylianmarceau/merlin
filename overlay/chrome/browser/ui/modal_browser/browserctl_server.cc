// Copyright 2026 The modal_browser Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#include "chrome/browser/ui/modal_browser/browserctl_server.h"

#include <sys/socket.h>
#include <sys/stat.h>
#include <sys/un.h>
#include <unistd.h>

#include <map>
#include <memory>
#include <optional>
#include <utility>

#include "base/command_line.h"
#include "base/containers/span.h"
#include "base/environment.h"
#include "base/files/file_util.h"
#include "base/files/scoped_file.h"
#include "base/functional/bind.h"
#include "base/task/bind_post_task.h"
#include "base/task/sequenced_task_runner.h"
#include "base/task/thread_pool.h"
#include "base/timer/timer.h"
#include "components/modal_browser/ffi/src/lib.rs.h"
#include "content/public/browser/browser_task_traits.h"
#include "content/public/browser/browser_thread.h"
#include "net/base/io_buffer.h"
#include "net/base/net_errors.h"
#include "net/socket/stream_socket.h"
#include "net/socket/unix_domain_server_socket_posix.h"
#include "net/traffic_annotation/network_traffic_annotation.h"

namespace modal_browser {

namespace {

constexpr size_t kMaxRequestBytes = 64 * 1024;
constexpr size_t kMaxConnections = 8;
constexpr int kReadChunk = 4096;
constexpr base::TimeDelta kIdleTimeout = base::Seconds(30);

constexpr net::NetworkTrafficAnnotationTag kTrafficAnnotation =
    net::DefineNetworkTrafficAnnotation("modal_browser_browserctl", R"(
        semantics {
          sender: "browserctl"
          description:
            "Replies to browserctl, a command-line tool run by the same user "
            "on this computer, over a local Unix-domain socket."
          trigger: "The user runs browserctl."
          data: "Tab titles and URLs, or the result of a command."
          destination: LOCAL
        }
        policy {
          cookies_allowed: NO
          setting: "Settings > General > Allow browserctl, or "
                   "browserctl = false in config.toml."
          policy_exception_justification: "Local socket, not network traffic."
        })");

// Readies the socket's directory and removes a stale socket. Blocking.
std::string PrepareSocketPath(const base::FilePath& path) {
  if (path.value().size() >= sizeof(sockaddr_un::sun_path)) {
    return "socket path is too long: " + path.value();
  }
  const base::FilePath dir = path.DirName();
  if (!base::CreateDirectory(dir)) {
    return "could not create " + dir.value();
  }
  struct stat st;
  if (lstat(dir.value().c_str(), &st) != 0 || !S_ISDIR(st.st_mode) ||
      st.st_uid != geteuid()) {
    return dir.value() + " is not a directory owned by this user";
  }
  if (chmod(dir.value().c_str(), 0700) != 0) {
    return "could not restrict " + dir.value();
  }
  if (lstat(path.value().c_str(), &st) != 0) {
    return std::string();  // nothing there
  }
  if (!S_ISSOCK(st.st_mode)) {
    return path.value() + " exists and is not a socket";
  }
  // Another browser listening? Then leave it alone.
  base::ScopedFD fd(socket(AF_UNIX, SOCK_STREAM, 0));
  sockaddr_un addr = {};
  addr.sun_family = AF_UNIX;
  // Length checked above, so this always leaves the terminating zero.
  base::span(addr.sun_path).copy_prefix_from(base::span(path.value()));
  if (fd.is_valid() &&
      connect(fd.get(), reinterpret_cast<sockaddr*>(&addr), sizeof(addr)) == 0) {
    return "another browser is already listening at " + path.value();
  }
  return unlink(path.value().c_str()) == 0
             ? std::string()
             : "could not remove the stale socket " + path.value();
}

}  // namespace

// Lives on the IO thread.
class BrowserctlServer::Core {
 public:
  Core(scoped_refptr<base::SequencedTaskRunner> ui, Handler handler)
      : ui_(std::move(ui)), handler_(std::move(handler)) {}
  Core(const Core&) = delete;
  Core& operator=(const Core&) = delete;
  ~Core() = default;

  std::string Listen(const base::FilePath& path) {
    server_ = std::make_unique<net::UnixDomainServerSocket>(
        base::BindRepeating([](const net::UnixDomainServerSocket::Credentials&
                                   peer) { return peer.user_id == geteuid(); }),
        /*use_abstract_namespace=*/false);
    const int rv = server_->BindAndListen(path.value(), /*backlog=*/4);
    if (rv != net::OK) {
      server_.reset();
      return "could not listen at " + path.value() + ": " +
             net::ErrorToString(rv);
    }
    DoAccept();
    return std::string();
  }

 private:
  struct Connection {
    std::unique_ptr<net::StreamSocket> socket;
    scoped_refptr<net::IOBufferWithSize> read_buffer;
    std::string pending;
    scoped_refptr<net::DrainableIOBuffer> write_buffer;
    base::OneShotTimer idle;
    bool replied = false;
  };

  void DoAccept() {
    while (server_) {
      const int rv = server_->Accept(
          &accepted_,
          base::BindOnce(&Core::OnAccepted, weak_factory_.GetWeakPtr()));
      if (rv == net::ERR_IO_PENDING) {
        return;
      }
      HandleAccepted(rv);
    }
  }

  void OnAccepted(int rv) {
    HandleAccepted(rv);
    DoAccept();
  }

  void HandleAccepted(int rv) {
    if (rv != net::OK || !accepted_) {
      accepted_.reset();
      return;
    }
    if (connections_.size() >= kMaxConnections) {
      accepted_.reset();  // closes it
      return;
    }
    const int id = next_id_++;
    auto conn = std::make_unique<Connection>();
    conn->socket = std::move(accepted_);
    conn->read_buffer = base::MakeRefCounted<net::IOBufferWithSize>(kReadChunk);
    conn->idle.Start(FROM_HERE, kIdleTimeout,
                     base::BindOnce(&Core::Close, base::Unretained(this), id));
    connections_[id] = std::move(conn);
    Read(id);
  }

  Connection* Get(int id) {
    auto it = connections_.find(id);
    return it == connections_.end() ? nullptr : it->second.get();
  }

  void Close(int id) { connections_.erase(id); }

  void Read(int id) {
    Connection* c = Get(id);
    while (c && !c->replied) {
      const int rv = c->socket->Read(
          c->read_buffer.get(), kReadChunk,
          base::BindOnce(&Core::OnRead, weak_factory_.GetWeakPtr(), id));
      if (rv == net::ERR_IO_PENDING) {
        return;
      }
      if (!Consume(id, rv)) {
        return;
      }
      c = Get(id);
    }
  }

  void OnRead(int id, int rv) {
    if (Consume(id, rv)) {
      Read(id);
    }
  }

  // Returns whether to keep reading.
  bool Consume(int id, int rv) {
    Connection* c = Get(id);
    if (!c) {
      return false;
    }
    if (rv <= 0) {
      Close(id);  // peer closed or error
      return false;
    }
    c->pending.append(c->read_buffer->data(), rv);
    const size_t newline = c->pending.find('\n');
    if (newline == std::string::npos) {
      if (c->pending.size() > kMaxRequestBytes) {
        Reply(id, std::string(ffi::ipc_reply_error(-1, "request too long")));
        return false;
      }
      return true;
    }
    std::string line = c->pending.substr(0, newline);
    c->replied = true;
    // To the UI thread; the reply comes back here.
    auto reply = base::BindPostTask(
        base::SequencedTaskRunner::GetCurrentDefault(),
        base::BindOnce(&Core::Reply, weak_factory_.GetWeakPtr(), id));
    ui_->PostTask(FROM_HERE,
                  base::BindOnce(handler_, std::move(line), std::move(reply)));
    return false;
  }

  void Reply(int id, std::string reply) {
    Connection* c = Get(id);
    if (!c) {
      return;
    }
    c->replied = true;
    reply.push_back('\n');
    const size_t size = reply.size();
    c->write_buffer = base::MakeRefCounted<net::DrainableIOBuffer>(
        base::MakeRefCounted<net::StringIOBuffer>(std::move(reply)), size);
    Write(id);
  }

  void Write(int id) {
    Connection* c = Get(id);
    while (c && c->write_buffer->BytesRemaining() > 0) {
      const int rv = c->socket->Write(
          c->write_buffer.get(), c->write_buffer->BytesRemaining(),
          base::BindOnce(&Core::OnWritten, weak_factory_.GetWeakPtr(), id),
          kTrafficAnnotation);
      if (rv == net::ERR_IO_PENDING) {
        return;
      }
      if (rv <= 0) {
        Close(id);
        return;
      }
      c->write_buffer->DidConsume(rv);
    }
    if (c) {
      Close(id);  // one request per connection
    }
  }

  void OnWritten(int id, int rv) {
    Connection* c = Get(id);
    if (!c) {
      return;
    }
    if (rv <= 0) {
      Close(id);
      return;
    }
    c->write_buffer->DidConsume(rv);
    Write(id);
  }

  const scoped_refptr<base::SequencedTaskRunner> ui_;
  const Handler handler_;
  std::unique_ptr<net::UnixDomainServerSocket> server_;
  std::unique_ptr<net::StreamSocket> accepted_;
  std::map<int, std::unique_ptr<Connection>> connections_;
  int next_id_ = 1;
  base::WeakPtrFactory<Core> weak_factory_{this};
};

BrowserctlServer::BrowserctlServer(
    base::FilePath socket_path,
    Handler handler,
    base::OnceCallback<void(std::string error)> on_ready)
    : socket_path_(std::move(socket_path)),
      handler_(std::move(handler)),
      core_(content::GetIOThreadTaskRunner({}),
            base::SequencedTaskRunner::GetCurrentDefault(),
            handler_) {
  base::ThreadPool::PostTaskAndReplyWithResult(
      FROM_HERE,
      {base::MayBlock(), base::TaskPriority::USER_VISIBLE,
       base::TaskShutdownBehavior::SKIP_ON_SHUTDOWN},
      base::BindOnce(&PrepareSocketPath, socket_path_),
      base::BindOnce(&BrowserctlServer::OnPrepared, weak_factory_.GetWeakPtr(),
                     std::move(on_ready)));
}

BrowserctlServer::~BrowserctlServer() = default;

void BrowserctlServer::OnPrepared(base::OnceCallback<void(std::string)> on_ready,
                                  std::string error) {
  if (!error.empty()) {
    std::move(on_ready).Run(std::move(error));
    return;
  }
  core_.AsyncCall(&Core::Listen)
      .WithArgs(socket_path_)
      .Then(std::move(on_ready));
}

// static
base::FilePath BrowserctlServer::DefaultSocketPath() {
  const base::CommandLine* command_line = base::CommandLine::ForCurrentProcess();
  if (command_line->HasSwitch(kBrowserctlSocketSwitch)) {
    return command_line->GetSwitchValuePath(kBrowserctlSocketSwitch);
  }
  std::unique_ptr<base::Environment> env = base::Environment::Create();
  if (std::optional<std::string> path = env->GetVar("MODAL_BROWSER_SOCKET");
      path && !path->empty()) {
    return base::FilePath(*path);
  }
  base::FilePath tmp;
  if (std::optional<std::string> dir = env->GetVar("TMPDIR"); dir && !dir->empty()) {
    tmp = base::FilePath(*dir);
  } else {
    tmp = base::FilePath("/tmp");
  }
  return tmp.Append("modal_browser").Append("browserctl.sock");
}

}  // namespace modal_browser
