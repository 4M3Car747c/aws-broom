package api

import (
	"errors"
	"fmt"
	"net/http"
	"regexp"
	"runtime/debug"
	"strings"
	"time"

	"github.com/4M3Car747c/aws-broom/internal/awsx"
	"github.com/4M3Car747c/aws-broom/internal/catalog"
	"github.com/4M3Car747c/aws-broom/internal/engine"
	"github.com/4M3Car747c/aws-broom/internal/jobs"
	"github.com/4M3Car747c/aws-broom/internal/session"
)

var (
	accessKeyRe = regexp.MustCompile(`^[A-Z0-9]{16,128}$`)
	regionRe    = regexp.MustCompile(`^[a-z]{2}(-[a-z]+)+-\d$`)
	accountRe   = regexp.MustCompile(`^\d{12}$`)
)

// ---- catalog ----

func (s *Server) handleCatalog(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{
		"services": catalog.Services(),
		"version":  engine.Version,
		"engine":   engineVersion(),
	})
}

// engineVersion reports the cloud-nuke module version compiled into this binary.
func engineVersion() string {
	if info, ok := debug.ReadBuildInfo(); ok {
		for _, dep := range info.Deps {
			if dep.Path == "github.com/gruntwork-io/cloud-nuke" {
				return "cloud-nuke " + dep.Version
			}
		}
	}
	return "cloud-nuke"
}

// ---- sessions ----

type createSessionRequest struct {
	AccessKeyID     string `json:"accessKeyId"`
	SecretAccessKey string `json:"secretAccessKey"`
	SessionToken    string `json:"sessionToken"`
}

// tokenHeader opts a client into receiving the session token in the JSON
// body (for command-line use with Authorization: Bearer). The browser never
// sends it, so the HttpOnly cookie stays the only copy of the token there.
const tokenHeader = "X-Broom-Token"

type sessionResponse struct {
	SessionID   string    `json:"sessionId,omitempty"`
	AccountID   string    `json:"accountId"`
	ARN         string    `json:"arn"`
	UserID      string    `json:"userId"`
	IAMUserName string    `json:"iamUserName,omitempty"`
	Principal   string    `json:"principal,omitempty"`
	IsTemporary bool      `json:"isTemporary"`
	ExpiresAt   time.Time `json:"expiresAt"`
}

func (s *Server) handleCreateSession(w http.ResponseWriter, r *http.Request) {
	if !s.limiter.Allow(clientIP(r)) {
		writeError(w, http.StatusTooManyRequests, "rate_limited", "too many attempts, try again in a minute")
		return
	}
	var req createSessionRequest
	if !decodeJSON(w, r, &req) {
		return
	}
	req.AccessKeyID = strings.TrimSpace(req.AccessKeyID)
	req.SecretAccessKey = strings.TrimSpace(req.SecretAccessKey)
	req.SessionToken = strings.TrimSpace(req.SessionToken)
	if !accessKeyRe.MatchString(req.AccessKeyID) || len(req.SecretAccessKey) < 16 {
		writeError(w, http.StatusBadRequest, "invalid_credentials", "access key id or secret looks malformed")
		return
	}
	creds := awsx.Credentials{AccessKeyID: req.AccessKeyID, SecretAccessKey: req.SecretAccessKey, SessionToken: req.SessionToken}
	req = createSessionRequest{}

	id, err := s.cfg.Identity(r.Context(), creds, "")
	if err != nil {
		s.log.Info("credential check failed", "ip", clientIP(r), "err", sanitizeErr(err))
		writeError(w, http.StatusUnauthorized, "aws_auth_failed", "AWS rejected the credentials: "+sanitizeErr(err))
		return
	}
	sess, err := s.cfg.Sessions.Create(creds, id)
	creds.Zero()
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal", "could not create session")
		return
	}
	setSessionCookie(w, r, sess.ID, sess.ExpiresAt)
	s.log.Info("session created", "account", id.AccountID, "temporary", credsTemporary(sess))
	writeJSON(w, http.StatusCreated, s.sessionResponse(r, sess))
}

func (s *Server) sessionResponse(r *http.Request, sess *session.Session) sessionResponse {
	id := sess.Identity
	resp := sessionResponse{
		AccountID: id.AccountID, ARN: id.ARN, UserID: id.UserID,
		IAMUserName: id.IAMUserName, Principal: id.Principal, IsTemporary: credsTemporary(sess), ExpiresAt: sess.ExpiresAt,
	}
	if r.Header.Get(tokenHeader) != "" {
		resp.SessionID = sess.ID
	}
	return resp
}

func credsTemporary(sess *session.Session) bool {
	c, err := sess.Credentials()
	if err != nil {
		return false
	}
	return c.IsTemporary()
}

func (s *Server) handleGetSession(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, s.sessionResponse(r, sessionFrom(r)))
}

func (s *Server) handleDeleteSession(w http.ResponseWriter, r *http.Request) {
	sess := sessionFrom(r)
	s.cfg.Sessions.Delete(sess.ID)
	clearSessionCookie(w, r)
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handleRegions(w http.ResponseWriter, r *http.Request) {
	sess := sessionFrom(r)
	creds, err := sess.Credentials()
	if err != nil {
		writeError(w, http.StatusUnauthorized, "session_expired", "session expired")
		return
	}
	regions, err := s.cfg.Regions(r.Context(), creds, sess.Identity.Partition)
	creds.Zero()
	if err != nil {
		writeError(w, http.StatusBadGateway, "aws_error", "could not list regions: "+sanitizeErr(err))
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"regions": regions})
}

// ---- scans ----

type createScanRequest struct {
	Regions        []string `json:"regions"`
	ResourceTypes  []string `json:"resourceTypes"`
	OlderThanHours *int     `json:"olderThanHours,omitempty"`
}

func (s *Server) handleCreateScan(w http.ResponseWriter, r *http.Request) {
	sess := sessionFrom(r)
	var req createScanRequest
	if !decodeJSON(w, r, &req) {
		return
	}
	regions, types, msg := validateScanInputs(req.Regions, req.ResourceTypes)
	if msg != "" {
		writeError(w, http.StatusBadRequest, "bad_request", msg)
		return
	}
	spec := engine.Spec{
		Mode: engine.ModeScan, Regions: regions, ResourceTypes: types,
		ExcludeIAMUserName: sess.Identity.IAMUserName,
	}
	if req.OlderThanHours != nil {
		h := *req.OlderThanHours
		if h <= 0 || h > 24*365 {
			writeError(w, http.StatusBadRequest, "bad_request", "olderThanHours must be between 1 and 8760")
			return
		}
		spec.OlderThan = &engine.Duration{Duration: time.Duration(h) * time.Hour}
	}
	s.startJob(w, r, sess, spec)
}

func validateScanInputs(regions, types []string) ([]string, []string, string) {
	if len(types) == 0 {
		return nil, nil, "select at least one resource type"
	}
	seenR := map[string]bool{}
	var outR []string
	for _, reg := range regions {
		if !regionRe.MatchString(reg) {
			return nil, nil, fmt.Sprintf("invalid region %q", reg)
		}
		if !seenR[reg] {
			seenR[reg] = true
			outR = append(outR, reg)
		}
	}
	seenT := map[string]bool{}
	var outT []string
	hasRegional := false
	for _, t := range types {
		rt, ok := catalog.Lookup(t)
		if !ok {
			return nil, nil, fmt.Sprintf("unknown resource type %q", t)
		}
		if !rt.Global {
			hasRegional = true
		}
		if !seenT[t] {
			seenT[t] = true
			outT = append(outT, t)
		}
	}
	if hasRegional && len(outR) == 0 {
		return nil, nil, "select at least one region for regional resource types"
	}
	if len(outR) == 0 {
		// Only global types selected: still need a session region for the global client.
		outR = []string{"us-east-1"}
	}
	if len(outR) > 40 || len(outT) > 200 {
		return nil, nil, "too many regions or resource types"
	}
	return outR, outT, ""
}

// ---- nukes ----

type createNukeRequest struct {
	ScanJobID        string             `json:"scanJobId"`
	ConfirmAccountID string             `json:"confirmAccountId"`
	Selections       []engine.Selection `json:"selections"`
}

func (s *Server) handleCreateNuke(w http.ResponseWriter, r *http.Request) {
	sess := sessionFrom(r)
	var req createNukeRequest
	if !decodeJSON(w, r, &req) {
		return
	}
	if !accountRe.MatchString(req.ConfirmAccountID) || req.ConfirmAccountID != sess.Identity.AccountID {
		writeError(w, http.StatusBadRequest, "account_mismatch", "confirmation account id does not match the signed-in account")
		return
	}
	if len(req.Selections) == 0 {
		writeError(w, http.StatusBadRequest, "bad_request", "no resources selected")
		return
	}
	if len(req.Selections) > 20000 {
		writeError(w, http.StatusBadRequest, "bad_request", "too many selections in one request")
		return
	}
	scan, err := s.cfg.Jobs.Get(req.ScanJobID)
	if err != nil || scan.SessionID != sess.ID || scan.Spec.Mode != engine.ModeScan {
		writeError(w, http.StatusNotFound, "scan_not_found", "scan job not found for this session")
		return
	}
	if scan.State() != jobs.StateSucceeded {
		writeError(w, http.StatusConflict, "scan_not_finished", "scan job has not finished successfully")
		return
	}

	found := scan.Found()
	seen := map[string]bool{}
	regionSet := map[string]bool{}
	typeSet := map[string]bool{}
	var selections []engine.Selection
	for _, sel := range req.Selections {
		key := sel.Key()
		f, ok := found[key]
		if !ok {
			writeError(w, http.StatusBadRequest, "unknown_selection",
				fmt.Sprintf("%s %s in %s was not part of the scan result", sel.ResourceType, sel.Identifier, sel.Region))
			return
		}
		if !f.Nukable {
			writeError(w, http.StatusBadRequest, "not_nukable",
				fmt.Sprintf("%s %s cannot be deleted: %s", sel.ResourceType, sel.Identifier, f.Reason))
			return
		}
		if seen[key] {
			continue
		}
		seen[key] = true
		selections = append(selections, sel)
		typeSet[sel.ResourceType] = true
		if sel.Region != "global" {
			regionSet[sel.Region] = true
		}
	}

	// Rescan only what is needed for the confirmed selections, in the scan's region order.
	var regions []string
	for _, reg := range scan.Spec.Regions {
		if regionSet[reg] {
			regions = append(regions, reg)
		}
	}
	if len(regions) == 0 {
		regions = scan.Spec.Regions[:1]
	}
	var types []string
	for _, t := range scan.Spec.ResourceTypes {
		if typeSet[t] {
			types = append(types, t)
		}
	}
	spec := engine.Spec{
		Mode: engine.ModeNuke, Regions: regions, ResourceTypes: types, Selections: selections,
		OlderThan: scan.Spec.OlderThan, ExcludeIAMUserName: sess.Identity.IAMUserName,
	}
	s.log.Warn("nuke requested", "account", sess.Identity.AccountID, "selections", len(selections), "regions", len(regions), "types", len(types))
	s.startJob(w, r, sess, spec)
}

func (s *Server) startJob(w http.ResponseWriter, r *http.Request, sess *session.Session, spec engine.Spec) {
	sessID, accountID := sess.ID, sess.Identity.AccountID
	creds, err := sess.Credentials()
	if err != nil {
		writeError(w, http.StatusUnauthorized, "session_expired", "session expired")
		return
	}
	job, err := s.cfg.Jobs.Admit(sessID, accountID, spec, s.cfg.MaxJobsPerSession, s.cfg.MaxJobs)
	if err != nil {
		creds.Zero()
		switch {
		case errors.Is(err, jobs.ErrSessionBusy):
			writeError(w, http.StatusConflict, "too_many_jobs", err.Error())
		case errors.Is(err, jobs.ErrServerBusy):
			writeError(w, http.StatusServiceUnavailable, "server_busy", err.Error()+"; try again in a few minutes")
		default:
			writeError(w, http.StatusInternalServerError, "internal", "could not create job")
		}
		return
	}
	err = s.cfg.Supervisor.Start(s.cfg.BaseCtx, job, creds)
	creds.Zero()
	if err != nil {
		job.Fail("could not start worker")
		s.log.Error("start job", "err", err)
		writeError(w, http.StatusInternalServerError, "internal", "could not start worker")
		return
	}
	writeJSON(w, http.StatusAccepted, map[string]any{"jobId": job.ID, "job": job.Snapshot()})
}

// ---- jobs ----

func (s *Server) jobFor(w http.ResponseWriter, r *http.Request) (*jobs.Job, bool) {
	sess := sessionFrom(r)
	job, err := s.cfg.Jobs.Get(r.PathValue("id"))
	if err != nil || job.SessionID != sess.ID {
		writeError(w, http.StatusNotFound, "job_not_found", "job not found")
		return nil, false
	}
	return job, true
}

func (s *Server) handleGetJob(w http.ResponseWriter, r *http.Request) {
	job, ok := s.jobFor(w, r)
	if !ok {
		return
	}
	writeJSON(w, http.StatusOK, job.Snapshot())
}

func (s *Server) handleCancelJob(w http.ResponseWriter, r *http.Request) {
	job, ok := s.jobFor(w, r)
	if !ok {
		return
	}
	if err := s.cfg.Jobs.Cancel(job.ID); err != nil && !errors.Is(err, jobs.ErrNotFound) {
		writeError(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"state": job.State()})
}

// sanitizeErr strips request ids and anything that looks like a key from AWS errors.
func sanitizeErr(err error) string {
	msg := err.Error()
	if i := strings.Index(msg, ", RequestID:"); i > 0 {
		msg = msg[:i]
	}
	msg = strings.ReplaceAll(msg, "\n", " ")
	if len(msg) > 300 {
		msg = msg[:300]
	}
	return msg
}
