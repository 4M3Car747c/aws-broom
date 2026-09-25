// Package jobs tracks scan/nuke runs in memory and supervises the worker
// subprocess that performs them.
package jobs

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"sync"
	"time"

	"github.com/4M3Car747c/aws-broom/internal/engine"
)

// State is the lifecycle state of a job.
type State string

const (
	StateQueued    State = "queued"
	StateRunning   State = "running"
	StateSucceeded State = "succeeded"
	StateFailed    State = "failed"
	StateCancelled State = "cancelled"
)

// Terminal reports whether the state is final.
func (s State) Terminal() bool {
	return s == StateSucceeded || s == StateFailed || s == StateCancelled
}

const maxLogLines = 2000

// Job is one scan or nuke run.
type Job struct {
	ID        string
	SessionID string
	AccountID string
	Spec      engine.Spec // credentials are never stored here
	CreatedAt time.Time

	mu         sync.RWMutex
	state      State
	startedAt  time.Time
	finishedAt time.Time
	errMsg     string
	seq        int64
	events     []engine.Event
	subs       map[chan engine.Event]struct{}
	logs       []string
	summary    *engine.Summary
	cancel     context.CancelFunc

	// aggregates for snapshots
	found    map[string]*FoundResource
	foundOrd []string
	results  map[string]*DeleteResult
	resOrd   []string
	genErrs  []GeneralError
	phase    string
	scanned  map[string]struct{} // "type|region" pairs that reported scan_progress
}

// FoundResource is a discovered resource.
type FoundResource struct {
	ResourceType string `json:"resourceType"`
	Region       string `json:"region"`
	Identifier   string `json:"identifier"`
	Nukable      bool   `json:"nukable"`
	Reason       string `json:"reason,omitempty"`
}

// DeleteResult is the outcome for one resource in a nuke run.
type DeleteResult struct {
	ResourceType string `json:"resourceType"`
	Region       string `json:"region"`
	Identifier   string `json:"identifier"`
	Success      bool   `json:"success"`
	Warning      bool   `json:"warning,omitempty"`
	Error        string `json:"error,omitempty"`
	Note         string `json:"note,omitempty"`
}

// GeneralError is a scan-level error (e.g. a lister failed for a type).
type GeneralError struct {
	ResourceType string `json:"resourceType"`
	Message      string `json:"message"`
	Error        string `json:"error"`
}

// Snapshot is the JSON view of a job.
type Snapshot struct {
	ID         string          `json:"id"`
	Mode       engine.Mode     `json:"mode"`
	State      State           `json:"state"`
	Phase      string          `json:"phase,omitempty"`
	AccountID  string          `json:"accountId"`
	Spec       engine.Spec     `json:"spec"`
	CreatedAt  time.Time       `json:"createdAt"`
	StartedAt  *time.Time      `json:"startedAt,omitempty"`
	FinishedAt *time.Time      `json:"finishedAt,omitempty"`
	Error      string          `json:"error,omitempty"`
	LastSeq    int64           `json:"lastSeq"`
	Scanned    int             `json:"scanned"` // type×region pairs scanned so far
	Found      []FoundResource `json:"found"`
	Results    []DeleteResult  `json:"results"`
	Errors     []GeneralError  `json:"errors"`
	Summary    *engine.Summary `json:"summary,omitempty"`
	LogTail    []string        `json:"logTail,omitempty"`
}

func newJob(sessionID, accountID string, spec engine.Spec) *Job {
	return &Job{
		ID:        newID(),
		SessionID: sessionID,
		AccountID: accountID,
		Spec:      spec,
		CreatedAt: time.Now(),
		state:     StateQueued,
		subs:      map[chan engine.Event]struct{}{},
		found:     map[string]*FoundResource{},
		results:   map[string]*DeleteResult{},
		scanned:   map[string]struct{}{},
	}
}

// State returns the current state.
func (j *Job) State() State {
	j.mu.RLock()
	defer j.mu.RUnlock()
	return j.state
}

func (j *Job) setState(s State, errMsg string) {
	j.mu.Lock()
	defer j.mu.Unlock()
	if j.state.Terminal() {
		return
	}
	j.state = s
	now := time.Now()
	if s == StateRunning {
		j.startedAt = now
	}
	if s.Terminal() {
		j.finishedAt = now
		j.errMsg = errMsg
		for ch := range j.subs {
			close(ch)
			delete(j.subs, ch)
		}
	}
}

// Fail moves a job that never started into the failed state.
func (j *Job) Fail(msg string) { j.setState(StateFailed, msg) }

// Publish appends an event (assigning the server-side seq) and fans it out.
func (j *Job) Publish(ev engine.Event) {
	j.mu.Lock()
	defer j.mu.Unlock()
	j.seq++
	ev.Seq = j.seq
	if ev.At.IsZero() {
		ev.At = time.Now().UTC()
	}
	j.events = append(j.events, ev)
	j.aggregate(ev)
	for ch := range j.subs {
		select {
		case ch <- ev:
		default:
			// Slow subscriber: drop it; the client will reconnect with Last-Event-ID.
			close(ch)
			delete(j.subs, ch)
		}
	}
}

func (j *Job) aggregate(ev engine.Event) {
	switch ev.Type {
	case engine.EvPhase:
		j.phase = ev.Phase
		if ev.Phase == "rescan" {
			// The nuke run's rescan supersedes anything found earlier.
			j.found = map[string]*FoundResource{}
			j.foundOrd = j.foundOrd[:0]
			j.genErrs = j.genErrs[:0]
		}
	case engine.EvScanProgress:
		j.scanned[ev.ResourceType+"|"+ev.Region] = struct{}{}
	case engine.EvResourceFound:
		key := engine.SelectionKey(ev.ResourceType, ev.Region, ev.Identifier)
		if _, ok := j.found[key]; !ok {
			j.foundOrd = append(j.foundOrd, key)
		}
		j.found[key] = &FoundResource{
			ResourceType: ev.ResourceType, Region: ev.Region, Identifier: ev.Identifier,
			Nukable: ev.Nukable == nil || *ev.Nukable, Reason: ev.Reason,
		}
	case engine.EvGeneralError:
		j.genErrs = append(j.genErrs, GeneralError{ResourceType: ev.ResourceType, Message: ev.Message, Error: ev.Error})
	case engine.EvResourceDeleted:
		key := engine.SelectionKey(ev.ResourceType, ev.Region, ev.Identifier)
		if _, ok := j.results[key]; !ok {
			j.resOrd = append(j.resOrd, key)
		}
		j.results[key] = &DeleteResult{
			ResourceType: ev.ResourceType, Region: ev.Region, Identifier: ev.Identifier,
			Success: ev.Success != nil && *ev.Success, Warning: ev.Warning, Error: ev.Error, Note: ev.Note,
		}
	case engine.EvSummary:
		j.summary = ev.Summary
	case engine.EvLog:
		if len(j.logs) < maxLogLines {
			j.logs = append(j.logs, ev.Message)
		}
	}
}

// Subscribe returns a channel that first replays events with seq > afterSeq
// and then streams live ones. Call the returned func to unsubscribe. The
// channel is closed when the job reaches a terminal state.
func (j *Job) Subscribe(afterSeq int64) (<-chan engine.Event, func()) {
	j.mu.Lock()
	defer j.mu.Unlock()
	backlog := j.events
	if afterSeq > 0 && afterSeq <= int64(len(backlog)) {
		backlog = backlog[afterSeq:]
	}
	ch := make(chan engine.Event, len(backlog)+1024)
	for _, ev := range backlog {
		ch <- ev
	}
	if j.state.Terminal() {
		close(ch)
		return ch, func() {}
	}
	j.subs[ch] = struct{}{}
	return ch, func() {
		j.mu.Lock()
		if _, ok := j.subs[ch]; ok {
			delete(j.subs, ch)
			close(ch)
		}
		j.mu.Unlock()
	}
}

// Found returns the discovered resources (for nuke-request validation).
func (j *Job) Found() map[string]FoundResource {
	j.mu.RLock()
	defer j.mu.RUnlock()
	out := make(map[string]FoundResource, len(j.found))
	for k, v := range j.found {
		out[k] = *v
	}
	return out
}

// Snapshot builds the JSON view.
func (j *Job) Snapshot() Snapshot {
	j.mu.RLock()
	defer j.mu.RUnlock()
	s := Snapshot{
		ID: j.ID, Mode: j.Spec.Mode, State: j.state, Phase: j.phase, AccountID: j.AccountID,
		Spec: j.Spec, CreatedAt: j.CreatedAt, Error: j.errMsg, LastSeq: j.seq,
		Scanned: len(j.scanned), Summary: j.summary,
		Found:   make([]FoundResource, 0, len(j.foundOrd)),
		Results: make([]DeleteResult, 0, len(j.resOrd)),
		Errors:  append(make([]GeneralError, 0, len(j.genErrs)), j.genErrs...),
	}
	if !j.startedAt.IsZero() {
		t := j.startedAt
		s.StartedAt = &t
	}
	if !j.finishedAt.IsZero() {
		t := j.finishedAt
		s.FinishedAt = &t
	}
	for _, k := range j.foundOrd {
		s.Found = append(s.Found, *j.found[k])
	}
	for _, k := range j.resOrd {
		s.Results = append(s.Results, *j.results[k])
	}
	if n := len(j.logs); n > 0 {
		start := n - 50
		if start < 0 {
			start = 0
		}
		s.LogTail = append([]string(nil), j.logs[start:]...)
	}
	return s
}

// FinishedAt returns the finish time (zero if not finished).
func (j *Job) FinishedAt() time.Time {
	j.mu.RLock()
	defer j.mu.RUnlock()
	return j.finishedAt
}

func newID() string {
	b := make([]byte, 12)
	if _, err := rand.Read(b); err != nil {
		panic(err)
	}
	return hex.EncodeToString(b)
}
