package main

import (
	"crypto/ed25519"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"log"
	"os"
	"path/filepath"
)

// identity.go - agent Ed25519 identity key, persisted next to the binary/config.
// deviceId derived deterministically from public key when not configured.
// (Concept adapted from MeshCentral agent signing, Apache-2.0.)

const keyFile = "identity.key"

type Identity struct {
	PrivateKey ed25519.PrivateKey
	PublicHex  string
}

func LoadOrCreateIdentity(dir string) (*Identity, error) {
	p := filepath.Join(dir, keyFile)
	if b, err := os.ReadFile(p); err == nil && len(b) == ed25519.PrivateKeySize {
		priv := ed25519.PrivateKey(b)
		pub, ok := priv.Public().(ed25519.PublicKey)
		if !ok {
			return nil, fmt.Errorf("bad identity key")
		}
		return &Identity{PrivateKey: priv, PublicHex: hex.EncodeToString(pub)}, nil
	}
	_, priv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		return nil, err
	}
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return nil, err
	}
	if err := os.WriteFile(p, priv, 0o600); err != nil {
		return nil, err
	}
	pub, _ := priv.Public().(ed25519.PublicKey)
	log.Printf("generated new agent identity %s", hex.EncodeToString(pub)[:16])
	return &Identity{PrivateKey: priv, PublicHex: hex.EncodeToString(pub)}, nil
}

// deriveDeviceID makes a stable deviceId from the identity public key.
func deriveDeviceID(id *Identity) string {
	h := sha256.Sum256([]byte("vyomdesk-device:" + id.PublicHex))
	return hex.EncodeToString(h[:16])
}
