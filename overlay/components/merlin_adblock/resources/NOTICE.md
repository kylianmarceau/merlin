# Native blocker data

`manifest.json` pins each list, resource source revision, digest, permissions,
retrieval date, license and HTTPS update endpoint. The text files and JSON are
the offline release snapshot; they are distributed with the application. Lists
are independently selectable data. The sources and their notices remain under
their upstream licenses; Merlin's wrapper does not relicense them.

* Brave `adblock` 0.13.3 and `adblock-resources`: MPL-2.0. Preserve the notices
  here and Chromium's generated `README.chromium` and third-party credits.
* uBlock Origin resources and uAssets lists: GPL-3.0-or-later. Exact source
  archives, revisions and digests are in the manifest; the source adapter is
  `scripts/build_adblock_resources.mjs`. Ship these source pointers and GPL
  notices with the app. Resources are independently interpreted JavaScript
  assets; they are not statically compiled into the Rust engine.
* EasyList/EasyPrivacy: distributed under their GPL-3.0-or-later option. See
  https://easylist.to/pages/licence.html and the notices retained in each list.
  The GPL text is included in `licenses/uAssets-GPL-3.0.txt`.
* SeaHash 4.1.0's crate omits its MIT text. The upstream notice was recovered
  from https://gitlab.redox-os.org/redox-os/seahash/raw/master/LICENSE on
  2026-11-01 and is preserved as `licenses/SeaHash-MIT.txt`; the crate manifest
  names its authors and MIT license. No Rust engine source was modified.
* Servo `selectors` 0.32.0 is MPL-2.0 and omits the standard license text from its published crate. The full MPL text is supplied through `licenses/adblock-MPL-2.0.txt`; original Servo source notices remain intact. Its CSS parser dependencies are enumerated with exact versions/digests in `build/adblock/crates.json` and gnrt generates their distribution credits.
* FlatBuffers' crate omits its Apache notice. Chromium's existing
  `third_party/flatbuffers/src/LICENSE` supplies it to gnrt's credits metadata.

Resource aliases, dependencies, trust masks and execution worlds are preserved
by the adapter. Function dependencies are inert declarations usable in both
worlds. Scriptlets execute only in the world named by their metadata. The
browser never downloads executable resources outside an application release.
Unknown worlds, cyclic/missing dependencies and malformed base64 reject a
generation. Rules cannot request arbitrary JavaScript URLs.

The engine does not support parameterized uBlock replacement resources; the
adapter excludes those entries. Unsupported filter syntax is counted during
generation construction and must be reviewed when qualifying list upgrades.
