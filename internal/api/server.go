// Package api exposes the HTTP API consumed by the SPA.
package api

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net"
	"net/http"
	"strings"
	"time"

	"github.com/4M3Car747c/aws-broom/internal/awsx"
	"github.com/4M3Car747c/aws-broom/internal/jobs"
	"github.com/4M3Car747c/aws-broom/internal/session"
)

const (
	cookieName    = "broom_session"
	clientHeader  = "X-Broom-Client" // CSRF guard: mutating requests must carry it
	maxBodyBytes  = 4 * 1024 * 1024  // nuke requests can carry thousands of selections
	sessionCtxKey = ctxKey("session")
)

type ctxKey string

// Config tunes the server.
type Config struct {
	BaseCtx           context.Context // outlives requests; cancelled on shutdown
	Logger            *slog.Logger
	Sessions          *session.Store
	Jobs              *jobs.Store
	Supervisor        *jobs.Supervisor
	SessionRatePerMin int
	MaxJobsPerSession int
	MaxJobs           int // global cap on concurrently running workers (0 = default 8)
	SPA               http.Handler

	// AWS calls made by the server itself; nil selects the real implementations.
	// Injected so a mock server can drive the UI without an AWS account.
	Identity func(ctx context.Context, creds awsx.Credentials, region string) (awsx.Identity, error)
	Regions  func(ctx context.Context, creds awsx.Credentials, partition string) ([]awsx.Region, error)
}

// Server holds handlers and dependencies.
type Server struct {
	cfg     Config
	log     *slog.Logger
	limiter *ipLimiter
	mux     *http.ServeMux
}

// New builds the server and its routes.
func New(cfg Config) *Server {
	if cfg.Logger == nil {
		cfg.Logger = slog.Default()
	}
	if cfg.BaseCtx == nil {
		cfg.BaseCtx = context.Background()
	}
	if cfg.SessionRatePerMin <= 0 {
		cfg.SessionRatePerMin = 10
	}
	if cfg.MaxJobsPerSession <= 0 {
		cfg.MaxJobsPerSession = 2
	}
	if cfg.MaxJobs <= 0 {
		cfg.MaxJobs = 8
	}
	if cfg.Identity == nil {
		cfg.Identity = awsx.GetCallerIdentity
	}
	if cfg.Regions == nil {
		cfg.Regions = awsx.ListEnabledRegions
	}
	s := &Server{cfg: cfg, log: cfg.Logger, limiter: newIPLimiter(cfg.SessionRatePerMin, time.Minute), mux: http.NewServeMux()}
	s.routes()
	return s
}

func (s *Server) routes() {
	m := s.mux
	m.HandleFunc("GET /healthz", func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "text/plain")
		_, _ = w.Write([]byte("ok"))
	})
	m.HandleFunc("GET /api/catalog", s.handleCatalog)
	m.HandleFunc("POST /api/sessions", s.handleCreateSession)
	m.HandleFunc("GET /api/session", s.auth(s.handleGetSession))
	m.HandleFunc("DELETE /api/session", s.auth(s.handleDeleteSession))
	m.HandleFunc("GET /api/session/regions", s.auth(s.handleRegions))
	m.HandleFunc("POST /api/scans", s.auth(s.handleCreateScan))
	m.HandleFunc("POST /api/nukes", s.auth(s.handleCreateNuke))
	m.HandleFunc("GET /api/jobs/{id}", s.auth(s.handleGetJob))
	m.HandleFunc("GET /api/jobs/{id}/events", s.auth(s.handleJobEvents))
	m.HandleFunc("DELETE /api/jobs/{id}", s.auth(s.handleCancelJob))
	m.HandleFunc("/api/", func(w http.ResponseWriter, _ *http.Request) {
		writeError(w, http.StatusNotFound, "not_found", "unknown API route")
	})
	if s.cfg.SPA != nil {
		m.Handle("/", s.cfg.SPA)
	}
}

// Handler returns the root handler with middleware applied.
func (s *Server) Handler() http.Handler {
	return s.securityHeaders(gzipMiddleware(s.csrfGuard(s.mux)))
}

func (s *Server) securityHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		h := w.Header()
		h.Set("X-Content-Type-Options", "nosniff")
		h.Set("X-Frame-Options", "DENY")
		h.Set("Referrer-Policy", "no-referrer")
		h.Set("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
		if isTLS(r) {
			h.Set("Strict-Transport-Security", "max-age=31536000")
		}
		if strings.HasPrefix(r.URL.Path, "/api/") {
			h.Set("Cache-Control", "no-store")
		}
		next.ServeHTTP(w, r)
	})
}

// csrfGuard requires a custom header on state-changing API calls. Browsers
// cannot add it cross-origin without a CORS preflight, which we never allow.
func (s *Server) csrfGuard(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasPrefix(r.URL.Path, "/api/") && r.Method != http.MethodGet && r.Method != http.MethodHead {
			if r.Header.Get(clientHeader) == "" {
				writeError(w, http.StatusForbidden, "csrf", "missing "+clientHeader+" header")
				return
			}
			r.Body = http.MaxBytesReader(w, r.Body, maxBodyBytes)
		}
		next.ServeHTTP(w, r)
	})
}

// auth resolves the session from the cookie or bearer token.
func (s *Server) auth(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		token := ""
		if c, err := r.Cookie(cookieName); err == nil {
			token = c.Value
		}
		if h := r.Header.Get("Authorization"); strings.HasPrefix(h, "Bearer ") {
			token = strings.TrimPrefix(h, "Bearer ")
		}
		if token == "" {
			writeError(w, http.StatusUnauthorized, "unauthorized", "no session")
			return
		}
		sess, err := s.cfg.Sessions.Get(token)
		if err != nil {
			clearSessionCookie(w, r)
			writeError(w, http.StatusUnauthorized, "session_expired", "session not found or expired")
			return
		}
		next(w, r.WithContext(context.WithValue(r.Context(), sessionCtxKey, sess)))
	}
}

func sessionFrom(r *http.Request) *session.Session {
	s, _ := r.Context().Value(sessionCtxKey).(*session.Session)
	return s
}

func setSessionCookie(w http.ResponseWriter, r *http.Request, token string, expires time.Time) {
	http.SetCookie(w, &http.Cookie{
		Name: cookieName, Value: token, Path: "/", HttpOnly: true,
		Secure: isTLS(r), SameSite: http.SameSiteStrictMode, Expires: expires,
	})
}

func clearSessionCookie(w http.ResponseWriter, r *http.Request) {
	http.SetCookie(w, &http.Cookie{
		Name: cookieName, Value: "", Path: "/", HttpOnly: true,
		Secure: isTLS(r), SameSite: http.SameSiteStrictMode, MaxAge: -1,
	})
}

func isTLS(r *http.Request) bool {
	return r.TLS != nil || strings.EqualFold(r.Header.Get("X-Forwarded-Proto"), "https")
}

// clientIP returns the address used for rate limiting. X-Forwarded-For is
// honoured only when the direct peer is a private/loopback address (i.e. a
// reverse proxy on the same host or network), and then the *rightmost* entry
// is used: that is the address the proxy itself observed, whereas earlier
// entries are whatever the client chose to send.
func clientIP(r *http.Request) string {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		host = r.RemoteAddr
	}
	xff := r.Header.Get("X-Forwarded-For")
	if xff == "" || !isPrivateAddr(host) {
		return host
	}
	parts := strings.Split(xff, ",")
	if last := strings.TrimSpace(parts[len(parts)-1]); last != "" {
		return last
	}
	return host
}

func isPrivateAddr(host string) bool {
	ip := net.ParseIP(host)
	return ip != nil && (ip.IsLoopback() || ip.IsPrivate() || ip.IsLinkLocalUnicast())
}

// --- JSON helpers ---

type apiError struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func writeError(w http.ResponseWriter, status int, code, msg string) {
	writeJSON(w, status, map[string]apiError{"error": {Code: code, Message: msg}})
}

func decodeJSON(w http.ResponseWriter, r *http.Request, v any) bool {
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()
	if err := dec.Decode(v); err != nil {
		var maxErr *http.MaxBytesError
		if errors.As(err, &maxErr) {
			writeError(w, http.StatusRequestEntityTooLarge, "too_large", "request body too large")
			return false
		}
		if errors.Is(err, io.EOF) {
			writeError(w, http.StatusBadRequest, "bad_request", "empty body")
			return false
		}
		writeError(w, http.StatusBadRequest, "bad_request", "invalid JSON: "+err.Error())
		return false
	}
	return true
}
