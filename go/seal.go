package spdf

import (
	"context"
	"crypto/ed25519"
	"database/sql"
	"encoding/base64"
	"encoding/hex"
	"fmt"
	"os"
	"strings"
)

// Seal writes spdf_meta.content_sha256 of an existing SPDF 5.0 file and, if
// key is not nil, its Ed25519 signature (signer and signature), in place
// (SPEC §8). Without a key, any previous signature is removed, since it
// would no longer match.
func Seal(path string, key ed25519.PrivateKey) error {
	f, err := Open(path, nil)
	if err != nil {
		return err
	}
	if f.legacy || f.gzipped {
		f.Close()
		return fmt.Errorf("spdf: only uncompressed SPDF 5.x files can be sealed")
	}
	sum, err := f.ContentSHA256()
	f.Close()
	if err != nil {
		return err
	}
	db, err := sql.Open("sqlite", sqliteURI(path)+"?_pragma=trusted_schema(0)&_defensive=1")
	if err != nil {
		return err
	}
	defer db.Close()
	ctx := context.Background()
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	set := func(k, v string) error {
		_, err := tx.ExecContext(ctx, "INSERT INTO spdf_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", k, v)
		return err
	}
	if err := set("content_sha256", sum); err != nil {
		tx.Rollback()
		return err
	}
	if key != nil {
		if len(key) != ed25519.PrivateKeySize {
			tx.Rollback()
			return fmt.Errorf("spdf: invalid Ed25519 private key")
		}
		pub := key.Public().(ed25519.PublicKey)
		if err := set("signer", "ed25519:"+base64.StdEncoding.EncodeToString(pub)); err != nil {
			tx.Rollback()
			return err
		}
		if err := set("signature", base64.StdEncoding.EncodeToString(ed25519.Sign(key, []byte(SignaturePrefix+sum)))); err != nil {
			tx.Rollback()
			return err
		}
	} else if _, err := tx.ExecContext(ctx, "DELETE FROM spdf_meta WHERE key IN ('signer', 'signature')"); err != nil {
		tx.Rollback()
		return err
	}
	return tx.Commit()
}

// ReadSigningKey reads an Ed25519 key from a file holding the 32-byte seed,
// raw or as hex or base64 text.
func ReadSigningKey(path string) (ed25519.PrivateKey, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	if len(data) == ed25519.SeedSize {
		return ed25519.NewKeyFromSeed(data), nil
	}
	text := strings.TrimSpace(string(data))
	if b, err := hex.DecodeString(text); err == nil && len(b) == ed25519.SeedSize {
		return ed25519.NewKeyFromSeed(b), nil
	}
	if b, err := base64.StdEncoding.DecodeString(text); err == nil && len(b) == ed25519.SeedSize {
		return ed25519.NewKeyFromSeed(b), nil
	}
	return nil, fmt.Errorf("spdf: %s does not hold a 32-byte Ed25519 seed (raw, hex or base64)", path)
}
