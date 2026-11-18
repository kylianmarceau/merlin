// Copyright 2026 The modal_browser Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#ifndef CHROME_BROWSER_UI_MODAL_BROWSER_CONFIG_FILE_H_
#define CHROME_BROWSER_UI_MODAL_BROWSER_CONFIG_FILE_H_

#include <string>
#include <string_view>

#include "base/files/file_path.h"
#include "base/functional/callback.h"

// Locating, reading and changing the user configuration file. Parsing and
// validation happen in Rust (modal_browser_core::config); this file only
// does I/O, off the UI thread.
//
// Every read and write runs in order on one sequence, and a change is one
// task there: read, change, write. Two windows changing different options
// at once therefore both land, rather than each writing its own copy of the
// file read before the other's write.
namespace modal_browser::config_file {

// Largest file read; matches the Rust parser's bound.
inline constexpr size_t kMaxConfigBytes = 256 * 1024;

// $XDG_CONFIG_HOME/modal_browser/config.toml, else
// ~/.config/modal_browser/config.toml (the convention terminal tools such as
// Ghostty and Neovim use on macOS too).
base::FilePath ConfigPath();

// Tests point this at a temporary file (or a path that does not exist) so a
// developer's own config never affects them. Call it before the test reads
// or writes the file.
void SetConfigPathForTesting(const base::FilePath& path);

struct ReadResult {
  bool found = false;
  std::string text;
  // Set when the file exists but could not be read (too large, not UTF-8,
  // permissions).
  std::string error;
  // Which version of the file this is (see Revision).
  std::string revision;
};

// A digest of the file's contents, or "none" when there is no file. Saving
// the whole file names the revision it was edited from.
std::string Revision(bool found, std::string_view text);

// Reads the file on the file sequence and replies on the caller's.
void Read(base::OnceCallback<void(ReadResult)> reply);

// Synchronous version for the background task and tests.
ReadResult ReadBlocking(const base::FilePath& path);

// What a change or a save did: an empty `error` and the file's new
// revision, or what went wrong (the file is then unchanged).
struct WriteResult {
  std::string error;
  std::string revision;
};

// What WriteIfUnchanged replies when the file changed since `base_revision`.
inline constexpr char kChangedError[] =
    "The config file changed since you opened it, in another window or "
    "another app. Revert to see the current file, then make your change "
    "again.";

// Replaces the file with `text` (Merlin Settings' editor), creating its
// folder if needed, only if it is still at `base_revision`: a save never
// overwrites a change made since it was read (kChangedError instead).
// Writes through a temporary file, so a failed write leaves the old file.
void WriteIfUnchanged(std::string text,
                      std::string base_revision,
                      base::OnceCallback<void(WriteResult)> reply);

// Reads the file, passes its text (empty if there is none) to `change` and
// writes what it returns, all in one task on the file sequence. A file that
// can't be read is left alone.
void Update(base::OnceCallback<std::string(const std::string&)> change,
            base::OnceCallback<void(WriteResult)> reply);

std::string WriteBlocking(const base::FilePath& path, const std::string& text);

// Returns `text` with `name = literal` under [options]: the existing line is
// replaced, or one is added (with the table, if the file has none). Comments,
// other tables and formatting are kept. `literal` is TOML, e.g. `false` or
// `"asdf"`.
std::string SetOption(std::string_view text,
                      std::string_view name,
                      std::string_view literal);

}  // namespace modal_browser::config_file

#endif  // CHROME_BROWSER_UI_MODAL_BROWSER_CONFIG_FILE_H_
