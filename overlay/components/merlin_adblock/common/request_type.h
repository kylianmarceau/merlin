#ifndef COMPONENTS_MERLIN_ADBLOCK_COMMON_REQUEST_TYPE_H_
#define COMPONENTS_MERLIN_ADBLOCK_COMMON_REQUEST_TYPE_H_
#include "services/network/public/cpp/resource_request.h"
#include "third_party/blink/public/mojom/loader/resource_load_info.mojom-shared.h"
namespace merlin_adblock {
inline uint8_t ResourceKind(const network::ResourceRequest& request) {
  using D = network::mojom::RequestDestination;
  // Beacon and hyperlink auditing have an empty Fetch destination. Chromium
  // retains their distinct ping kind separately from fetch/XHR.
  if (request.resource_type ==
      static_cast<int>(blink::mojom::ResourceType::kPing))
    return 10;
  switch (request.destination) {
    case D::kDocument:
      return 1;
    case D::kIframe:
    case D::kFrame:
      return 2;
    case D::kScript:
    case D::kWorker:
    case D::kSharedWorker:
    case D::kServiceWorker:
      return 3;
    case D::kStyle:
      return 4;
    case D::kImage:
      return 5;
    case D::kFont:
      return 6;
    case D::kAudio:
    case D::kVideo:
    case D::kTrack:
      return 7;
    case D::kObject:
    case D::kEmbed:
      return 8;
    case D::kEmpty:
      return request.is_fetch_like_api ? 9 : 0;
    case D::kReport:
      return 10;
    default:
      return 0;
  }
}
}  // namespace merlin_adblock
#endif
