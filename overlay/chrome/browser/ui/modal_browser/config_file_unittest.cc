// Copyright 2026 The modal_browser Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#include "chrome/browser/ui/modal_browser/config_file.h"

#include <string>

#include "base/files/file_path.h"
#include "base/files/file_util.h"
#include "base/files/scoped_temp_dir.h"
#include "base/functional/bind.h"
#include "base/test/task_environment.h"
#include "base/test/test_future.h"
#include "testing/gtest/include/gtest/gtest.h"

namespace modal_browser::config_file {
namespace {

class ConfigFileTest : public testing::Test {
 protected:
  void SetUp() override {
    ASSERT_TRUE(dir_.CreateUniqueTempDir());
    path_ = dir_.GetPath().Append("modal_browser").Append("config.toml");
    SetConfigPathForTesting(path_);
  }

  void TearDown() override { task_environment_.RunUntilIdle(); }

  void WriteFile(const std::string& text) {
    ASSERT_TRUE(base::CreateDirectory(path_.DirName()));
    ASSERT_TRUE(base::WriteFile(path_, text));
  }

  std::string FileText() {
    std::string text;
    EXPECT_TRUE(base::ReadFileToString(path_, &text));
    return text;
  }

  ReadResult ReadNow() {
    base::test::TestFuture<ReadResult> read;
    Read(read.GetCallback());
    return read.Take();
  }

  // Sets one [options] value, as Settings' switches do.
  void SetOptionLater(std::string name,
                      std::string literal,
                      base::OnceCallback<void(WriteResult)> reply) {
    Update(base::BindOnce(
               [](std::string name, std::string literal,
                  const std::string& text) {
                 return SetOption(text, name, literal);
               },
               std::move(name), std::move(literal)),
           std::move(reply));
  }

  base::test::TaskEnvironment task_environment_;
  base::ScopedTempDir dir_;
  base::FilePath path_;
};

TEST_F(ConfigFileTest, TwoOptionsSetAtOnceBothLand) {
  WriteFile("# mine\n[options]\nhint_chars = \"asdf\"\n");
  // Both are asked for before either is read: each must change the file
  // the other wrote, not its own earlier copy of it.
  base::test::TestFuture<WriteResult> first;
  base::test::TestFuture<WriteResult> second;
  SetOptionLater("modal_browsing", "false", first.GetCallback());
  SetOptionLater("vertical_tabs", "true", second.GetCallback());
  EXPECT_EQ(first.Get().error, "");
  EXPECT_EQ(second.Get().error, "");
  const std::string text = FileText();
  EXPECT_NE(text.find("# mine"), std::string::npos) << text;
  EXPECT_NE(text.find("hint_chars = \"asdf\""), std::string::npos) << text;
  EXPECT_NE(text.find("modal_browsing = false"), std::string::npos) << text;
  EXPECT_NE(text.find("vertical_tabs = true"), std::string::npos) << text;
  EXPECT_EQ(second.Get().revision, Revision(true, text));
}

TEST_F(ConfigFileTest, ManyInterleavedChangesAllLand) {
  WriteFile("[options]\n");
  const char* names[] = {"a1", "a2", "a3", "a4", "a5", "a6", "a7", "a8"};
  base::test::TestFuture<WriteResult> last;
  for (const char* name : names) {
    SetOptionLater(name, "true", base::DoNothing());
    // A whole-file read in between, as Settings opening its editor does.
    Read(base::DoNothing());
  }
  SetOptionLater("done", "true", last.GetCallback());
  ASSERT_EQ(last.Get().error, "");
  const std::string text = FileText();
  for (const char* name : names) {
    EXPECT_NE(text.find(std::string(name) + " = true"), std::string::npos)
        << name << " was lost:\n" << text;
  }
}

TEST_F(ConfigFileTest, StaleWholeFileSaveIsRefused) {
  WriteFile("[options]\n");
  const ReadResult opened = ReadNow();
  ASSERT_TRUE(opened.found);
  EXPECT_EQ(opened.revision, Revision(true, "[options]\n"));

  // A switch in Settings changes the file while the editor is open.
  base::test::TestFuture<WriteResult> option;
  SetOptionLater("modal_browsing", "false", option.GetCallback());
  ASSERT_EQ(option.Get().error, "");

  // Saving what the editor still shows would undo that change.
  base::test::TestFuture<WriteResult> stale;
  WriteIfUnchanged("[options]\nsmooth_scroll = false\n", opened.revision,
                   stale.GetCallback());
  EXPECT_EQ(stale.Get().error, kChangedError);
  EXPECT_EQ(stale.Get().revision, "");
  EXPECT_NE(FileText().find("modal_browsing = false"), std::string::npos);
  EXPECT_EQ(FileText().find("smooth_scroll"), std::string::npos);

  // Edited from the current file, it saves.
  const ReadResult current = ReadNow();
  const std::string edited = current.text + "smooth_scroll = false\n";
  base::test::TestFuture<WriteResult> saved;
  WriteIfUnchanged(edited, current.revision, saved.GetCallback());
  EXPECT_EQ(saved.Get().error, "");
  EXPECT_EQ(saved.Get().revision, Revision(true, edited));
  EXPECT_EQ(FileText(), edited);
  EXPECT_EQ(ReadNow().revision, saved.Get().revision);
}

TEST_F(ConfigFileTest, SaveCreatesAMissingFileOnlyOnce) {
  const ReadResult opened = ReadNow();
  EXPECT_FALSE(opened.found);
  EXPECT_EQ(opened.revision, "none");

  base::test::TestFuture<WriteResult> created;
  WriteIfUnchanged("[options]\n", opened.revision, created.GetCallback());
  EXPECT_EQ(created.Get().error, "");
  EXPECT_EQ(FileText(), "[options]\n");

  // Another window that also opened it while it didn't exist.
  base::test::TestFuture<WriteResult> again;
  WriteIfUnchanged("# other\n", opened.revision, again.GetCallback());
  EXPECT_EQ(again.Get().error, kChangedError);
  EXPECT_EQ(FileText(), "[options]\n");
}

TEST_F(ConfigFileTest, ReadsSeeEarlierWritesInOrder) {
  WriteFile("[options]\n");
  SetOptionLater("modal_browsing", "false", base::DoNothing());
  // Asked for after the change and before it ran: it sees the change.
  const ReadResult read = ReadNow();
  EXPECT_NE(read.text.find("modal_browsing = false"), std::string::npos);
}

TEST_F(ConfigFileTest, AnUnreadableFileIsLeftAlone) {
  WriteFile("[options]\n\xff\xfe\n");
  base::test::TestFuture<WriteResult> option;
  SetOptionLater("modal_browsing", "false", option.GetCallback());
  EXPECT_EQ(option.Get().error, "the file is not valid UTF-8");
  EXPECT_EQ(FileText(), "[options]\n\xff\xfe\n");
}

TEST(ConfigFileSetOptionTest, ReplacesAddsOrCreatesTheTable) {
  EXPECT_EQ(SetOption("[options]\nmodal_browsing = true\n", "modal_browsing",
                      "false"),
            "[options]\nmodal_browsing = false\n");
  EXPECT_EQ(SetOption("[options]\n# keep\n[keys]\nmodal_browsing = 1\n",
                      "modal_browsing", "false"),
            "[options]\nmodal_browsing = false\n# keep\n[keys]\n"
            "modal_browsing = 1\n");
  EXPECT_EQ(SetOption("[keys]\nj = \"down\"\n", "hint_chars", "\"sdf\""),
            "[keys]\nj = \"down\"\n\n[options]\nhint_chars = \"sdf\"\n");
  EXPECT_EQ(SetOption("", "vertical_tabs", "true"),
            "[options]\nvertical_tabs = true\n");
}

}  // namespace
}  // namespace modal_browser::config_file
