package main

import (
	"crypto/tls"
	"crypto/x509"
	"os"
)

// tls.go - agent TLS dial options for wss:// servers.
// VYOM_TLS_CA_PEM  path to a CA/server cert PEM to trust (private CA or
//                  self-signed server cert)
// VYOM_TLS_INSECURE=1  skip verification entirely (development only)

func dialTLSConfig() *tls.Config {
	if os.Getenv("VYOM_TLS_INSECURE") == "1" {
		return &tls.Config{InsecureSkipVerify: true} //nolint:gosec // opt-in dev flag
	}
	if caPath := os.Getenv("VYOM_TLS_CA_PEM"); caPath != "" {
		pem, err := os.ReadFile(caPath)
		if err == nil {
			pool := x509.NewCertPool()
			if pool.AppendCertsFromPEM(pem) {
				return &tls.Config{RootCAs: pool}
			}
		}
	}
	return nil // default: system trust store
}
