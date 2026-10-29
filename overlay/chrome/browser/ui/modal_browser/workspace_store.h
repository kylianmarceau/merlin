// Copyright 2026 The modal_browser Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#ifndef CHROME_BROWSER_UI_MODAL_BROWSER_WORKSPACE_STORE_H_
#define CHROME_BROWSER_UI_MODAL_BROWSER_WORKSPACE_STORE_H_

#include <cstdint>
#include <string>
#include <utility>
#include <vector>

#include "base/files/file_path.h"
#include "base/functional/callback.h"

// Where workspace files live, and their I/O. Encoding, decoding and
// validation happen in Rust (modal_browser_core::workspace); this file only
// moves bytes, off the UI thread, with atomic writes.
namespace modal_browser::workspace_store {

// Matches modal_browser_core::workspace::MAX_FILE_LEN.
inline constexpr size_t kMaxWorkspaceBytes = 2 * 1024 * 1024;

// $XDG_DATA_HOME/modal_browser/workspaces, else
// ~/.local/share/modal_browser/workspaces (as Neovim keeps its data). Kept
// apart from Chromium's profile: workspaces are not profile data.
base::FilePath Directory();

// Tests point this at a temporary directory.
void SetDirectoryForTesting(const base::FilePath& dir);

// `name` must already be validated (ffi::is_workspace_name).
base::FilePath PathFor(std::string_view name);

struct Entry {
  std::string name;
  // Seconds since the Unix epoch.
  int64_t modified = 0;
};

struct ReadResult {
  bool found = false;
  std::string text;
  std::string error;
};

// Each runs on a background sequence and replies on the caller's.
void Write(std::string name,
           std::string contents,
           base::OnceCallback<void(std::string error)> reply);
void Read(std::string name, base::OnceCallback<void(ReadResult)> reply);
void Delete(std::string name, base::OnceCallback<void(bool deleted)> reply);
// Newest first. Files whose names are not valid workspace names are skipped.
void List(base::OnceCallback<void(std::vector<Entry>)> reply);

// Every workspace's name and contents (unreadable files skipped).
void ReadAll(base::OnceCallback<void(std::vector<std::pair<std::string,
                                                          std::string>>)> reply);

}  // namespace modal_browser::workspace_store

#endif  // CHROME_BROWSER_UI_MODAL_BROWSER_WORKSPACE_STORE_H_
