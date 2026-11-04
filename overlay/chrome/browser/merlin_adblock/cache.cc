#include "chrome/browser/merlin_adblock/cache.h"

#include <algorithm>
#include <map>
#include <optional>
#include <string>
#include <vector>

#include "base/containers/span.h"
#include "base/files/file_util.h"
#include "base/files/important_file_writer.h"
#include "base/json/json_reader.h"
#include "base/numerics/byte_conversions.h"
#include "base/pickle.h"
#include "base/strings/string_number_conversions.h"
#include "base/strings/string_util.h"
#include "components/merlin_adblock/resources/bundled_data.h"
#include "crypto/hash.h"

namespace merlin_adblock {
namespace {
constexpr size_t kMaxCacheBytes = 64 * 1024 * 1024;
constexpr char kCacheVersion[] =
    "MerlinAdblock/0.13.3/5/css-validation/popup-adapter-1";
// Startup reads only the engine file: metadata plus the serialized engine.
// List text lives in a separate file that is read only to rebuild or update.
constexpr std::string_view kEngineMagic = "MAE2";
constexpr std::string_view kListsMagic = "MAL2";
constexpr size_t kPrefix = 4 + crypto::hash::kSha256Size;

// Verifies magic + SHA-256 (BoringSSL, hardware accelerated) of the rest.
bool Valid(std::string_view bytes, std::string_view magic) {
  if (bytes.size() < kPrefix || bytes.substr(0, 4) != magic)
    return false;
  auto digest = crypto::hash::Sha256(base::as_byte_span(bytes.substr(kPrefix)));
  return base::as_byte_span(bytes.substr(4, crypto::hash::kSha256Size)) ==
         base::span(digest);
}
std::string Wrap(std::string_view magic, std::string_view payload) {
  auto digest = crypto::hash::Sha256(base::as_byte_span(payload));
  std::string bytes(magic);
  bytes.reserve(kPrefix + payload.size());
  bytes.append(reinterpret_cast<const char*>(digest.data()), digest.size());
  bytes.append(payload);
  return bytes;
}
std::string_view PickleView(const base::Pickle& pickle) {
  return std::string_view(reinterpret_cast<const char*>(pickle.data()),
                          pickle.size());
}
// Keeps the last complete snapshot so an interrupted write can be recovered.
bool Publish(const base::FilePath& path,
             std::string_view bytes,
             std::string_view magic) {
  std::string previous;
  if (base::ReadFileToStringWithMaxSize(path, &previous, kMaxCacheBytes) &&
      Valid(previous, magic) &&
      !base::ImportantFileWriter::WriteFileAtomically(
          path.AddExtensionASCII("previous"), previous))
    return false;
  return base::ImportantFileWriter::WriteFileAtomically(path, bytes);
}
bool IsDigest(std::string_view digest) {
  return digest.size() == 2 * crypto::hash::kSha256Size &&
         std::ranges::all_of(digest, [](char c) {
           return base::IsAsciiDigit(c) || (c >= 'a' && c <= 'f');
         });
}

struct EngineFile {
  std::string key;
  std::vector<Source> sources;
  std::string engine;
};
// Layout after the verified prefix: u32 header size | header pickle | engine.
std::optional<EngineFile> ReadEngineFile(const base::FilePath& path,
                                         const std::vector<Source>& catalog,
                                         bool with_engine) {
  if (path.empty())
    return std::nullopt;
  std::string bytes;
  if (!base::ReadFileToStringWithMaxSize(path, &bytes, kMaxCacheBytes) ||
      !Valid(bytes, kEngineMagic) || bytes.size() < kPrefix + 4)
    return std::nullopt;
  const size_t header_size = base::U32FromLittleEndian(
      base::as_byte_span(bytes).subspan(kPrefix).first<4u>());
  const size_t engine_at = kPrefix + 4 + header_size;
  if (header_size > bytes.size() || engine_at >= bytes.size())
    return std::nullopt;
  auto pickle = base::Pickle::WithUnownedBuffer(
      base::as_byte_span(bytes).subspan(kPrefix + 4, header_size));
  base::PickleIterator reader(pickle);
  EngineFile file;
  std::string version;
  int count = 0;
  if (!reader.ReadString(&version) || version != kCacheVersion ||
      !reader.ReadString(&file.key) || !IsDigest(file.key) ||
      !reader.ReadInt(&count) || count < 1 || count > 64 ||
      static_cast<size_t>(count) != catalog.size())
    return std::nullopt;
  file.sources = catalog;
  for (auto& source : file.sources) {
    std::string id;
    int expires = 0;
    if (!reader.ReadString(&id) || id != source.id ||
        !reader.ReadString(&source.revision) || source.revision.size() > 256 ||
        !reader.ReadString(&source.digest) || !IsDigest(source.digest) ||
        !reader.ReadDouble(&source.retrieved_at) || !reader.ReadInt(&expires) ||
        expires < 1 || expires > 168)
      return std::nullopt;
    source.expires_hours = expires;
    source.text.clear();
    source.text_loaded = false;
    source.cached_text = true;
  }
  if (with_engine) {
    // Reuse the file buffer for the engine bytes instead of copying 8 MiB.
    bytes.erase(0, engine_at);
    file.engine = std::move(bytes);
  }
  return file;
}
bool ReadCache(const base::FilePath& path, Bundle* bundle, bool with_engine) {
  auto file = ReadEngineFile(path, bundle->sources, with_engine);
  if (!file)
    return false;
  bundle->sources = std::move(file->sources);
  bundle->cache = std::move(file->engine);
  bundle->cache_key = std::move(file->key);
  bundle->from_cache = true;
  return true;
}
std::map<std::string, std::string> ReadListsFile(const base::FilePath& path) {
  std::map<std::string, std::string> texts;
  std::string bytes;
  if (path.empty() ||
      !base::ReadFileToStringWithMaxSize(path, &bytes, kMaxCacheBytes) ||
      !Valid(bytes, kListsMagic))
    return texts;
  auto pickle =
      base::Pickle::WithUnownedBuffer(base::as_byte_span(bytes).subspan(kPrefix));
  base::PickleIterator reader(pickle);
  std::string version;
  int count = 0;
  if (!reader.ReadString(&version) || version != kCacheVersion ||
      !reader.ReadInt(&count) || count < 1 || count > 64)
    return texts;
  for (int i = 0; i < count; ++i) {
    std::string id, text;
    if (!reader.ReadString(&id) || !reader.ReadString(&text) ||
        text.size() > 16 * 1024 * 1024)
      return {};
    texts[std::move(id)] = std::move(text);
  }
  return texts;
}
}  // namespace

base::FilePath ListsPath(const base::FilePath& engine_path) {
  return engine_path.empty() ? base::FilePath()
                             : engine_path.AddExtensionASCII("lists");
}

std::string TextDigest(std::string_view text) {
  return base::ToLowerASCII(
      base::HexEncode(crypto::hash::Sha256(base::as_byte_span(text))));
}

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
  // Metadata only: each source contributes its id, text digest and trust mask,
  // so startup can identify a cached engine without reading any list text.
  std::string identity = kCacheVersion;
  for (auto& source : bundle.sources) {
    if (source.digest.empty() && source.text_loaded)
      source.digest = TextDigest(source.text);
    identity += base::NumberToString(source.id.size()) + ":" + source.id;
    identity += source.digest;
    identity += static_cast<char>(source.permissions);
  }
  identity += TextDigest(bundle.resources);
  bundle.key = TextDigest(identity);
  return bundle;
}

bool AllTextsLoaded(const std::vector<Source>& sources) {
  return std::ranges::all_of(sources,
                             [](const Source& s) { return s.text_loaded; });
}

bool LoadSourceTexts(std::vector<Source>& sources,
                     const base::FilePath& lists_path) {
  if (AllTextsLoaded(sources))
    return true;
  std::map<std::string, std::string> cached;
  if (std::ranges::any_of(sources, [](const Source& s) {
        return !s.text_loaded && s.cached_text;
      })) {
    cached = ReadListsFile(lists_path);
    // A write interrupted between the two files leaves the previous lists.
    if (cached.empty())
      cached = ReadListsFile(lists_path.empty()
                                 ? lists_path
                                 : lists_path.AddExtensionASCII("previous"));
  }
  for (auto& source : sources) {
    if (source.text_loaded)
      continue;
    if (source.cached_text) {
      auto found = cached.find(source.id);
      if (found != cached.end() && base::IsStringUTF8(found->second) &&
          TextDigest(found->second) == source.digest) {
        source.text = std::move(found->second);
        source.text_loaded = true;
        continue;
      }
      // The cached copy is missing or does not match its recorded digest.
      // Fall back to the application snapshot; the updater refreshes it.
      source.cached_text = false;
      source.revision = "bundled";
      source.retrieved_at = 0;
    }
    if (source.asset.empty())
      return false;
    source.text = ReadBundledAsset(source.asset);
    if (source.text.empty())
      return false;
    source.digest = TextDigest(source.text);
    source.expires_hours =
        SourceExpiryHours(source.text, source.expires_hours);
    source.text_loaded = true;
  }
  return true;
}

Bundle LoadBundle(base::FilePath read_cache,
                  base::FilePath write_cache,
                  std::vector<std::string> groups,
                  bool with_engine) {
  Bundle bundle;
  bundle.cache_path = std::move(write_cache);
  bundle.lists_path = ListsPath(read_cache);
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
    const auto* digest = data.FindString("sha256");
    if (!id || !file || !group || !url || !digest || !IsDigest(*digest))
      return {};
    if (std::ranges::find(groups, *group) == groups.end())
      continue;
    // Catalog metadata only. Bundled text is decompressed on demand, when an
    // engine must be built or an update compares rule counts.
    Source source;
    source.id = *id;
    source.asset = *file;
    source.text_loaded = false;
    source.permissions = data.FindInt("permissions").value_or(0);
    source.group = *group;
    source.update_url = GURL(*url);
    source.expires_hours = data.FindInt("expires_hours").value_or(6);
    source.minimum_rules = data.FindInt("minimum_rules").value_or(1);
    source.revision =
        data.FindString("revision") ? *data.FindString("revision") : "bundled";
    source.digest = *digest;
    source.retrieved_at = data.FindDouble("retrieved_at").value_or(0);
    bundle.sources.push_back(std::move(source));
  }
  bundle.resources = ReadBundledAsset("resources.json");
  bundle.bundled_sources = bundle.sources;
  // Reading the previous complete snapshot handles an interrupted publication.
  if (!ReadCache(read_cache, &bundle, with_engine) && !read_cache.empty())
    ReadCache(read_cache.AddExtensionASCII("previous"), &bundle, with_engine);
  bundle = IdentifyBundle(std::move(bundle));
  // An app update that changes resources or the engine configuration makes the
  // serialized engine unusable even though its metadata parsed.
  if (bundle.from_cache && bundle.cache_key != bundle.key)
    bundle.cache.clear();
  return bundle;
}

bool SaveBundleCache(const Bundle& bundle) {
  if (bundle.cache_path.empty())
    return true;
  if (bundle.key.empty() || bundle.sources.empty())
    return false;
  // Lists first: a crash between the writes leaves engine metadata whose
  // digests still match either this or the previous lists snapshot.
  if (AllTextsLoaded(bundle.sources)) {
    base::Pickle lists;
    lists.WriteString(kCacheVersion);
    lists.WriteInt(static_cast<int>(bundle.sources.size()));
    for (const auto& source : bundle.sources) {
      lists.WriteString(source.id);
      lists.WriteString(source.text);
    }
    if (lists.size() + kPrefix > kMaxCacheBytes ||
        !base::CreateDirectory(bundle.cache_path.DirName()) ||
        !Publish(ListsPath(bundle.cache_path),
                 Wrap(kListsMagic, PickleView(lists)), kListsMagic))
      return false;
  }
  std::string engine_storage;
  std::string_view engine = bundle.cache;
  if (engine.empty()) {
    // Metadata-only refresh (for example new retrieval times after unchanged
    // downloads): keep the existing engine when it has the same identity.
    auto existing = ReadEngineFile(bundle.cache_path, bundle.sources, true);
    if (!existing || existing->key != bundle.key)
      return false;
    engine_storage = std::move(existing->engine);
    engine = engine_storage;
  }
  base::Pickle header;
  header.WriteString(kCacheVersion);
  header.WriteString(bundle.key);
  header.WriteInt(static_cast<int>(bundle.sources.size()));
  for (const auto& source : bundle.sources) {
    header.WriteString(source.id);
    header.WriteString(source.revision);
    header.WriteString(source.digest);
    header.WriteDouble(source.retrieved_at);
    header.WriteInt(static_cast<int>(std::clamp(source.expires_hours, 1u, 168u)));
  }
  const auto header_bytes = PickleView(header);
  std::string payload;
  payload.reserve(4 + header_bytes.size() + engine.size());
  const auto size =
      base::U32ToLittleEndian(static_cast<uint32_t>(header_bytes.size()));
  payload.append(reinterpret_cast<const char*>(size.data()), size.size());
  payload.append(header_bytes);
  payload.append(engine);
  if (payload.size() + kPrefix > kMaxCacheBytes ||
      !base::CreateDirectory(bundle.cache_path.DirName()))
    return false;
  return Publish(bundle.cache_path, Wrap(kEngineMagic, payload), kEngineMagic);
}
}  // namespace merlin_adblock
