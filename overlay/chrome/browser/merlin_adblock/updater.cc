#include "chrome/browser/merlin_adblock/updater.h"

#include <algorithm>
#include <utility>

#include "base/check_is_test.h"
#include "base/containers/span.h"
#include "base/functional/bind.h"
#include "base/rand_util.h"
#include "base/strings/string_number_conversions.h"
#include "base/strings/string_util.h"
#include "base/task/thread_pool.h"
#include "chrome/browser/merlin_adblock/cache.h"
#include "chrome/browser/merlin_adblock/service.h"
#include "chrome/browser/profiles/profile.h"
#include "components/prefs/pref_service.h"
#include "content/public/browser/storage_partition.h"
#include "crypto/hash.h"
#include "net/base/load_flags.h"
#include "net/base/net_errors.h"
#include "net/base/url_util.h"
#include "net/http/http_response_headers.h"
#include "net/traffic_annotation/network_traffic_annotation.h"
#include "net/url_request/redirect_info.h"
#include "services/network/public/cpp/resource_request.h"
#include "services/network/public/cpp/simple_url_loader.h"
#include "services/network/public/mojom/url_response_head.mojom.h"

namespace merlin_adblock {
namespace {
constexpr size_t kMaxListBytes =
    network::SimpleURLLoader::kMaxBoundedStringDownloadSize;
size_t Rules(std::string_view text) {
  size_t count = 0;
  while (!text.empty()) {
    const auto end = text.find('\n');
    auto line = base::TrimWhitespaceASCII(text.substr(0, end), base::TRIM_ALL);
    if (!line.empty() && line.front() != '!' && line.front() != '[')
      ++count;
    if (end == std::string_view::npos)
      break;
    text.remove_prefix(end + 1);
  }
  return count;
}
std::optional<Source> Validate(Source source, std::string body) {
  if (body.empty() || body.size() > kMaxListBytes || !base::IsStringUTF8(body))
    return std::nullopt;
  const std::string prefix = base::ToLowerASCII(body.substr(0, 512));
  if (prefix.find("<!doctype") != std::string::npos ||
      prefix.find("<html") != std::string::npos)
    return std::nullopt;
  const size_t count = Rules(body), previous = Rules(source.text);
  if (count < source.minimum_rules ||
      (previous > 20 && (count < previous / 2 || count > previous * 2 + 100)))
    return std::nullopt;
  source.expires_hours = SourceExpiryHours(body, source.expires_hours);
  source.text = std::move(body);
  source.digest =
      base::HexEncode(crypto::hash::Sha256(base::as_byte_span(source.text)));
  source.revision = "sha256:" + source.digest;
  source.retrieved_at = base::Time::Now().InSecondsFSinceUnixEpoch();
  return source;
}
constexpr auto kTraffic =
    net::DefineNetworkTrafficAnnotation("merlin_adblock_lists", R"(
  semantics {
    sender: "Merlin native ad blocker"
    description: "Downloads selected advertising/tracking filter lists from the fixed source catalog."
    trigger: "Background checks every six hours with jitter and per-source expiry, or a manual refresh."
    data: "HTTPS GET to the catalog endpoint. No visited page URLs, referrers, account identifiers or cookies."
    destination: OTHER
    destination_other: "easylist.to and raw.githubusercontent.com"
  }
  policy {
    cookies_allowed: NO
    setting: "Merlin Settings > Ad blocking > Automatic list updates. The native feature and global protection can also be disabled. Private windows do not fetch updates."
    policy_exception_justification: "Standalone Merlin browser feature; local profile preferences control it."
  })");
}  // namespace

Updater::Updater(Profile* profile, InstallCallback install)
    : profile_(profile), install_(std::move(install)) {
  CHECK(!profile_->IsOffTheRecord());
  pref_changes_.Init(profile_->GetPrefs());
  for (const char* pref : {kEnabledPref, kUpdatesPref, kListsPref})
    pref_changes_.Add(pref, base::BindRepeating(&Updater::PreferencesChanged,
                                                base::Unretained(this)));
  Schedule(base::Minutes(1));
}
Updater::~Updater() = default;
void Updater::Stop() {
  weak_factory_.InvalidateWeakPtrs();
  schedule_.Stop();
  deadline_.Stop();
  loader_.reset();
  candidate_.reset();
  running_ = false;
  pref_changes_.RemoveAll();
}
void Updater::PreferencesChanged() {
  if (running_)
    Finish(false, "List refresh cancelled after settings changed");
  Schedule(base::Minutes(1));
}
void Updater::Schedule(base::TimeDelta delay) {
  schedule_.Stop();
  if (!profile_->GetPrefs()->GetBoolean(kEnabledPref) ||
      !profile_->GetPrefs()->GetBoolean(kUpdatesPref))
    return;
  schedule_.Start(
      FROM_HERE, delay,
      base::BindOnce(&Updater::Begin, weak_factory_.GetWeakPtr(), false));
}
void Updater::Refresh() {
  Begin(true);
}
void Updater::SetBundleForTesting(Bundle bundle) {
  CHECK_IS_TEST();
  CHECK(!running_);
  test_bundle_ = std::move(bundle);
  last_attempt_ = {};
  schedule_.Stop();
}
void Updater::Begin(bool manual) {
  if (running_)
    return;
  if (!manual && (!profile_->GetPrefs()->GetBoolean(kEnabledPref) ||
                  !profile_->GetPrefs()->GetBoolean(kUpdatesPref)))
    return;
  const auto now = base::Time::Now();
  if (!last_attempt_.is_null() && now - last_attempt_ < base::Minutes(5)) {
    status_ = "Lists were checked recently";
    if (!manual)
      Schedule(base::Minutes(5) - (now - last_attempt_));
    return;
  }
  last_attempt_ = now;
  running_ = true;
  manual_ = manual;
  changed_ = false;
  downloaded_ = false;
  index_ = 0;
  status_ = "Checking filter lists";
  schedule_.Stop();
  deadline_.Start(
      FROM_HERE, base::Minutes(5),
      base::BindOnce(&Updater::Finish, weak_factory_.GetWeakPtr(), false,
                     "List refresh timed out; previous rules retained"));
  if (test_bundle_) {
    Loaded(*test_bundle_);
    return;
  }
  std::vector<std::string> groups;
  for (const auto& value : profile_->GetPrefs()->GetList(kListsPref))
    if (value.is_string())
      groups.push_back(value.GetString());
  auto cache =
      profile_->GetPath().AppendASCII("MerlinAdblock").AppendASCII("current");
  base::ThreadPool::PostTaskAndReplyWithResult(
      FROM_HERE, {base::MayBlock(), base::TaskPriority::BEST_EFFORT},
      base::BindOnce(&LoadBundle, cache, cache, std::move(groups)),
      base::BindOnce(&Updater::Loaded, weak_factory_.GetWeakPtr()));
}
void Updater::Loaded(Bundle bundle) {
  if (!running_)
    return;
  candidate_ = std::move(bundle);
  Next();
}
void Updater::Next() {
  if (!running_ || !candidate_)
    return;
  if (index_ == candidate_->sources.size()) {
    if (!changed_) {
      if (downloaded_ && !candidate_->cache_path.empty()) {
        auto bundle = std::move(*candidate_);
        candidate_.reset();
        base::ThreadPool::PostTaskAndReplyWithResult(
            FROM_HERE, {base::MayBlock(), base::TaskPriority::BEST_EFFORT},
            base::BindOnce(
                [](Bundle bundle) { return SaveBundleCache(bundle); },
                std::move(bundle)),
            base::BindOnce(
                [](base::WeakPtr<Updater> self, bool ok) {
                  if (self)
                    self->Finish(
                        ok, ok ? "Selected lists are up to date"
                               : "Lists checked; cache could not be saved");
                },
                weak_factory_.GetWeakPtr()));
      } else
        Finish(true, "Selected lists are up to date");
      return;
    }
    status_ = "Validating a new rules generation";
    candidate_->cache.clear();
    candidate_->key.clear();
    candidate_->from_cache = false;
    auto bundle = std::move(*candidate_);
    candidate_.reset();
    bundle.still_requested = base::BindRepeating(
        [](base::WeakPtr<Updater> self) { return self && self->running_; },
        weak_factory_.GetWeakPtr());
    install_.Run(std::move(bundle), base::BindOnce(&Updater::Installed,
                                                   weak_factory_.GetWeakPtr()));
    return;
  }
  const auto& source = candidate_->sources[index_];
  if (!manual_ && source.retrieved_at > 0 &&
      base::Time::Now() <
          base::Time::FromSecondsSinceUnixEpoch(source.retrieved_at) +
              base::Hours(source.expires_hours)) {
    ++index_;
    Next();
    return;
  }
  if (!source.update_url.SchemeIs("https") &&
      !(test_bundle_ && net::IsLocalhost(source.update_url))) {
    Finish(false, "Unapproved update endpoint; previous rules retained");
    return;
  }
  auto request = std::make_unique<network::ResourceRequest>();
  request->url = source.update_url;
  request->credentials_mode = network::mojom::CredentialsMode::kOmit;
  request->load_flags = net::LOAD_BYPASS_CACHE | net::LOAD_DISABLE_CACHE;
  // Empty referrer and SiteForCookies are intentional.
  loader_ = network::SimpleURLLoader::Create(std::move(request), kTraffic);
  loader_->SetTimeoutDuration(base::Seconds(30));
  redirects_ = 0;
  loader_->SetOnRedirectCallback(base::BindRepeating(
      [](base::WeakPtr<Updater> self, const GURL& before,
         const net::RedirectInfo& redirect,
         const network::mojom::URLResponseHead&, std::vector<std::string>*) {
        if (!self)
          return;
        if (++self->redirects_ > 3 || !redirect.new_url.SchemeIs("https") ||
            redirect.new_url.host() != before.host())
          self->Finish(false,
                       "Unapproved update redirect; previous rules retained");
      },
      weak_factory_.GetWeakPtr()));
  loader_->DownloadToString(
      profile_->GetDefaultStoragePartition()
          ->GetURLLoaderFactoryForBrowserProcess()
          .get(),
      base::BindOnce(&Updater::Downloaded, weak_factory_.GetWeakPtr()),
      kMaxListBytes);
}
void Updater::Downloaded(std::optional<std::string> body) {
  if (!running_ || !candidate_ || !loader_)
    return;
  const bool ok = body && loader_->NetError() == net::OK &&
                  loader_->ResponseInfo() && loader_->ResponseInfo()->headers &&
                  loader_->ResponseInfo()->headers->response_code() == 200;
  loader_.reset();
  if (!ok) {
    Finish(false, "Could not refresh lists; previous rules retained");
    return;
  }
  Source source = candidate_->sources[index_];
  base::ThreadPool::PostTaskAndReplyWithResult(
      FROM_HERE, {base::TaskPriority::BEST_EFFORT},
      base::BindOnce(&Validate, std::move(source), std::move(*body)),
      base::BindOnce(&Updater::Validated, weak_factory_.GetWeakPtr()));
}
void Updater::Validated(std::optional<Source> source) {
  if (!running_ || !candidate_)
    return;
  if (!source) {
    Finish(false,
           "Invalid list data or rule-count anomaly; previous rules retained");
    return;
  }
  changed_ |= candidate_->sources[index_].digest != source->digest;
  candidate_->sources[index_] = std::move(*source);
  downloaded_ = true;
  ++index_;
  Next();
}
void Updater::Installed(bool ok) {
  if (!running_)
    return;
  if (ok)
    profile_->GetPrefs()->SetDouble(
        kLastUpdatePref, base::Time::Now().InSecondsFSinceUnixEpoch());
  Finish(ok,
         ok ? "Filter lists updated"
            : "Incompatible list/resource generation; previous rules retained");
}
void Updater::Finish(bool ok, std::string status) {
  weak_factory_.InvalidateWeakPtrs();
  loader_.reset();
  candidate_.reset();
  deadline_.Stop();
  running_ = false;
  status_ = std::move(status);
  failures_ = ok ? 0 : std::min(failures_ + 1, 3u);
  Schedule(base::Hours(std::min(6u << failures_, 24u)) +
           base::Seconds(base::RandIntInclusive(0, 1800)));
}
}  // namespace merlin_adblock
