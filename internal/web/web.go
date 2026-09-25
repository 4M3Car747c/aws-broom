// Package web serves the embedded single-page application.
//
// The React Router build output (web/build/client) is copied into internal/web/dist
// by `make web` (or the Dockerfile) before `go build`. Any path that does not match
// a file falls back to index.html so client-side routing works on hard refresh.
package web

import (
	"crypto/sha256"
	"embed"
	"encoding/base64"
	"io/fs"
	"mime"
	"net/http"
	"path"
	"regexp"
	"strings"
)

func init() {
	// Go's built-in table lacks .mjs; module scripts are refused without a JS MIME type.
	_ = mime.AddExtensionType(".mjs", "text/javascript; charset=utf-8")
}

//go:embed all:dist
var distFS embed.FS

var scriptTagRe = regexp.MustCompile(`(?is)<script([^>]*)>(.*?)</script>`)

// ContentSecurityPolicy builds a strict CSP for the SPA document. Inline
// scripts (the theme bootstrap and React Router's hydration stubs) are
// allowed by hash, so the policy stays correct across builds. Styles allow
// inline because MapLibre and Base UI set style attributes at runtime.
func ContentSecurityPolicy(index []byte) string {
	scriptSrc := []string{"'self'"}
	for _, m := range scriptTagRe.FindAllSubmatch(index, -1) {
		if strings.Contains(strings.ToLower(string(m[1])), "src=") || len(m[2]) == 0 {
			continue
		}
		sum := sha256.Sum256(m[2])
		scriptSrc = append(scriptSrc, "'sha256-"+base64.StdEncoding.EncodeToString(sum[:])+"'")
	}
	return strings.Join([]string{
		"default-src 'self'",
		"script-src " + strings.Join(scriptSrc, " "),
		"style-src 'self' 'unsafe-inline'",
		"img-src 'self' data: blob:",
		"font-src 'self' data:", // Vite inlines small font subsets as data: URIs
		"connect-src 'self'",
		"worker-src 'self' blob:",
		"object-src 'none'",
		"base-uri 'self'",
		"form-action 'self'",
		"frame-ancestors 'none'",
	}, "; ")
}

// Handler returns an http.Handler that serves the embedded SPA with an
// index.html fallback. If the build output is missing (development without
// `make web`), it serves a short explanatory page instead of a 404.
func Handler() http.Handler {
	sub, err := fs.Sub(distFS, "dist")
	if err != nil {
		panic(err)
	}
	index, indexErr := fs.ReadFile(sub, "index.html")
	csp := ContentSecurityPolicy(index)
	fileServer := http.FileServerFS(sub)

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet && r.Method != http.MethodHead {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		p := strings.TrimPrefix(path.Clean("/"+r.URL.Path), "/")
		if p == "" {
			p = "index.html"
		}
		if p != "index.html" {
			if f, err := sub.Open(p); err == nil {
				f.Close()
				if strings.HasPrefix(p, "assets/") {
					w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
				}
				fileServer.ServeHTTP(w, r)
				return
			}
		}
		w.Header().Set("Content-Security-Policy", csp)
		if indexErr != nil {
			w.Header().Set("Content-Type", "text/html; charset=utf-8")
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write([]byte("<!doctype html><title>AWS Broom</title><p>Frontend build not embedded. Run <code>make web</code> or use <code>pnpm dev</code> in <code>web/</code>.</p>"))
			return
		}
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.Header().Set("Cache-Control", "no-cache")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write(index)
	})
}
