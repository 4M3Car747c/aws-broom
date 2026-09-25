package web

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestContentSecurityPolicyHashesInlineScripts(t *testing.T) {
	index := []byte(`<html><head><script>alert(1)</script><script src="/a.js"></script><script type="module" async>import("/b.js")</script></head></html>`)
	csp := ContentSecurityPolicy(index)
	if strings.Count(csp, "'sha256-") != 2 {
		t.Fatalf("expected two script hashes: %s", csp)
	}
	if !strings.Contains(csp, "frame-ancestors 'none'") || !strings.Contains(csp, "worker-src 'self' blob:") {
		t.Fatalf("policy incomplete: %s", csp)
	}
}

func TestHandlerServesIndexWithCSP(t *testing.T) {
	rr := httptest.NewRecorder()
	Handler().ServeHTTP(rr, httptest.NewRequest(http.MethodGet, "/wizard/regions", nil))
	if rr.Code != http.StatusOK || rr.Header().Get("Content-Security-Policy") == "" {
		t.Fatalf("code=%d headers=%v", rr.Code, rr.Header())
	}
	rr = httptest.NewRecorder()
	Handler().ServeHTTP(rr, httptest.NewRequest(http.MethodGet, "/../../etc/passwd", nil))
	if !strings.Contains(rr.Header().Get("Content-Type"), "text/html") {
		t.Fatalf("traversal attempt should fall back to the SPA document, got %v", rr.Header())
	}
}
