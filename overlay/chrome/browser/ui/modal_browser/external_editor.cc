// Copyright 2026 The modal_browser Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#include "chrome/browser/ui/modal_browser/external_editor.h"

#include <unistd.h>

#include <optional>
#include <utility>

#include "base/environment.h"
#include "base/files/file.h"
#include "base/files/file_util.h"
#include "base/process/launch.h"
#include "base/process/process.h"
#include "base/strings/string_split.h"
#include "base/strings/string_util.h"
#include "base/task/sequenced_task_runner.h"
#include "base/task/thread_pool.h"
#include "components/modal_browser/ffi/src/lib.rs.h"

namespace modal_browser {

namespace {

constexpr size_t kMaxTextBytes = 1024 * 1024;

std::string StringOf(const ::rust::String& s) {
  return std::string(s.data(), s.size());
}

// Finds a bare program name on $PATH plus the usual tool directories.
std::optional<base::FilePath> Resolve(const std::string& program,
                                      const std::string& path_env) {
  if (program.find('/') != std::string::npos) {
    base::FilePath p(program);
    return base::PathExists(p) ? std::optional<base::FilePath>(p)
                               : std::nullopt;
  }
  std::vector<base::FilePath> dirs;
  for (const std::string& d : base::SplitString(
           path_env, ":", base::TRIM_WHITESPACE, base::SPLIT_WANT_NONEMPTY)) {
    dirs.emplace_back(d);
  }
  for (const base::FilePath& d : ExternalEditor::ExtraSearchDirs()) {
    dirs.push_back(d);
  }
  for (const base::FilePath& d : dirs) {
    base::FilePath candidate = d.Append(program);
    if (access(candidate.value().c_str(), X_OK) == 0 &&
        !base::DirectoryExists(candidate)) {
      return candidate;
    }
  }
  return std::nullopt;
}

}  // namespace

struct ExternalEditor::StartResult {
  std::string error;
  base::FilePath path;
  std::string program;
};

struct ExternalEditor::PollResult {
  bool changed = false;
  std::string text;
  bool exited = false;
};

// Owns the directory, the file and the process, on a background sequence.
class ExternalEditor::Worker {
 public:
  Worker() = default;
  Worker(const Worker&) = delete;
  Worker& operator=(const Worker&) = delete;

  ~Worker() {
    // Never kill the user's editor; only remove what we created.
    if (!keep_ && !dir_.empty()) {
      base::DeletePathRecursively(dir_);
    }
  }

  StartResult Start(const Options& options) {
    StartResult result;
    if (options.text.size() > kMaxTextBytes) {
      result.error = "The text is larger than 1 MiB";
      return result;
    }
    // mkdtemp: a new directory only this user can enter.
    if (!base::CreateNewTempDirectory("modal_browser_edit_", &dir_)) {
      result.error = "Could not create a temporary directory";
      return result;
    }
    base::SetPosixFilePermissions(dir_, 0700);
    std::string extension = options.extension;
    std::erase_if(extension, [](char c) { return !base::IsAsciiAlphaNumeric(c); });
    file_ = dir_.Append("edit." + (extension.empty() ? std::string("txt")
                                                      : extension.substr(0, 8)));
    {
      base::File f(file_, base::File::FLAG_CREATE | base::File::FLAG_WRITE);
      if (!f.IsValid()) {
        result.error = "Could not create the temporary file";
        return result;
      }
      // Restrict before writing anything.
      base::SetPosixFilePermissions(file_, 0600);
      if (!f.WriteAtCurrentPosAndCheck(base::as_byte_span(options.text))) {
        result.error = "Could not write the temporary file";
        return result;
      }
    }
    if (options.read_only) {
      base::SetPosixFilePermissions(file_, 0400);
    }
    base::File::Info info;
    if (base::GetFileInfo(file_, &info)) {
      last_modified_ = info.last_modified;
      last_size_ = info.size;
    }

    ::rust::Vec<::rust::String> argv_in;
    for (const std::string& a : options.argv) {
      argv_in.push_back(::rust::String::lossy(a));
    }
    ::rust::Vec<::rust::String> substituted = ffi::editor_argv(
        ::rust::Slice<const ::rust::String>(argv_in.data(), argv_in.size()),
        file_.value());
    std::vector<std::string> argv;
    for (const ::rust::String& a : substituted) {
      argv.push_back(StringOf(a));
    }
    if (argv.empty()) {
      result.error = "The editor command is empty";
      return result;
    }
    std::unique_ptr<base::Environment> env = base::Environment::Create();
    const std::string path_env = env->GetVar("PATH").value_or("/usr/bin:/bin");
    std::optional<base::FilePath> program = Resolve(argv[0], path_env);
    result.program = base::FilePath(argv[0]).BaseName().value();
    if (!program) {
      result.error = "Editor '" + argv[0] + "' was not found";
      return result;
    }
    argv[0] = program->value();

    base::LaunchOptions launch;
    // The editor is the user's program, not part of the browser: its own
    // process group, and macOS attributes its permissions to itself.
    launch.new_process_group = true;
#if BUILDFLAG(IS_MAC)
    launch.disclaim_responsibility = true;
#endif
    std::string augmented = path_env;
    for (const base::FilePath& d : ExtraSearchDirs()) {
      augmented += ":" + d.value();
    }
    launch.environment["PATH"] = augmented;
    launch.current_directory = dir_;
    process_ = base::LaunchProcess(argv, launch);
    if (!process_.IsValid()) {
      result.error = "Could not start " + result.program;
      return result;
    }
    result.path = file_;
    return result;
  }

  PollResult Poll() {
    PollResult result;
    base::File::Info info;
    if (!file_.empty() && base::GetFileInfo(file_, &info) &&
        (info.last_modified != last_modified_ || info.size != last_size_)) {
      last_modified_ = info.last_modified;
      last_size_ = info.size;
      std::string text;
      if (base::ReadFileToStringWithMaxSize(file_, &text, kMaxTextBytes) &&
          base::IsStringUTF8(text)) {
        // Editors add a final newline to files; fields did not have one.
        if (base::EndsWith(text, "\n") && !base::EndsWith(original_tail_, "\n")) {
          text.pop_back();
        }
        result.changed = true;
        result.text = std::move(text);
      }
    }
    // Report the exit once; the process is reaped and forgotten.
    if (process_.IsValid()) {
      int code = 0;
      if (process_.WaitForExitWithTimeout(base::TimeDelta(), &code)) {
        result.exited = true;
        process_ = base::Process();
      }
    }
    return result;
  }

  void SetOriginalTail(std::string tail) { original_tail_ = std::move(tail); }
  void Keep() { keep_ = true; }

 private:
  base::FilePath dir_;
  base::FilePath file_;
  base::Process process_;
  base::Time last_modified_;
  int64_t last_size_ = -1;
  std::string original_tail_;
  bool keep_ = false;
};

// static
std::vector<base::FilePath> ExternalEditor::ExtraSearchDirs() {
  const base::FilePath home = base::GetHomeDir();
  return {base::FilePath("/opt/homebrew/bin"), base::FilePath("/usr/local/bin"),
          home.Append(".local").Append("bin"), home.Append(".cargo").Append("bin"),
          home.Append("bin")};
}

ExternalEditor::ExternalEditor(Options options,
                               SavedCallback on_saved,
                               DoneCallback on_done)
    : worker_(base::ThreadPool::CreateSequencedTaskRunner(
          {base::MayBlock(), base::TaskPriority::USER_VISIBLE,
           base::TaskShutdownBehavior::BLOCK_SHUTDOWN})),
      on_saved_(std::move(on_saved)),
      on_done_(std::move(on_done)),
      started_(base::TimeTicks::Now()) {
  const std::string tail =
      options.text.empty() ? std::string() : options.text.substr(options.text.size() - 1);
  worker_.AsyncCall(&Worker::SetOriginalTail).WithArgs(tail);
  worker_.AsyncCall(&Worker::Start)
      .WithArgs(std::move(options))
      .Then(base::BindOnce(&ExternalEditor::OnStarted,
                           weak_factory_.GetWeakPtr()));
}

ExternalEditor::~ExternalEditor() = default;

void ExternalEditor::KeepFile() {
  worker_.AsyncCall(&Worker::Keep);
}

void ExternalEditor::OnStarted(StartResult result) {
  program_ = result.program;
  if (!result.error.empty()) {
    Finish(result.error);
    return;
  }
  path_ = result.path;
  poll_timer_.Start(FROM_HERE, kPollInterval,
                    base::BindRepeating(&ExternalEditor::Poll,
                                        base::Unretained(this)));
}

void ExternalEditor::Poll() {
  if (polling_) {
    return;  // the previous check is still running
  }
  if (base::TimeTicks::Now() - started_ > kMaxDuration) {
    Finish("Stopped watching the file after 4 hours");
    return;
  }
  polling_ = true;
  worker_.AsyncCall(&Worker::Poll).Then(
      base::BindOnce(&ExternalEditor::OnPolled, weak_factory_.GetWeakPtr()));
}

void ExternalEditor::OnPolled(PollResult result) {
  polling_ = false;
  // Callbacks are posted, not run here, so a handler may destroy this
  // session.
  if (result.changed && on_saved_) {
    base::SequencedTaskRunner::GetCurrentDefault()->PostTask(
        FROM_HERE, base::BindOnce(on_saved_, std::move(result.text)));
  }
  if (result.exited) {
    // A launcher that hands the file to an app already running (and exits
    // at once) is not the end of the edit: keep watching for saves until
    // the session is replaced or times out.
    if (base::TimeTicks::Now() - started_ < base::Seconds(3)) {
      return;
    }
    Finish(std::string());
  }
}

void ExternalEditor::Finish(std::string error) {
  poll_timer_.Stop();
  if (on_done_) {
    base::SequencedTaskRunner::GetCurrentDefault()->PostTask(
        FROM_HERE, base::BindOnce(std::move(on_done_), std::move(error)));
  }
}

}  // namespace modal_browser
