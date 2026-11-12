// Copyright 2026 The modal_browser Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#ifndef CHROME_BROWSER_UI_MODAL_BROWSER_CONFIG_FILE_H_
#define CHROME_BROWSER_UI_MODAL_BROWSER_CONFIG_FILE_H_

#include <string>
#include <string_view>

#include "base/files/file_path.h"
#include "base/functional/callback.h"

// Locating and reading the user configuration file. Parsing and validation
// happen in Rust (modal_browser_core::config); this file only does I/O, off
// the UI thread.
namespace modal_browser::config_file {

// Largest file read; matches the Rust parser's bound.
inline constexpr size_t kMaxConfigBytes = 256 * 1024;

// $XDG_CONFIG_HOME/modal_browser/config.toml, else
// ~/.config/modal_browser/config.toml (the convention terminal tools such as
// Ghostty and Neovim use on macOS too).
base::FilePath ConfigPath();

// Tests point this at a temporary file (or a path that does not exist) so a
// developer's own config never affects them.
void SetConfigPathForTesting(const base::FilePath& path);

struct ReadResult {
  bool found = false;
  std::string text;
  // Set when the file exists but could not be read (too large, not UTF-8,
  // permissions).
  std::string error;
};

// Reads the file on a background sequence and replies on the caller's.
void Read(base::OnceCallback<void(ReadResult)> reply);

// Synchronous version for the background task and tests.
ReadResult ReadBlocking(const base::FilePath& path);

// Replaces the file with `text` (Merlin Settings' editor), creating its
// folder if needed. Replies with an empty string, or what went wrong.
// Writes through a temporary file, so a failed write leaves the old file.
void Write(std::string text, base::OnceCallback<void(std::string)> reply);

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
