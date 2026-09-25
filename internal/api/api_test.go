package api

import (
	"compress/gzip"
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/4M3Car747c/aws-broom/internal/awsx"
	"github.com/4M3Car747c/aws-broom/internal/engine"
	"github.com/4M3Car747c/aws-broom/internal/jobs"
	"github.com/4M3Car747c/aws-broom/internal/session"
)

func newTestServer(t *testing.T) (*Server, *session.Session) {
	t.Helper()
	jobStore := jobs.NewStore(time.Hour)
	sessions := session.NewStore(time.Hour, time.Hour, jobStore.CancelSession)
	sess, err := sessions.Create(awsx.Credentials{AccessKeyID: "AKIAXXXXXXXXXXXXXXXX", SecretAccessKey: "secretsecretsecret"}, awsx.Identity{AccountID: "123456789012", ARN: "arn:aws:iam::123456789012:user/me", IAMUserName: "me"})
	if err != nil {
		t.Fatal(err)
	}
	srv := New(Config{BaseCtx: context.Background(), Sessions: sessions, Jobs: jobStore, Supervisor: &jobs.Supervisor{Executable: "/bin/false"}})
	return srv, sess
}

func do(t *testing.T, srv *Server, method, path, body, token string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(method, path, strings.NewReader(body))
	req.Header.Set(clientHeader, "web")
	req.Header.Set("Content-Type", "application/json")
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	rr := httptest.NewRecorder()
	srv.Handler().ServeHTTP(rr, req)
	return rr
}

func TestCSRFHeaderRequired(t *testing.T) {
	srv, _ := newTestServer(t)
	req := httptest.NewRequest(http.MethodPost, "/api/sessions", strings.NewReader("{}"))
	rr := httptest.NewRecorder()
	srv.Handler().ServeHTTP(rr, req)
	if rr.Code != http.StatusForbidden {
		t.Fatalf("expected 403, got %d", rr.Code)
	}
}

func TestAuthRequired(t *testing.T) {
	srv, _ := newTestServer(t)
	if rr := do(t, srv, http.MethodGet, "/api/session", "", ""); rr.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", rr.Code)
	}
	if rr := do(t, srv, http.MethodGet, "/api/session", "", "bogus"); rr.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", rr.Code)
	}
}

func TestCatalogIsPublic(t *testing.T) {
	srv, _ := newTestServer(t)
	rr := do(t, srv, http.MethodGet, "/api/catalog", "", "")
	if rr.Code != http.StatusOK || !strings.Contains(rr.Body.String(), `"id":"ec2"`) {
		t.Fatalf("catalog: %d %s", rr.Code, rr.Body.String()[:200])
	}
}

func TestScanValidation(t *testing.T) {
	srv, sess := newTestServer(t)
	cases := map[string]int{
		`{"regions":[],"resourceTypes":[]}`:                                    400,
		`{"regions":["nope"],"resourceTypes":["ec2"]}`:                         400,
		`{"regions":["us-east-1"],"resourceTypes":["not-a-type"]}`:             400,
		`{"regions":[],"resourceTypes":["ec2"]}`:                               400, // regional type without region
		`{"regions":["us-east-1"],"resourceTypes":["ec2"],"olderThanHours":0}`: 400,
	}
	for body, want := range cases {
		if rr := do(t, srv, http.MethodPost, "/api/scans", body, sess.ID); rr.Code != want {
			t.Errorf("%s -> %d, want %d (%s)", body, rr.Code, want, rr.Body.String())
		}
	}
}

func TestNukeRejectsWrongAccountAndUnknownSelections(t *testing.T) {
	srv, sess := newTestServer(t)
	// wrong account id
	rr := do(t, srv, http.MethodPost, "/api/nukes", `{"scanJobId":"x","confirmAccountId":"000000000000","selections":[{"resourceType":"ec2","region":"us-east-1","identifier":"i-1"}]}`, sess.ID)
	if rr.Code != http.StatusBadRequest || !strings.Contains(rr.Body.String(), "account_mismatch") {
		t.Fatalf("got %d %s", rr.Code, rr.Body.String())
	}
	// unknown scan
	rr = do(t, srv, http.MethodPost, "/api/nukes", `{"scanJobId":"x","confirmAccountId":"123456789012","selections":[{"resourceType":"ec2","region":"us-east-1","identifier":"i-1"}]}`, sess.ID)
	if rr.Code != http.StatusNotFound {
		t.Fatalf("got %d %s", rr.Code, rr.Body.String())
	}
	// scan exists but selection not in results
	job := srv.cfg.Jobs.New(sess.ID, "123456789012", engine.Spec{Mode: engine.ModeScan, Regions: []string{"us-east-1"}, ResourceTypes: []string{"ec2"}})
	nukable := true
	job.Publish(engine.Event{Type: engine.EvResourceFound, ResourceType: "ec2", Region: "us-east-1", Identifier: "i-1", Nukable: &nukable})
	notNukable := false
	job.Publish(engine.Event{Type: engine.EvResourceFound, ResourceType: "ec2", Region: "us-east-1", Identifier: "i-locked", Nukable: &notNukable, Reason: "termination protection"})
	rr = do(t, srv, http.MethodPost, "/api/nukes", `{"scanJobId":"`+job.ID+`","confirmAccountId":"123456789012","selections":[{"resourceType":"ec2","region":"us-east-1","identifier":"i-1"}]}`, sess.ID)
	if rr.Code != http.StatusConflict { // scan not finished
		t.Fatalf("got %d %s", rr.Code, rr.Body.String())
	}
	finish(job)
	rr = do(t, srv, http.MethodPost, "/api/nukes", `{"scanJobId":"`+job.ID+`","confirmAccountId":"123456789012","selections":[{"resourceType":"ec2","region":"us-east-1","identifier":"i-999"}]}`, sess.ID)
	if rr.Code != http.StatusBadRequest || !strings.Contains(rr.Body.String(), "unknown_selection") {
		t.Fatalf("got %d %s", rr.Code, rr.Body.String())
	}
	rr = do(t, srv, http.MethodPost, "/api/nukes", `{"scanJobId":"`+job.ID+`","confirmAccountId":"123456789012","selections":[{"resourceType":"ec2","region":"us-east-1","identifier":"i-locked"}]}`, sess.ID)
	if rr.Code != http.StatusBadRequest || !strings.Contains(rr.Body.String(), "not_nukable") {
		t.Fatalf("got %d %s", rr.Code, rr.Body.String())
	}
}

func TestJobIsolationBetweenSessions(t *testing.T) {
	srv, sess := newTestServer(t)
	other := srv.cfg.Jobs.New("someone-else", "999999999999", engine.Spec{Mode: engine.ModeScan})
	if rr := do(t, srv, http.MethodGet, "/api/jobs/"+other.ID, "", sess.ID); rr.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %d", rr.Code)
	}
}

func TestLogoutCancelsJobsAndClearsCookie(t *testing.T) {
	srv, sess := newTestServer(t)
	rr := do(t, srv, http.MethodDelete, "/api/session", "", sess.ID)
	if rr.Code != http.StatusNoContent {
		t.Fatalf("got %d", rr.Code)
	}
	if c := rr.Header().Get("Set-Cookie"); !strings.Contains(c, "Max-Age=0") {
		t.Fatalf("cookie not cleared: %s", c)
	}
	if rr := do(t, srv, http.MethodGet, "/api/session", "", sess.ID); rr.Code != http.StatusUnauthorized {
		t.Fatalf("session should be gone, got %d", rr.Code)
	}
}

func TestClientIPIgnoresSpoofedForwardedFor(t *testing.T) {
	mk := func(remote, xff string) *http.Request {
		r := httptest.NewRequest(http.MethodGet, "/", nil)
		r.RemoteAddr = remote
		if xff != "" {
			r.Header.Set("X-Forwarded-For", xff)
		}
		return r
	}
	cases := []struct{ remote, xff, want string }{
		{"203.0.113.9:1234", "", "203.0.113.9"},
		{"203.0.113.9:1234", "1.1.1.1", "203.0.113.9"},                // public peer: header ignored
		{"10.0.0.5:1234", "198.51.100.7", "198.51.100.7"},             // proxy on private net
		{"10.0.0.5:1234", "1.1.1.1, 198.51.100.7", "198.51.100.7"},    // rightmost wins
		{"127.0.0.1:1234", "1.1.1.1 , 198.51.100.7 ", "198.51.100.7"}, // whitespace tolerated
	}
	for _, c := range cases {
		if got := clientIP(mk(c.remote, c.xff)); got != c.want {
			t.Errorf("clientIP(%q, %q) = %q, want %q", c.remote, c.xff, got, c.want)
		}
	}
}

func TestSessionTokenOnlyReturnedOnRequest(t *testing.T) {
	srv, sess := newTestServer(t)
	rr := do(t, srv, http.MethodGet, "/api/session", "", sess.ID)
	if rr.Code != http.StatusOK || strings.Contains(rr.Body.String(), "sessionId") {
		t.Fatalf("browser response must not carry the token: %d %s", rr.Code, rr.Body.String())
	}
	req := httptest.NewRequest(http.MethodGet, "/api/session", nil)
	req.Header.Set("Authorization", "Bearer "+sess.ID)
	req.Header.Set(tokenHeader, "1")
	rr = httptest.NewRecorder()
	srv.Handler().ServeHTTP(rr, req)
	if !strings.Contains(rr.Body.String(), `"sessionId":"`+sess.ID+`"`) {
		t.Fatalf("CLI opt-in should return the token: %s", rr.Body.String())
	}
}

func TestJobAdmissionCaps(t *testing.T) {
	srv, sess := newTestServer(t)
	srv.cfg.MaxJobsPerSession = 1
	srv.cfg.MaxJobs = 2
	body := `{"regions":["us-east-1"],"resourceTypes":["ec2"]}`

	srv.cfg.Jobs.New(sess.ID, sess.Identity.AccountID, engine.Spec{Mode: engine.ModeScan}) // queued = running
	if rr := do(t, srv, http.MethodPost, "/api/scans", body, sess.ID); rr.Code != http.StatusConflict {
		t.Fatalf("per-session cap: expected 409, got %d %s", rr.Code, rr.Body.String())
	}

	other, _ := srv.cfg.Sessions.Create(awsx.Credentials{AccessKeyID: "AKIAYYYYYYYYYYYYYYYY", SecretAccessKey: "secretsecretsecret"}, awsx.Identity{AccountID: "210987654321"})
	srv.cfg.Jobs.New("someone-else", "000000000000", engine.Spec{Mode: engine.ModeScan})
	if rr := do(t, srv, http.MethodPost, "/api/scans", body, other.ID); rr.Code != http.StatusServiceUnavailable {
		t.Fatalf("global cap: expected 503, got %d %s", rr.Code, rr.Body.String())
	}
}

func TestEventsPreferLastEventID(t *testing.T) {
	srv, sess := newTestServer(t)
	job := srv.cfg.Jobs.New(sess.ID, sess.Identity.AccountID, engine.Spec{Mode: engine.ModeScan})
	for i := 1; i <= 3; i++ {
		job.Publish(engine.Event{Type: engine.EvLog, Message: "line"})
	}
	jobs.ForceSucceeded(job)

	req := httptest.NewRequest(http.MethodGet, "/api/jobs/"+job.ID+"/events?after=0", nil)
	req.Header.Set("Authorization", "Bearer "+sess.ID)
	req.Header.Set("Last-Event-ID", "2")
	rr := httptest.NewRecorder()
	srv.Handler().ServeHTTP(rr, req)
	out := rr.Body.String()
	if strings.Contains(out, "id: 1\n") || strings.Contains(out, "id: 2\n") || !strings.Contains(out, "id: 3\n") {
		t.Fatalf("expected only seq 3 to be replayed:\n%s", out)
	}
	if !strings.Contains(out, "event: done") || !strings.Contains(out, `"state":"succeeded"`) {
		t.Fatalf("expected terminal done event:\n%s", out)
	}
}

func TestGzipAndSecurityHeaders(t *testing.T) {
	srv, _ := newTestServer(t)
	req := httptest.NewRequest(http.MethodGet, "/api/catalog", nil)
	req.Header.Set("Accept-Encoding", "gzip, br")
	req.Header.Set("X-Forwarded-Proto", "https")
	rr := httptest.NewRecorder()
	srv.Handler().ServeHTTP(rr, req)
	if rr.Header().Get("Content-Encoding") != "gzip" || rr.Header().Get("Vary") != "Accept-Encoding" {
		t.Fatalf("expected gzip response, headers=%v", rr.Header())
	}
	zr, err := gzip.NewReader(rr.Body)
	if err != nil {
		t.Fatal(err)
	}
	raw, err := io.ReadAll(zr)
	if err != nil || !strings.Contains(string(raw), `"services"`) {
		t.Fatalf("bad gzip body: %v %q", err, raw)
	}
	if rr.Header().Get("Strict-Transport-Security") == "" || rr.Header().Get("Cache-Control") != "no-store" {
		t.Fatalf("missing hardening headers: %v", rr.Header())
	}

	// Event streams must never be compressed.
	req = httptest.NewRequest(http.MethodGet, "/healthz", nil)
	req.Header.Set("Accept-Encoding", "gzip")
	rr = httptest.NewRecorder()
	srv.Handler().ServeHTTP(rr, req)
	if rr.Header().Get("Content-Encoding") != "gzip" || rr.Header().Get("Strict-Transport-Security") != "" {
		t.Fatalf("plain http: %v", rr.Header())
	}
}
