// Copyright 2026 The modal_browser Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#include "chrome/browser/ui/modal_browser/workspace_store.h"

#include <algorithm>
#include <optional>

#include "base/environment.h"
#include "base/files/file_enumerator.h"
#include "base/files/file_util.h"
#include "base/files/important_file_writer.h"
#include "base/no_destructor.h"
#include "base/strings/string_util.h"
#include "base/task/sequenced_task_runner.h"
#include "base/task/thread_pool.h"
#include "components/modal_browser/ffi/src/lib.rs.h"

namespace modal_browser::workspace_store {

namespace {

constexpr char kExtension[] = ".json";
constexpr size_t kMaxListed = 1000;

std::optional<base::FilePath>& TestDir() {
  static base::NoDestructor<std::optional<base::FilePath>> dir;
  return *dir;
}

// All workspace I/O runs in order on one sequence, so a save followed by an
// open of the same name reads what was written.
scoped_refptr<base::SequencedTaskRunner> TaskRunner() {
  static base::NoDestructor<scoped_refptr<base::SequencedTaskRunner>> runner(
      base::ThreadPool::CreateSequencedTaskRunner(
          {base::MayBlock(), base::TaskPriority::USER_VISIBLE,
           base::TaskShutdownBehavior::BLOCK_SHUTDOWN}));
  return *runner;
}

std::string WriteBlocking(const base::FilePath& path,
                          const std::string& contents) {
  const base::FilePath dir = path.DirName();
  if (!base::CreateDirectory(dir)) {
    return "could not create " + dir.value();
  }
  // Only the user may read the list of pages.
  base::SetPosixFilePermissions(dir, 0700);
  if (contents.size() > kMaxWorkspaceBytes) {
    return "the workspace is too large";
  }
  // Writes a temporary file and renames it over the old one, so a crash
  // never leaves a half-written workspace.
  if (!base::ImportantFileWriter::WriteFileAtomically(path, contents,
                                                      "ModalWorkspace")) {
    return "could not write " + path.value();
  }
  base::SetPosixFilePermissions(path, 0600);
  return std::string();
}

ReadResult ReadBlocking(const base::FilePath& path) {
  ReadResult result;
  if (!base::PathExists(path)) {
    return result;
  }
  result.found = true;
  if (!base::ReadFileToStringWithMaxSize(path, &result.text,
                                         kMaxWorkspaceBytes)) {
    result.text.clear();
    result.error = "could not read " + path.value();
  } else if (!base::IsStringUTF8(result.text)) {
    result.text.clear();
    result.error = "the file is not valid UTF-8";
  }
  return result;
}

std::vector<Entry> ListBlocking(const base::FilePath& dir) {
  std::vector<Entry> out;
  base::FileEnumerator files(dir, /*recursive=*/false,
                             base::FileEnumerator::FILES,
                             FILE_PATH_LITERAL("*.json"));
  for (base::FilePath path = files.Next(); !path.empty();
       path = files.Next()) {
    const std::string name = path.BaseName().RemoveFinalExtension().value();
    if (!ffi::is_workspace_name(name)) {
      continue;
    }
    out.push_back(
        {name, files.GetInfo().GetLastModifiedTime().ToTimeT()});
    if (out.size() >= kMaxListed) {
      break;
    }
  }
  std::sort(out.begin(), out.end(), [](const Entry& a, const Entry& b) {
    return a.modified != b.modified ? a.modified > b.modified : a.name < b.name;
  });
  return out;
}

}  // namespace

base::FilePath Directory() {
  if (TestDir()) {
    return *TestDir();
  }
  std::unique_ptr<base::Environment> env = base::Environment::Create();
  base::FilePath base;
  if (std::optional<std::string> xdg = env->GetVar("XDG_DATA_HOME");
      xdg && !xdg->empty() && base::FilePath(*xdg).IsAbsolute()) {
    base = base::FilePath(*xdg);
  } else {
    base = base::GetHomeDir().Append(".local").Append("share");
  }
  return base.Append("modal_browser").Append("workspaces");
}

void SetDirectoryForTesting(const base::FilePath& dir) {
  TestDir() = dir;
}

base::FilePath PathFor(std::string_view name) {
  return Directory().Append(std::string(name) + kExtension);
}

void Write(std::string name,
           std::string contents,
           base::OnceCallback<void(std::string error)> reply) {
  TaskRunner()->PostTaskAndReplyWithResult(
      FROM_HERE,
      base::BindOnce(&WriteBlocking, PathFor(name), std::move(contents)),
      std::move(reply));
}

void Read(std::string name, base::OnceCallback<void(ReadResult)> reply) {
  TaskRunner()->PostTaskAndReplyWithResult(
      FROM_HERE, base::BindOnce(&ReadBlocking, PathFor(name)),
      std::move(reply));
}

void Delete(std::string name, base::OnceCallback<void(bool deleted)> reply) {
  TaskRunner()->PostTaskAndReplyWithResult(
      FROM_HERE,
      base::BindOnce(
          [](const base::FilePath& path) {
            return base::PathExists(path) && base::DeleteFile(path);
          },
          PathFor(name)),
      std::move(reply));
}

void ReadAll(base::OnceCallback<
             void(std::vector<std::pair<std::string, std::string>>)> reply) {
  TaskRunner()->PostTaskAndReplyWithResult(
      FROM_HERE,
      base::BindOnce([](const base::FilePath& dir) {
        std::vector<std::pair<std::string, std::string>> out;
        for (const Entry& e : ListBlocking(dir)) {
          ReadResult r = ReadBlocking(dir.Append(e.name + kExtension));
          if (r.found && r.error.empty()) {
            out.emplace_back(e.name, std::move(r.text));
          }
        }
        return out;
      }, Directory()),
      std::move(reply));
}

void List(base::OnceCallback<void(std::vector<Entry>)> reply) {
  TaskRunner()->PostTaskAndReplyWithResult(
      FROM_HERE, base::BindOnce(&ListBlocking, Directory()), std::move(reply));
}

}  // namespace modal_browser::workspace_store
