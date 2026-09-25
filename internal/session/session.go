// Package session keeps user-supplied AWS credentials in memory only.
//
// A session is created after sts:GetCallerIdentity succeeds. It is destroyed
// on explicit logout, after an idle TTL, or when the STS credentials expire.
// Credentials never leave process memory except into a worker subprocess's
// environment.
package session

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"errors"
	"sync"
	"time"

	"github.com/4M3Car747c/aws-broom/internal/awsx"
)

var ErrNotFound = errors.New("session not found or expired")

// Session is one authenticated browser session.
type Session struct {
	ID        string
	Identity  awsx.Identity
	CreatedAt time.Time
	ExpiresAt time.Time // hard expiry (idle TTL is renewed on each touch)

	mu       sync.Mutex
	creds    awsx.Credentials
	lastSeen time.Time
	closed   bool
}

// Credentials returns a copy of the credentials.
func (s *Session) Credentials() (awsx.Credentials, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.closed {
		return awsx.Credentials{}, ErrNotFound
	}
	return s.creds, nil
}

func (s *Session) touch(now time.Time) {
	s.mu.Lock()
	s.lastSeen = now
	s.mu.Unlock()
}

func (s *Session) close() {
	s.mu.Lock()
	s.closed = true
	s.creds.Zero()
	s.mu.Unlock()
}

// Store is an in-memory session registry with idle-TTL reaping.
type Store struct {
	idleTTL time.Duration
	maxTTL  time.Duration
	onClose func(sessionID string)
	busy    func(sessionID string) bool

	mu       sync.RWMutex
	sessions map[string]*Session
}

// NewStore creates a store. onClose (optional) is called whenever a session is
// removed, so the caller can cancel jobs that belong to it.
func NewStore(idleTTL, maxTTL time.Duration, onClose func(sessionID string)) *Store {
	if onClose == nil {
		onClose = func(string) {}
	}
	return &Store{idleTTL: idleTTL, maxTTL: maxTTL, onClose: onClose, busy: func(string) bool { return false }, sessions: map[string]*Session{}}
}

// SetBusy installs a hook that reports whether a session has work in flight.
// A busy session is treated as active: its idle timer keeps being renewed so
// a long scan or cleanup is never killed by the idle TTL. The hard maxTTL
// still applies.
func (st *Store) SetBusy(busy func(sessionID string) bool) {
	if busy != nil {
		st.busy = busy
	}
}

// Touch renews the idle timer of a live session (used by long-lived streams).
func (st *Store) Touch(id string) {
	st.mu.RLock()
	s, ok := st.sessions[id]
	st.mu.RUnlock()
	if ok {
		s.touch(time.Now())
	}
}

// expired reports whether s should be dropped at now, renewing the idle timer
// of busy sessions as a side effect. Callers must not hold s.mu.
func (st *Store) expired(s *Session, now time.Time) bool {
	s.mu.Lock()
	closed, hard, idle := s.closed, now.After(s.ExpiresAt), now.Sub(s.lastSeen) > st.idleTTL
	s.mu.Unlock()
	if closed || hard {
		return true
	}
	if idle && st.busy(s.ID) {
		s.touch(now)
		return false
	}
	return idle
}

// Create registers a new session for validated credentials.
func (st *Store) Create(creds awsx.Credentials, id awsx.Identity) (*Session, error) {
	token, err := newToken()
	if err != nil {
		return nil, err
	}
	now := time.Now()
	s := &Session{
		ID:        token,
		Identity:  id,
		CreatedAt: now,
		ExpiresAt: now.Add(st.maxTTL),
		creds:     creds,
		lastSeen:  now,
	}
	st.mu.Lock()
	st.sessions[token] = s
	st.mu.Unlock()
	return s, nil
}

// Get returns a live session and renews its idle timer.
func (st *Store) Get(id string) (*Session, error) {
	st.mu.RLock()
	s, ok := st.sessions[id]
	st.mu.RUnlock()
	if !ok {
		return nil, ErrNotFound
	}
	now := time.Now()
	if st.expired(s, now) {
		st.Delete(id)
		return nil, ErrNotFound
	}
	s.touch(now)
	return s, nil
}

// Delete closes and removes a session; it is safe to call twice.
func (st *Store) Delete(id string) {
	st.mu.Lock()
	s, ok := st.sessions[id]
	if ok {
		delete(st.sessions, id)
	}
	st.mu.Unlock()
	if ok {
		s.close()
		st.onClose(id)
	}
}

// Len returns the number of live sessions (for metrics/tests).
func (st *Store) Len() int {
	st.mu.RLock()
	defer st.mu.RUnlock()
	return len(st.sessions)
}

// RunReaper deletes idle/expired sessions until ctx is done.
func (st *Store) RunReaper(ctx context.Context, every time.Duration) {
	t := time.NewTicker(every)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case now := <-t.C:
			st.mu.RLock()
			live := make([]*Session, 0, len(st.sessions))
			for _, s := range st.sessions {
				live = append(live, s)
			}
			st.mu.RUnlock()
			var stale []string
			for _, s := range live {
				if st.expired(s, now) {
					stale = append(stale, s.ID)
				}
			}
			for _, id := range stale {
				st.Delete(id)
			}
		}
	}
}

// Close zeroes every session (used on shutdown).
func (st *Store) Close() {
	st.mu.Lock()
	ids := make([]string, 0, len(st.sessions))
	for id := range st.sessions {
		ids = append(ids, id)
	}
	st.mu.Unlock()
	for _, id := range ids {
		st.Delete(id)
	}
}

func newToken() (string, error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(b), nil
}
