#ifndef COMPONENTS_MERLIN_ADBLOCK_COMMON_FEATURES_H_
#define COMPONENTS_MERLIN_ADBLOCK_COMMON_FEATURES_H_

#include "base/feature_list.h"

namespace merlin_adblock {
BASE_DECLARE_FEATURE(kMerlinAdblock);
// Keep disabled until the correctness, YouTube and performance release gates
// pass.
}  // namespace merlin_adblock
#endif
