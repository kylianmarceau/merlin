// Copyright 2026 The modal_browser Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#include "chrome/browser/ui/modal_browser/merlin_suggestions.h"

#include <utility>

#include "base/strings/string_util.h"
#include "base/strings/utf_string_conversions.h"
#include "chrome/browser/autocomplete/chrome_autocomplete_provider_client.h"
#include "chrome/browser/autocomplete/chrome_autocomplete_scheme_classifier.h"
#include "chrome/browser/predictors/autocomplete_action_predictor.h"
#include "chrome/browser/predictors/autocomplete_action_predictor_factory.h"
#include "chrome/browser/predictors/loading_predictor.h"
#include "chrome/browser/predictors/loading_predictor_config.h"
#include "chrome/browser/predictors/loading_predictor_factory.h"
#include "chrome/browser/preloading/prefetch/search_prefetch/search_prefetch_service.h"
#include "chrome/browser/preloading/prefetch/search_prefetch/search_prefetch_service_factory.h"
#include "chrome/browser/preloading/search_preload/search_preload_service.h"
#include "chrome/browser/profiles/profile.h"
#include "chrome/browser/ui/modal_browser/merlin_urls.h"
#include "components/omnibox/browser/autocomplete_classifier.h"
#include "components/omnibox/browser/autocomplete_controller_config.h"
#include "components/omnibox/browser/autocomplete_enums.h"
#include "components/omnibox/browser/autocomplete_input.h"
#include "components/omnibox/browser/autocomplete_match.h"
#include "components/omnibox/browser/autocomplete_match_type.h"
#include "components/omnibox/browser/autocomplete_result.h"
#include "content/public/browser/devtools_agent_host.h"
#include "content/public/browser/render_frame_host.h"
#include "content/public/browser/web_contents.h"
#include "services/network/public/cpp/constants.h"
#include "third_party/metrics_proto/omnibox_event.pb.h"
#include "url/url_constants.h"
#include "third_party/metrics_proto/omnibox_focus_type.pb.h"

namespace modal_browser {

namespace {

// Rows the field shows at most.
constexpr size_t kMaxSuggestions = 8;
// Longest text sent to the engine.
constexpr size_t kMaxQuery = 2048;

using omnibox::AutocompleteMatchType;

// Matches that are pages or searches. Pedals, tiles, clipboard and other
// special rows need UI the start page does not have.
bool Shown(const AutocompleteMatch& match) {
  if (!match.destination_url.is_valid()) {
    return false;
  }
  switch (match.type) {
    case AutocompleteMatchType::kPedal:
    case AutocompleteMatchType::kClipboardUrl:
    case AutocompleteMatchType::kClipboardText:
    case AutocompleteMatchType::kClipboardImage:
    case AutocompleteMatchType::kTileSuggestion:
    case AutocompleteMatchType::kTileNavsuggest:
    case AutocompleteMatchType::kTileMostVisitedSite:
    case AutocompleteMatchType::kTileRepeatableQuery:
    case AutocompleteMatchType::kNullResultMessage:
    case AutocompleteMatchType::kHistoryEmbeddingsAnswer:
    case AutocompleteMatchType::kTabGroup:
      return false;
    default:
      return true;
  }
}

}  // namespace

MerlinSuggestions::MerlinSuggestions(Profile* profile, Callback on_results)
    : profile_(profile), on_results_(std::move(on_results)) {
  controller_ = std::make_unique<AutocompleteController>(
      std::make_unique<ChromeAutocompleteProviderClient>(profile_),
      AutocompleteControllerConfig{
          .provider_types = AutocompleteClassifier::DefaultOmniboxProviders(),
          .show_iph_matches = false});
  controller_->AddObserver(this);
}

MerlinSuggestions::~MerlinSuggestions() {
  controller_->RemoveObserver(this);
}

void MerlinSuggestions::Query(const std::u16string& text,
                              bool prevent_inline) {
  if (text.empty() || text.size() > kMaxQuery) {
    Stop();
    return;
  }
  // Classified like Chromium's address bar on a new tab page: pages from
  // history and bookmarks rank as they do there (a search-box
  // classification would favor searches over youtube.com for "youtu").
  const GURL internal = MerlinInternalUrl(text);
  AutocompleteInput input(
      internal.is_valid() ? base::UTF8ToUTF16(internal.spec()) : text,
      metrics::OmniboxEventProto::INSTANT_NTP_WITH_OMNIBOX_AS_STARTING_FOCUS,
      ChromeAutocompleteSchemeClassifier(profile_));
  // A completion suffix for chrome:// cannot be appended to merlin:// input.
  input.set_prevent_inline_autocomplete(prevent_inline || internal.is_valid());
  input.set_focus_type(metrics::OmniboxFocusType::INTERACTION_DEFAULT);
  text_ = text;
  recommend_ = true;
  controller_->Start(input);
}

void MerlinSuggestions::Stop() {
  controller_->Stop(AutocompleteStopReason::kClobbered);
  results_.clear();
}

void MerlinSuggestions::SetTarget(content::WebContents* contents) {
  target_ = contents ? contents->GetWeakPtr() : nullptr;
}

void MerlinSuggestions::Opened(const GURL& url) {
  auto* predictor =
      predictors::AutocompleteActionPredictorFactory::GetForProfile(profile_);
  if (learning_ && predictor && predictor->initialized()) {
    predictor->UpdateDatabaseFromTransitionalMatches(url);
  }
  learning_ = false;
}

const MerlinSuggestions::Suggestion* MerlinSuggestions::DefaultFor(
    const std::u16string& field_text) const {
  if (results_.empty() || !results_.front().is_default) {
    return nullptr;
  }
  const Suggestion& top = results_.front();
  const std::u16string shown = text_ + top.inline_completion;
  if (base::TrimWhitespace(shown, base::TRIM_ALL) !=
      base::TrimWhitespace(field_text, base::TRIM_ALL)) {
    return nullptr;
  }
  return &top;
}

// static
bool MerlinSuggestions::IsOpenable(const GURL& url) {
  return url.is_valid() && !url.SchemeIs(url::kJavaScriptScheme) &&
         !url.SchemeIs(url::kDataScheme) && !url.SchemeIs(url::kBlobScheme) &&
         !url.SchemeIs(url::kFileSystemScheme);
}

// static
ui::PageTransition MerlinSuggestions::FromAddressBar(
    ui::PageTransition transition) {
  return ui::PageTransitionFromInt(transition |
                                   ui::PAGE_TRANSITION_FROM_ADDRESS_BAR);
}

void MerlinSuggestions::Prepare(const AutocompleteResult& result,
                                bool default_match_changed) {
  content::WebContents* contents = target_.get();
  if (!contents || text_.empty()) {
    return;
  }
  auto* predictor =
      predictors::AutocompleteActionPredictorFactory::GetForProfile(profile_);
  if (!predictor) {
    return;
  }
  // Everything offered for this text, so opening any of it teaches the
  // predictor (it ignores text shorter or longer than it learns from).
  predictor->RegisterTransitionalMatches(text_, result);
  learning_ = true;
  // The results pages the search engine hints are worth fetching.
  if (auto* prefetch = SearchPrefetchServiceFactory::GetForProfile(profile_)) {
    prefetch->OnResultChanged(contents, result);
  }
  if (auto* preload = SearchPreloadService::GetForProfile(profile_)) {
    preload->OnAutocompleteResultChanged(contents, result);
  }
  // Once per keystroke and whenever the top match changes, as Chromium's
  // address bar asks.
  const AutocompleteMatch* match = result.default_match();
  if (!match || !(recommend_ || default_match_changed)) {
    return;
  }
  recommend_ = false;
  switch (predictor->RecommendAction(text_, *match, contents)) {
    case predictors::AutocompleteActionPredictor::ACTION_PRERENDER:
      // Not with DevTools open in the tab, and never the page it shows.
      if (contents->GetPrimaryMainFrame()->IsRenderFrameLive() &&
          !content::DevToolsAgentHost::IsDebuggerAttached(contents) &&
          match->destination_url != contents->GetLastCommittedURL()) {
        predictor->StartPrerendering(match->destination_url, *contents);
      }
      break;
    case predictors::AutocompleteActionPredictor::ACTION_PRECONNECT:
      if (auto* loading =
              predictors::LoadingPredictorFactory::GetForProfile(profile_)) {
        loading->PrepareForPageLoad(
            /*initiator_origin=*/std::nullopt, match->destination_url,
            predictors::HintOrigin::OMNIBOX,
            network::GetNoOpNetworkRestrictionsId(),
            predictors::AutocompleteActionPredictor::IsPreconnectable(*match));
      }
      break;
    case predictors::AutocompleteActionPredictor::ACTION_NONE:
      break;
  }
}

void MerlinSuggestions::OnResultChanged(AutocompleteController* controller,
                                        bool default_match_changed) {
  Prepare(controller->result(), default_match_changed);
  results_.clear();
  for (const AutocompleteMatch& match : controller->result()) {
    if (results_.size() == kMaxSuggestions) {
      break;
    }
    if (!Shown(match)) {
      continue;
    }
    Suggestion s;
    s.destination = match.destination_url;
    s.transition = FromAddressBar(match.transition);
    if (AutocompleteMatch::IsSearchType(match.type)) {
      s.kind = Kind::kSearch;
      s.title = match.contents;
    } else {
      s.kind = match.has_tab_match.value_or(false) ||
                       match.type == AutocompleteMatchType::kOpenTab
                   ? Kind::kTab
                   : Kind::kUrl;
      s.title = match.description.empty() ? match.contents : match.description;
      s.detail = match.contents;
      if (s.destination.SchemeIs("chrome")) {
        s.detail = base::UTF8ToUTF16(MerlinDisplayUrl(s.destination));
        if (match.description.empty())
          s.title = s.detail;
      }
    }
    // Only the default match may complete the field, as in Chromium.
    if (results_.empty() && match.allowed_to_be_default_match &&
        &match == controller->result().default_match()) {
      s.inline_completion = match.inline_autocompletion;
      s.is_default = true;
    }
    results_.push_back(std::move(s));
  }
  on_results_.Run(results_);
}

}  // namespace modal_browser
