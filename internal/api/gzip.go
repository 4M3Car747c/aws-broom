package api

import (
	"compress/gzip"
	"io"
	"net/http"
	"strings"
	"sync"
)

// gzipMiddleware compresses compressible responses for clients that accept
// gzip. Event streams, ranged requests and already-encoded responses are left
// alone. It exists because the SPA's biggest chunks (MapLibre, the world
// outline) are several hundred kB raw and not every reverse proxy compresses.
func gzipMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !strings.Contains(r.Header.Get("Accept-Encoding"), "gzip") || r.Header.Get("Range") != "" {
			next.ServeHTTP(w, r)
			return
		}
		w.Header().Add("Vary", "Accept-Encoding")
		gw := &gzipResponseWriter{ResponseWriter: w}
		defer gw.Close()
		next.ServeHTTP(gw, r)
	})
}

var gzipPool = sync.Pool{New: func() any {
	zw, _ := gzip.NewWriterLevel(io.Discard, gzip.BestSpeed)
	return zw
}}

type gzipResponseWriter struct {
	http.ResponseWriter
	zw      *gzip.Writer
	decided bool
}

func compressible(contentType string) bool {
	ct := strings.ToLower(contentType)
	switch {
	case strings.HasPrefix(ct, "text/event-stream"):
		return false
	case strings.HasPrefix(ct, "text/"),
		strings.Contains(ct, "javascript"),
		strings.Contains(ct, "json"),
		strings.Contains(ct, "xml"),
		strings.Contains(ct, "svg"),
		strings.Contains(ct, "wasm"):
		return true
	}
	return false
}

func (g *gzipResponseWriter) decide() {
	if g.decided {
		return
	}
	g.decided = true
	h := g.Header()
	if h.Get("Content-Encoding") != "" || !compressible(h.Get("Content-Type")) {
		return
	}
	h.Del("Content-Length")
	h.Set("Content-Encoding", "gzip")
	g.zw = gzipPool.Get().(*gzip.Writer)
	g.zw.Reset(g.ResponseWriter)
}

func (g *gzipResponseWriter) WriteHeader(status int) {
	if status == http.StatusNoContent || status == http.StatusNotModified {
		g.decided = true
	}
	g.decide()
	g.ResponseWriter.WriteHeader(status)
}

func (g *gzipResponseWriter) Write(b []byte) (int, error) {
	if !g.decided {
		if g.Header().Get("Content-Type") == "" {
			g.Header().Set("Content-Type", http.DetectContentType(b))
		}
		g.decide()
	}
	if g.zw != nil {
		return g.zw.Write(b)
	}
	return g.ResponseWriter.Write(b)
}

// FlushError lets streaming handlers (SSE) push data through; the gzip layer
// is never engaged for them, but be correct anyway.
func (g *gzipResponseWriter) FlushError() error {
	if g.zw != nil {
		if err := g.zw.Flush(); err != nil {
			return err
		}
	}
	return http.NewResponseController(g.ResponseWriter).Flush()
}

// Unwrap exposes the underlying writer to http.ResponseController.
func (g *gzipResponseWriter) Unwrap() http.ResponseWriter { return g.ResponseWriter }

func (g *gzipResponseWriter) Close() {
	if g.zw == nil {
		return
	}
	_ = g.zw.Close()
	g.zw.Reset(io.Discard)
	gzipPool.Put(g.zw)
	g.zw = nil
}
