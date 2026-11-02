#include "chrome/browser/merlin_adblock/cache.h"

#include <algorithm>

#include "base/containers/span.h"
#include "base/files/file_util.h"
#include "base/files/important_file_writer.h"
#include "base/json/json_reader.h"
#include "base/pickle.h"
#include "base/strings/string_number_conversions.h"
#include "base/strings/string_util.h"
#include "components/merlin_adblock/resources/bundled_data.h"
#include "crypto/hash.h"

namespace merlin_adblock {
namespace {
constexpr size_t kMaxCacheBytes = 64 * 1024 * 1024;
constexpr char kCacheVersion[] =
    "MerlinAdblock/0.13.3/4/css-validation/popup-adapter-1";
bool ValidBytes(std::string_view bytes) {
  if (bytes.size() < 36 || bytes.substr(0, 4) != "MAC1")
    return false;
  auto digest = crypto::hash::Sha256(base::as_byte_span(bytes.substr(36)));
  return base::as_byte_span(bytes.substr(4, 32)) == base::span(digest);
}

bool ReadCache(const base::FilePath& path, Bundle* bundle) {
  if (path.empty())
    return false;
  std::string bytes;
  if (!base::ReadFileToStringWithMaxSize(path, &bytes, kMaxCacheBytes))
    return false;
  if (!ValidBytes(bytes))
    return false;
  auto pickle = base::Pickle::WithUnownedBuffer(
      base::as_byte_span(bytes).subspan(size_t{36}));
  base::PickleIterator reader(pickle);
  std::string version;
  int count = 0;
  if (!reader.ReadString(&version) || version != kCacheVersion ||
      !reader.ReadInt(&count) || count < 1 || count > 64 ||
      static_cast<size_t>(count) != bundle->sources.size())
    return false;
  auto sources = bundle->sources;
  for (auto& source : sources) {
    std::string id;
    if (!reader.ReadString(&id) || id != source.id ||
        !reader.ReadString(&source.text) ||
        source.text.size() > 16 * 1024 * 1024 ||
        !base::IsStringUTF8(source.text))
      return false;
    if (!reader.ReadString(&source.revision) || source.revision.size() > 256 ||
        !reader.ReadString(&source.digest) ||
        !reader.ReadDouble(&source.retrieved_at))
      return false;
    if (source.digest !=
        base::HexEncode(crypto::hash::Sha256(base::as_byte_span(source.text))))
      return false;
    source.expires_hours = SourceExpiryHours(source.text, source.expires_hours);
  }
  std::string engine;
  if (!reader.ReadString(&engine) || engine.empty() ||
      engine.size() > kMaxCacheBytes)
    return false;
  // Engine identity/checksum validation follows on the builder sequence. Trust
  // masks, resource data, update URLs and source identities come from the app.
  bundle->sources = std::move(sources);
  bundle->cache = std::move(engine);
  bundle->from_cache = true;
  return true;
}
}  // namespace

unsigned SourceExpiryHours(std::string_view text, unsigned fallback) {
  // Publisher metadata cannot turn a refresh into a tight loop or postpone it
  // indefinitely. Header parsing is bounded and stays off browser UI.
  text = text.substr(0, 8192);
  while (!text.empty()) {
    const auto end = text.find('\n');
    auto line = base::TrimWhitespaceASCII(text.substr(0, end), base::TRIM_ALL);
    text = end == std::string_view::npos ? std::string_view()
                                         : text.substr(end + 1);
    if (!line.starts_with('!'))
      continue;
    line = base::TrimWhitespaceASCII(line.substr(1), base::TRIM_ALL);
    if (!base::StartsWith(line,
                          "Expires:", base::CompareCase::INSENSITIVE_ASCII))
      continue;
    line = base::TrimWhitespaceASCII(line.substr(8), base::TRIM_ALL);
    const auto split = line.find_first_of(" \t");
    if (split == std::string_view::npos)
      continue;
    unsigned count = 0;
    if (!base::StringToUint(line.substr(0, split), &count) || count == 0 ||
        count > 1000)
      continue;
    auto unit = base::TrimWhitespaceASCII(line.substr(split), base::TRIM_ALL);
    unit = unit.substr(0, unit.find_first_of(" \t"));
    const auto lower = base::ToLowerASCII(unit);
    if (lower == "day" || lower == "days")
      return std::clamp(count * 24, 1u, 168u);
    if (lower == "hour" || lower == "hours")
      return std::clamp(count, 1u, 168u);
  }
  return std::clamp(fallback, 1u, 168u);
}

Bundle IdentifyBundle(Bundle bundle) {
  std::string identity = kCacheVersion;
  for (const auto& source : bundle.sources) {
    identity += base::NumberToString(source.id.size()) + ":" + source.id;
    identity += base::NumberToString(source.text.size()) + ":" + source.text;
    identity += static_cast<char>(source.permissions);
  }
  identity += bundle.resources;
  bundle.key =
      base::HexEncode(crypto::hash::Sha256(base::as_byte_span(identity)));
  return bundle;
}

Bundle LoadBundle(base::FilePath read_cache,
                  base::FilePath write_cache,
                  std::vector<std::string> groups) {
  Bundle bundle;
  bundle.cache_path = std::move(write_cache);
  auto manifest = base::JSONReader::ReadDict(ReadBundledAsset("manifest.json"),
                                             base::JSON_PARSE_RFC);
  if (!manifest)
    return bundle;
  const auto* sources = manifest->FindList("sources");
  if (!sources)
    return bundle;
  for (const auto& value : *sources) {
    const auto& data = value.GetDict();
    const auto* id = data.FindString("id");
    const auto* file = data.FindString("file");
    const auto* group = data.FindString("group");
    const auto* url = data.FindString("url");
    if (!id || !file || !group || !url)
      return {};
    if (std::ranges::find(groups, *group) == groups.end())
      continue;
    Source source;
    source.id = *id;
    source.text = ReadBundledAsset(*file);
    source.permissions = data.FindInt("permissions").value_or(0);
    source.group = *group;
    source.update_url = GURL(*url);
    source.expires_hours = SourceExpiryHours(
        source.text, data.FindInt("expires_hours").value_or(6));
    source.minimum_rules = data.FindInt("minimum_rules").value_or(1);
    source.revision =
        data.FindString("revision") ? *data.FindString("revision") : "bundled";
    source.digest =
        base::HexEncode(crypto::hash::Sha256(base::as_byte_span(source.text)));
    source.retrieved_at = data.FindDouble("retrieved_at").value_or(0);
    bundle.sources.push_back(std::move(source));
  }
  bundle.resources = ReadBundledAsset("resources.json");
  bundle.bundled_sources = bundle.sources;
  // Corrupt/incompatible cache bytes are rejected again by Rust. Reading the
  // previous complete snapshot handles an interrupted publication.
  if (!ReadCache(read_cache, &bundle) && !read_cache.empty())
    ReadCache(read_cache.AddExtensionASCII("previous"), &bundle);
  return IdentifyBundle(std::move(bundle));
}

bool SaveBundleCache(const Bundle& bundle) {
  if (bundle.cache_path.empty())
    return true;
  if (bundle.cache.empty())
    return false;
  base::Pickle pickle;
  pickle.WriteString(kCacheVersion);
  pickle.WriteInt(bundle.sources.size());
  for (const auto& source : bundle.sources) {
    pickle.WriteString(source.id);
    pickle.WriteString(source.text);
    pickle.WriteString(source.revision);
    pickle.WriteString(source.digest);
    pickle.WriteDouble(source.retrieved_at);
  }
  pickle.WriteString(bundle.cache);
  if (pickle.size() + 36 > kMaxCacheBytes ||
      !base::CreateDirectory(bundle.cache_path.DirName()))
    return false;
  std::string previous;
  if (base::ReadFileToStringWithMaxSize(bundle.cache_path, &previous,
                                        kMaxCacheBytes) &&
      ValidBytes(previous)) {
    if (!base::ImportantFileWriter::WriteFileAtomically(
            bundle.cache_path.AddExtensionASCII("previous"), previous))
      return false;
  }
  std::string_view payload(reinterpret_cast<const char*>(pickle.data()),
                           pickle.size());
  auto digest = crypto::hash::Sha256(base::as_byte_span(payload));
  std::string bytes = "MAC1";
  bytes.append(reinterpret_cast<const char*>(digest.data()), digest.size());
  bytes.append(payload);
  return base::ImportantFileWriter::WriteFileAtomically(bundle.cache_path,
                                                        bytes);
}
}  // namespace merlin_adblock
