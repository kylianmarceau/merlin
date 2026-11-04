#ifndef CHROME_BROWSER_MERLIN_ADBLOCK_CACHE_H_
#define CHROME_BROWSER_MERLIN_ADBLOCK_CACHE_H_
#include <string_view>
#include "chrome/browser/merlin_adblock/evaluator.h"

namespace merlin_adblock {
// All functions run on blocking background sequences, never on browser UI.
// Reads catalog metadata and, when `with_engine`, the serialized engine. List
// text is not read; LoadSourceTexts() supplies it when a build needs it.
Bundle LoadBundle(base::FilePath read_cache,
                  base::FilePath write_cache,
                  std::vector<std::string> groups,
                  bool with_engine = true);
// Fills in source text from the cached lists snapshot (checked against the
// recorded digest) or the bundled catalog. Returns false if any is missing.
bool LoadSourceTexts(std::vector<Source>& sources,
                     const base::FilePath& lists_path);
bool AllTextsLoaded(const std::vector<Source>& sources);
bool SaveBundleCache(const Bundle& bundle);
Bundle IdentifyBundle(Bundle bundle);
base::FilePath ListsPath(const base::FilePath& engine_path);
std::string TextDigest(std::string_view text);
unsigned SourceExpiryHours(std::string_view text, unsigned fallback);
}  // namespace merlin_adblock
#endif
