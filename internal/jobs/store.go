package jobs

import (
	"context"
	"errors"
	"sync"
	"time"

	"github.com/4M3Car747c/aws-broom/internal/engine"
)

var (
	ErrNotFound    = errors.New("job not found")
	ErrSessionBusy = errors.New("another job is still running for this session")
	ErrServerBusy  = errors.New("the server is running its maximum number of jobs")
)

// Store is the in-memory job registry.
type Store struct {
	retention time.Duration

	mu   sync.RWMutex
	jobs map[string]*Job
}

// NewStore creates a store that forgets finished jobs after retention.
func NewStore(retention time.Duration) *Store {
	return &Store{retention: retention, jobs: map[string]*Job{}}
}

// New registers a queued job without admission checks (tests, tooling).
func (s *Store) New(sessionID, accountID string, spec engine.Spec) *Job {
	j := newJob(sessionID, accountID, spec)
	s.mu.Lock()
	s.jobs[j.ID] = j
	s.mu.Unlock()
	return j
}

// Admit registers a queued job only if the session has fewer than perSession
// non-terminal jobs and the store fewer than global (0 = unlimited). The
// check and the insert happen under one lock so concurrent requests cannot
// exceed either cap.
func (s *Store) Admit(sessionID, accountID string, spec engine.Spec, perSession, global int) (*Job, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	mine, all := 0, 0
	for _, j := range s.jobs {
		if j.State().Terminal() {
			continue
		}
		all++
		if j.SessionID == sessionID {
			mine++
		}
	}
	if perSession > 0 && mine >= perSession {
		return nil, ErrSessionBusy
	}
	if global > 0 && all >= global {
		return nil, ErrServerBusy
	}
	j := newJob(sessionID, accountID, spec)
	s.jobs[j.ID] = j
	return j, nil
}

// Get returns a job by id.
func (s *Store) Get(id string) (*Job, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	j, ok := s.jobs[id]
	if !ok {
		return nil, ErrNotFound
	}
	return j, nil
}

// Cancel stops a running job. It is a no-op for finished jobs.
func (s *Store) Cancel(id string) error {
	j, err := s.Get(id)
	if err != nil {
		return err
	}
	j.mu.Lock()
	cancel := j.cancel
	j.mu.Unlock()
	if cancel != nil {
		cancel()
	} else {
		j.setState(StateCancelled, "cancelled before start")
	}
	return nil
}

// CancelSession cancels every running job of a session (used on logout/expiry).
func (s *Store) CancelSession(sessionID string) {
	s.mu.RLock()
	var ids []string
	for id, j := range s.jobs {
		if j.SessionID == sessionID && !j.State().Terminal() {
			ids = append(ids, id)
		}
	}
	s.mu.RUnlock()
	for _, id := range ids {
		_ = s.Cancel(id)
	}
}

// RunningForSession counts non-terminal jobs for a session.
func (s *Store) RunningForSession(sessionID string) int {
	s.mu.RLock()
	defer s.mu.RUnlock()
	n := 0
	for _, j := range s.jobs {
		if j.SessionID == sessionID && !j.State().Terminal() {
			n++
		}
	}
	return n
}

// RunReaper drops finished jobs older than retention until ctx is done.
func (s *Store) RunReaper(ctx context.Context, every time.Duration) {
	t := time.NewTicker(every)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case now := <-t.C:
			s.mu.Lock()
			for id, j := range s.jobs {
				if fin := j.FinishedAt(); !fin.IsZero() && now.Sub(fin) > s.retention {
					delete(s.jobs, id)
				}
			}
			s.mu.Unlock()
		}
	}
}
