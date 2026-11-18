// Copyright 2026 The modal_browser Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#include "chrome/browser/ui/modal_browser/config_file.h"

#include <optional>
#include <vector>

#include "base/environment.h"
#include "base/files/file_util.h"
#include "base/files/important_file_writer.h"
#include "base/hash/sha1.h"
#include "base/no_destructor.h"
#include "base/path_service.h"
#include "base/strings/strcat.h"
#include "base/strings/string_split.h"
#include "base/strings/string_number_conversions.h"
#include "base/strings/string_util.h"
#include "base/task/sequenced_task_runner.h"
#include "base/task/thread_pool.h"

namespace modal_browser::config_file {

namespace {

std::optional<base::FilePath>& TestPath() {
  static base::NoDestructor<std::optional<base::FilePath>> path;
  return *path;
}

scoped_refptr<base::SequencedTaskRunner>& FileSequenceSlot() {
  static base::NoDestructor<scoped_refptr<base::SequencedTaskRunner>> runner;
  return *runner;
}

// The one sequence every read and write of the file runs on, in order.
// Writes block shutdown so a saved change is never lost. Used from the UI
// thread only.
scoped_refptr<base::SequencedTaskRunner> FileSequence() {
  scoped_refptr<base::SequencedTaskRunner>& runner = FileSequenceSlot();
  if (!runner) {
    runner = base::ThreadPool::CreateSequencedTaskRunner(
        {base::MayBlock(), base::TaskPriority::USER_BLOCKING,
         base::TaskShutdownBehavior::BLOCK_SHUTDOWN});
  }
  return runner;
}

WriteResult Written(const base::FilePath& path, const std::string& text) {
  WriteResult result;
  result.error = WriteBlocking(path, text);
  if (result.error.empty()) {
    result.revision = Revision(true, text);
  }
  return result;
}

WriteResult WriteIfUnchangedBlocking(const base::FilePath& path,
                                     const std::string& text,
                                     const std::string& base_revision) {
  ReadResult current = ReadBlocking(path);
  if (!current.error.empty()) {
    return WriteResult{current.error, std::string()};
  }
  if (current.revision != base_revision) {
    return WriteResult{kChangedError, std::string()};
  }
  return Written(path, text);
}

WriteResult UpdateBlocking(
    const base::FilePath& path,
    base::OnceCallback<std::string(const std::string&)> change) {
  ReadResult current = ReadBlocking(path);
  if (!current.error.empty()) {
    return WriteResult{current.error, std::string()};
  }
  return Written(path, std::move(change).Run(current.text));
}

}  // namespace

std::string Revision(bool found, std::string_view text) {
  if (!found) {
    return "none";
  }
  return base::HexEncodeLower(base::SHA1Hash(base::as_byte_span(text)));
}

base::FilePath ConfigPath() {
  if (TestPath()) {
    return *TestPath();
  }
  std::unique_ptr<base::Environment> env = base::Environment::Create();
  base::FilePath base;
  if (std::optional<std::string> xdg = env->GetVar("XDG_CONFIG_HOME");
      xdg && !xdg->empty() && base::FilePath(*xdg).IsAbsolute()) {
    base = base::FilePath(*xdg);
  } else {
    base = base::GetHomeDir().Append(".config");
  }
  return base.Append("modal_browser").Append("config.toml");
}

void SetConfigPathForTesting(const base::FilePath& path) {
  TestPath() = path;
  // A test's thread pool is its own; the next read or write makes a
  // sequence in it.
  FileSequenceSlot() = nullptr;
}

ReadResult ReadBlocking(const base::FilePath& path) {
  ReadResult result;
  if (!base::PathExists(path)) {
    result.revision = Revision(false, std::string_view());
    return result;
  }
  result.found = true;
  if (!base::ReadFileToStringWithMaxSize(path, &result.text,
                                         kMaxConfigBytes)) {
    result.text.clear();
    result.error = "could not read the file (missing permission, or larger "
                   "than 256 KiB)";
    return result;
  }
  if (!base::IsStringUTF8(result.text)) {
    result.text.clear();
    result.error = "the file is not valid UTF-8";
    return result;
  }
  result.revision = Revision(true, result.text);
  return result;
}

void Read(base::OnceCallback<void(ReadResult)> reply) {
  FileSequence()->PostTaskAndReplyWithResult(
      FROM_HERE, base::BindOnce(&ReadBlocking, ConfigPath()), std::move(reply));
}

std::string WriteBlocking(const base::FilePath& path, const std::string& text) {
  if (text.size() > kMaxConfigBytes) {
    return "the configuration is larger than 256 KiB";
  }
  if (!base::IsStringUTF8(text)) {
    return "the configuration is not valid UTF-8";
  }
  if (!base::CreateDirectory(path.DirName())) {
    return "could not create " + path.DirName().AsUTF8Unsafe();
  }
  if (!base::ImportantFileWriter::WriteFileAtomically(path, text)) {
    return "could not write " + path.AsUTF8Unsafe();
  }
  return std::string();
}

void WriteIfUnchanged(std::string text,
                      std::string base_revision,
                      base::OnceCallback<void(WriteResult)> reply) {
  FileSequence()->PostTaskAndReplyWithResult(
      FROM_HERE,
      base::BindOnce(&WriteIfUnchangedBlocking, ConfigPath(), std::move(text),
                     std::move(base_revision)),
      std::move(reply));
}

void Update(base::OnceCallback<std::string(const std::string&)> change,
            base::OnceCallback<void(WriteResult)> reply) {
  FileSequence()->PostTaskAndReplyWithResult(
      FROM_HERE, base::BindOnce(&UpdateBlocking, ConfigPath(), std::move(change)),
      std::move(reply));
}

std::string SetOption(std::string_view text,
                      std::string_view name,
                      std::string_view literal) {
  std::vector<std::string> lines = base::SplitString(
      text, "\n", base::KEEP_WHITESPACE, base::SPLIT_WANT_ALL);
  const std::string line = base::StrCat({name, " = ", literal});
  std::string table;
  std::optional<size_t> header;
  for (size_t i = 0; i < lines.size(); ++i) {
    std::string_view t =
        base::TrimWhitespaceASCII(lines[i], base::TRIM_ALL);
    if (t.size() > 1 && t.front() == '[' && t.back() == ']') {
      table = std::string(base::TrimWhitespaceASCII(
          t.substr(1, t.size() - 2), base::TRIM_ALL));
      if (table == "options") {
        header = i;
      }
      continue;
    }
    if (table != "options" || !t.starts_with(name)) {
      continue;
    }
    std::string_view rest = base::TrimWhitespaceASCII(
        t.substr(name.size()), base::TRIM_LEADING);
    if (rest.starts_with('=')) {
      lines[i] = line;
      return base::JoinString(lines, "\n");
    }
  }
  if (header) {
    lines.insert(lines.begin() + *header + 1, line);
    return base::JoinString(lines, "\n");
  }
  std::string base(base::TrimWhitespaceASCII(text, base::TRIM_TRAILING));
  return base::StrCat(
      {base, base.empty() ? "" : "\n\n", "[options]\n", line, "\n"});
}

}  // namespace modal_browser::config_file
