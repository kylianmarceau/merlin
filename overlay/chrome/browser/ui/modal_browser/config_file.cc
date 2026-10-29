// Copyright 2026 The modal_browser Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#include "chrome/browser/ui/modal_browser/config_file.h"

#include <optional>

#include "base/environment.h"
#include "base/files/file_util.h"
#include "base/files/important_file_writer.h"
#include "base/no_destructor.h"
#include "base/path_service.h"
#include "base/strings/string_util.h"
#include "base/task/thread_pool.h"

namespace modal_browser::config_file {

namespace {

std::optional<base::FilePath>& TestPath() {
  static base::NoDestructor<std::optional<base::FilePath>> path;
  return *path;
}

}  // namespace

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
}

ReadResult ReadBlocking(const base::FilePath& path) {
  ReadResult result;
  if (!base::PathExists(path)) {
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
  }
  return result;
}

void Read(base::OnceCallback<void(ReadResult)> reply) {
  base::ThreadPool::PostTaskAndReplyWithResult(
      FROM_HERE,
      {base::MayBlock(), base::TaskPriority::USER_VISIBLE,
       base::TaskShutdownBehavior::CONTINUE_ON_SHUTDOWN},
      base::BindOnce(&ReadBlocking, ConfigPath()), std::move(reply));
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

void Write(std::string text, base::OnceCallback<void(std::string)> reply) {
  base::ThreadPool::PostTaskAndReplyWithResult(
      FROM_HERE,
      {base::MayBlock(), base::TaskPriority::USER_BLOCKING,
       base::TaskShutdownBehavior::BLOCK_SHUTDOWN},
      base::BindOnce(&WriteBlocking, ConfigPath(), std::move(text)),
      std::move(reply));
}

}  // namespace modal_browser::config_file
