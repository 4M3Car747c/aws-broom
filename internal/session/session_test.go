package session

import (
	"testing"
	"time"

	"github.com/4M3Car747c/aws-broom/internal/awsx"
)

func TestStoreLifecycle(t *testing.T) {
	closed := []string{}
	st := NewStore(50*time.Millisecond, time.Hour, func(id string) { closed = append(closed, id) })
	s, err := st.Create(awsx.Credentials{AccessKeyID: "AKIA", SecretAccessKey: "secret"}, awsx.Identity{AccountID: "123"})
	if err != nil {
		t.Fatal(err)
	}
	if len(s.ID) < 40 {
		t.Fatalf("token too short: %q", s.ID)
	}
	got, err := st.Get(s.ID)
	if err != nil || got != s {
		t.Fatal("expected to find session")
	}
	c, err := s.Credentials()
	if err != nil || c.SecretAccessKey != "secret" {
		t.Fatal("credentials not returned")
	}

	time.Sleep(80 * time.Millisecond)
	if _, err := st.Get(s.ID); err == nil {
		t.Fatal("idle session should have expired")
	}
	if _, err := s.Credentials(); err == nil {
		t.Fatal("credentials must be unavailable after expiry")
	}
	if c, _ := s.Credentials(); c.SecretAccessKey != "" {
		t.Fatal("secret must be zeroed")
	}
	if len(closed) != 1 || closed[0] != s.ID {
		t.Fatalf("onClose not called: %v", closed)
	}
	st.Delete(s.ID) // idempotent
	if st.Len() != 0 {
		t.Fatal("store should be empty")
	}
}

func TestBusySessionNeverIdlesOut(t *testing.T) {
	st := NewStore(20*time.Millisecond, time.Hour, nil)
	busy := true
	st.SetBusy(func(string) bool { return busy })
	s, err := st.Create(awsx.Credentials{AccessKeyID: "AKIA", SecretAccessKey: "x"}, awsx.Identity{AccountID: "1"})
	if err != nil {
		t.Fatal(err)
	}
	time.Sleep(60 * time.Millisecond)
	if _, err := st.Get(s.ID); err != nil {
		t.Fatalf("busy session was reaped: %v", err)
	}
	busy = false
	time.Sleep(60 * time.Millisecond)
	if _, err := st.Get(s.ID); err == nil {
		t.Fatal("idle session should expire once no job is running")
	}
}
