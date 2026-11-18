#!/usr/bin/env bash
# Creates Merlin's self-signed code-signing identity, once, for every release.
#
#   scripts/create_signing_identity.sh /Volumes/Backup/merlin-signing.p12
#   MERLIN_SIGN_KEYCHAIN=/path/test.keychain-db scripts/create_signing_identity.sh backup.p12
#
# An ad-hoc signature's designated requirement is the hash of the code itself,
# so every new build looks like a different app to macOS: the keychain asks
# again about "Chromium Safe Storage" (the key to saved passwords) and camera, microphone
# and other privacy grants reset. Signed with the same certificate every
# time, the requirement names the certificate instead and stays the same.
# Gatekeeper treats a self-signed app like an ad-hoc one (Open Anyway), so
# installing works as before. No Apple account is involved.
#
# Writes the identity into the login keychain (or MERLIN_SIGN_KEYCHAIN) and
# a password-protected .p12 backup to the path given, which belongs offline
# (docs/RELEASE.md, "Signing identity"). Asks for the backup's password.
# Refuses to replace an identity that already exists: a new one changes the
# requirement again, once, for everyone.
set -euo pipefail
NAME="${MERLIN_SIGN_IDENTITY:-Merlin Release Signing}"
KEYCHAIN="${MERLIN_SIGN_KEYCHAIN:-$HOME/Library/Keychains/login.keychain-db}"
backup="${1:?usage: create_signing_identity.sh <backup.p12, on offline storage>}"

die() { echo "create_signing_identity: $*" >&2; exit 1; }
[[ ! -e "$backup" ]] || die "$backup already exists"
if security find-certificate -c "$NAME" "$KEYCHAIN" >/dev/null 2>&1; then
  die "\"$NAME\" is already in $KEYCHAIN; keep using it (a new one resets every user's grants)"
fi

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
cat > "$work/openssl.cnf" <<CNF
[req]
distinguished_name = dn
x509_extensions = ext
prompt = no
[dn]
CN = $NAME
[ext]
basicConstraints = critical, CA:false
keyUsage = critical, digitalSignature
extendedKeyUsage = critical, codeSigning
subjectKeyIdentifier = hash
CNF
# 20 years: the certificate's expiry is not checked for an untrusted root,
# but a long one avoids a forced change.
openssl req -x509 -newkey rsa:3072 -sha256 -days 7300 -nodes \
  -config "$work/openssl.cnf" -keyout "$work/key.pem" -out "$work/cert.pem" 2>/dev/null
if [[ -n "${MERLIN_SIGN_BACKUP_PASSWORD:-}" ]]; then
  password="$MERLIN_SIGN_BACKUP_PASSWORD"
else
  read -rs -p "Password for the backup $backup: " password; echo
  read -rs -p "Again: " again; echo
  [[ "$password" == "$again" ]] || die "the passwords differ"
fi
[[ -n "$password" ]] || die "the backup needs a password"
# -legacy: macOS's security tool reads only the older PKCS#12 encryption.
legacy=(); openssl pkcs12 -help 2>&1 | grep -q -- -legacy && legacy=(-legacy)
openssl pkcs12 -export "${legacy[@]}" -inkey "$work/key.pem" -in "$work/cert.pem" \
  -name "$NAME" -passout "pass:$password" -out "$work/identity.p12"
security import "$work/identity.p12" -k "$KEYCHAIN" -P "$password" -T /usr/bin/codesign >/dev/null
cp "$work/identity.p12" "$backup"
chmod 600 "$backup"
sha1="$(openssl x509 -in "$work/cert.pem" -noout -fingerprint -sha1 | sed 's/.*=//; s/://g')"
echo "Created \"$NAME\" in $KEYCHAIN (certificate SHA-1 $sha1)."
echo "Backup: $backup. Move it to offline storage and keep its password apart."
echo "Package with: MERLIN_SIGN_IDENTITY=\"$NAME\" scripts/package_mac.sh"
