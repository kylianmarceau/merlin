#ifndef CHROME_BROWSER_MERLIN_ADBLOCK_CACHE_H_
#define CHROME_BROWSER_MERLIN_ADBLOCK_CACHE_H_
#include <string_view>
#include "chrome/browser/merlin_adblock/evaluator.h"

namespace merlin_adblock {
// All functions run on blocking background sequences, never on browser UI.
Bundle LoadBundle(base::FilePath read_cache,
                  base::FilePath write_cache,
                  std::vector<std::string> groups);
bool SaveBundleCache(const Bundle& bundle);
Bundle IdentifyBundle(Bundle bundle);
unsigned SourceExpiryHours(std::string_view text, unsigned fallback);
}  // namespace merlin_adblock
#endif
