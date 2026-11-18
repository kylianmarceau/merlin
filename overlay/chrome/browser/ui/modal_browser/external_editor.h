// Copyright 2026 The modal_browser Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#ifndef CHROME_BROWSER_UI_MODAL_BROWSER_EXTERNAL_EDITOR_H_
#define CHROME_BROWSER_UI_MODAL_BROWSER_EXTERNAL_EDITOR_H_

#include <memory>
#include <string>
#include <vector>

#include "base/files/file_path.h"
#include "base/functional/callback.h"
#include "base/memory/weak_ptr.h"
#include "base/threading/sequence_bound.h"
#include "base/time/time.h"
#include "base/timer/timer.h"

namespace modal_browser {

// One external editing session: a private temporary file, the editor
// process, and a watch that reports each save until the editor exits.
//
// * The file sits in a fresh directory created with mode 0700, and the file
//   itself is 0600 (0400 for read-only exports). Nothing else is written.
// * The editor starts from an argv list with no shell, so no text from the
//   page or the config is ever interpreted as a command.
// * Saves are reported as they happen, so editors that hand the file to an
//   already-running app (and return at once) still work. A save is read
//   only once two checks in a row find the same size and modification
//   time, so a file still being written never reaches the page.
// * An editor that fails at once (exits non-zero within a few seconds)
//   ends the session with an error rather than a long watch.
// * Destroying the session stops watching and deletes the file, unless
//   KeepFile() was called (the page went away and the text would be lost).
//
// All file and process work runs on a background sequence; callbacks are
// posted to the sequence that created the session, so they may destroy it.
class ExternalEditor {
 public:
  struct Options {
    // From the core, with "{file}" where the path goes.
    std::vector<std::string> argv;
    std::string text;
    // File extension without the dot ("md", "txt").
    std::string extension = "txt";
    // Exports are read-only: nothing is written back.
    bool read_only = false;
  };
  // Saved text, at most 1 MiB, valid UTF-8.
  using SavedCallback = base::RepeatingCallback<void(std::string text)>;
  // Called once: when the editor exits (`error` empty), could not start, or
  // the session timed out.
  using DoneCallback = base::OnceCallback<void(std::string error)>;

  ExternalEditor(Options options, SavedCallback on_saved, DoneCallback on_done);
  ExternalEditor(const ExternalEditor&) = delete;
  ExternalEditor& operator=(const ExternalEditor&) = delete;
  ~ExternalEditor();

  // Leaves the file in place when the session ends.
  void KeepFile();
  // Empty until the file exists.
  const base::FilePath& path() const { return path_; }
  // The program that was started, for messages ("nvim").
  const std::string& program() const { return program_; }

  // How often the file is checked, and how long a session may last.
  static constexpr base::TimeDelta kPollInterval = base::Milliseconds(400);
  static constexpr base::TimeDelta kMaxDuration = base::Hours(4);
  // An editor that exits sooner may have handed the file to an app that is
  // already running; one that exits sooner with an error failed.
  static constexpr base::TimeDelta kLauncherGrace = base::Seconds(3);

  // Directory searched (with $PATH) for a bare program name: GUI apps get a
  // minimal $PATH, so Homebrew and user tools would not be found otherwise.
  static std::vector<base::FilePath> ExtraSearchDirs();

 private:
  class Worker;
  struct StartResult;
  struct PollResult;

  void OnStarted(StartResult result);
  void Poll();
  void OnPolled(PollResult result);
  void Finish(std::string error);

  base::SequenceBound<Worker> worker_;
  SavedCallback on_saved_;
  DoneCallback on_done_;
  base::FilePath path_;
  std::string program_;
  base::RepeatingTimer poll_timer_;
  base::TimeTicks started_;
  bool polling_ = false;
  base::WeakPtrFactory<ExternalEditor> weak_factory_{this};
};

}  // namespace modal_browser

#endif  // CHROME_BROWSER_UI_MODAL_BROWSER_EXTERNAL_EDITOR_H_
