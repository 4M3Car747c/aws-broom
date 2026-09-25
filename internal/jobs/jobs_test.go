package jobs

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/4M3Car747c/aws-broom/internal/awsx"
	"github.com/4M3Car747c/aws-broom/internal/engine"
)

// TestMain doubles as a fake worker: when the test binary is invoked as
// `<binary> worker`, it reads the spec from stdin and behaves according to
// the AWS_ACCESS_KEY_ID it was given.
func TestMain(m *testing.M) {
	if len(os.Args) > 1 && os.Args[1] == "worker" {
		os.Exit(fakeWorker())
	}
	os.Exit(m.Run())
}

func fakeWorker() int {
	var spec engine.Spec
	if err := json.NewDecoder(os.Stdin).Decode(&spec); err != nil {
		return 2
	}
	w := bufio.NewWriter(os.Stdout)
	emit := func(ev engine.Event) {
		b, _ := json.Marshal(ev)
		w.Write(b)
		w.WriteByte('\n')
		w.Flush()
	}
	switch os.Getenv("AWS_ACCESS_KEY_ID") {
	case "HANG":
		emit(engine.Event{Type: engine.EvPhase, Phase: "scan"})
		time.Sleep(time.Minute)
		return 0
	case "FAIL":
		emit(engine.Event{Type: engine.EvFatal, Error: "scan failed: AccessDenied"})
		return 1
	}
	fmt.Fprintln(os.Stderr, "some log line")
	emit(engine.Event{Type: engine.EvPhase, Phase: "scan"})
	nukable := true
	for _, region := range spec.Regions {
		emit(engine.Event{Type: engine.EvScanProgress, ResourceType: "ec2", Region: region})
		emit(engine.Event{Type: engine.EvResourceFound, ResourceType: "ec2", Region: region, Identifier: "i-" + region, Nukable: &nukable})
	}
	emit(engine.Event{Type: engine.EvSummary, Summary: &engine.Summary{Mode: spec.Mode, Found: len(spec.Regions)}})
	return 0
}

func testSupervisor(t *testing.T) *Supervisor {
	t.Helper()
	exe, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	return &Supervisor{Executable: exe, Timeout: 10 * time.Second}
}

func waitTerminal(t *testing.T, j *Job) {
	t.Helper()
	deadline := time.Now().Add(10 * time.Second)
	for time.Now().Before(deadline) {
		if j.State().Terminal() {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatalf("job %s did not finish, state=%s", j.ID, j.State())
}

func TestSupervisorRunsWorkerAndAggregates(t *testing.T) {
	store := NewStore(time.Hour)
	job := store.New("sess", "123456789012", engine.Spec{Mode: engine.ModeScan, Regions: []string{"us-east-1", "eu-west-1"}, ResourceTypes: []string{"ec2"}})
	if err := testSupervisor(t).Start(context.Background(), job, awsx.Credentials{AccessKeyID: "OK", SecretAccessKey: "x"}); err != nil {
		t.Fatal(err)
	}
	waitTerminal(t, job)
	snap := job.Snapshot()
	if snap.State != StateSucceeded {
		t.Fatalf("state = %s err=%s", snap.State, snap.Error)
	}
	if len(snap.Found) != 2 || snap.Scanned != 2 {
		t.Fatalf("found=%d scanned=%d", len(snap.Found), snap.Scanned)
	}
	if snap.Summary == nil || snap.Summary.Found != 2 {
		t.Fatalf("summary = %+v", snap.Summary)
	}
	if len(snap.LogTail) == 0 || snap.LogTail[0] != "some log line" {
		t.Fatalf("stderr not captured: %v", snap.LogTail)
	}
}

func TestSupervisorReportsFatal(t *testing.T) {
	store := NewStore(time.Hour)
	job := store.New("sess", "123456789012", engine.Spec{Mode: engine.ModeScan, Regions: []string{"us-east-1"}, ResourceTypes: []string{"ec2"}})
	if err := testSupervisor(t).Start(context.Background(), job, awsx.Credentials{AccessKeyID: "FAIL", SecretAccessKey: "x"}); err != nil {
		t.Fatal(err)
	}
	waitTerminal(t, job)
	snap := job.Snapshot()
	if snap.State != StateFailed || snap.Error != "scan failed: AccessDenied" {
		t.Fatalf("state=%s err=%q", snap.State, snap.Error)
	}
}

func TestSupervisorCancelKillsWorker(t *testing.T) {
	store := NewStore(time.Hour)
	job := store.New("sess", "123456789012", engine.Spec{Mode: engine.ModeScan, Regions: []string{"us-east-1"}, ResourceTypes: []string{"ec2"}})
	if err := testSupervisor(t).Start(context.Background(), job, awsx.Credentials{AccessKeyID: "HANG", SecretAccessKey: "x"}); err != nil {
		t.Fatal(err)
	}
	// wait for the first event so we know the worker is up
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) && job.Snapshot().LastSeq == 0 {
		time.Sleep(10 * time.Millisecond)
	}
	if err := store.Cancel(job.ID); err != nil {
		t.Fatal(err)
	}
	waitTerminal(t, job)
	if s := job.State(); s != StateCancelled {
		t.Fatalf("state = %s", s)
	}
}

func TestSubscribeReplaysAndCloses(t *testing.T) {
	store := NewStore(time.Hour)
	job := store.New("sess", "1", engine.Spec{Mode: engine.ModeScan})
	job.setState(StateRunning, "")
	for i := 0; i < 3; i++ {
		job.Publish(engine.Event{Type: engine.EvLog, Message: fmt.Sprint(i)})
	}
	ch, unsub := job.Subscribe(1)
	defer unsub()
	got := []string{}
	for i := 0; i < 2; i++ {
		ev := <-ch
		got = append(got, ev.Message)
	}
	if got[0] != "1" || got[1] != "2" {
		t.Fatalf("replay = %v", got)
	}
	job.Publish(engine.Event{Type: engine.EvLog, Message: "live"})
	if ev := <-ch; ev.Message != "live" || ev.Seq != 4 {
		t.Fatalf("live = %+v", ev)
	}
	job.setState(StateSucceeded, "")
	if _, open := <-ch; open {
		t.Fatal("channel should be closed after terminal state")
	}
}

func TestWorkerEnvNeverLeaksHostAWSConfig(t *testing.T) {
	env := workerEnv(engine.Spec{Regions: []string{"ap-southeast-1"}}, awsx.Credentials{AccessKeyID: "AKIA", SecretAccessKey: "s", SessionToken: "t"})
	want := map[string]bool{"AWS_ACCESS_KEY_ID=AKIA": false, "AWS_SESSION_TOKEN=t": false, "CLOUD_NUKE_AWS_GLOBAL_REGION=ap-southeast-1": false, "DISABLE_TELEMETRY=true": false, "HOME=/nonexistent": false}
	for _, e := range env {
		if _, ok := want[e]; ok {
			want[e] = true
		}
		if e == "AWS_PROFILE" || len(e) > 12 && e[:12] == "AWS_PROFILE=" {
			t.Errorf("AWS_PROFILE must not be passed: %s", e)
		}
	}
	for k, seen := range want {
		if !seen {
			t.Errorf("missing env %s", k)
		}
	}
}

func TestSnapshotNeverSerialisesNullSlices(t *testing.T) {
	store := NewStore(time.Hour)
	job := store.New("sess", "1", engine.Spec{Mode: engine.ModeScan, Regions: []string{"us-east-1"}, ResourceTypes: []string{"ec2"}})
	b, err := json.Marshal(job.Snapshot())
	if err != nil {
		t.Fatal(err)
	}
	for _, key := range []string{`"found":[]`, `"results":[]`, `"errors":[]`} {
		if !strings.Contains(string(b), key) {
			t.Errorf("snapshot missing %s: %s", key, b)
		}
	}
}

func TestAdmitEnforcesCaps(t *testing.T) {
	s := NewStore(time.Hour)
	spec := engine.Spec{Mode: engine.ModeScan, ResourceTypes: []string{"ec2"}}
	if _, err := s.Admit("a", "1", spec, 1, 2); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Admit("a", "1", spec, 1, 2); !errors.Is(err, ErrSessionBusy) {
		t.Fatalf("expected ErrSessionBusy, got %v", err)
	}
	if _, err := s.Admit("b", "2", spec, 1, 2); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Admit("c", "3", spec, 1, 2); !errors.Is(err, ErrServerBusy) {
		t.Fatalf("expected ErrServerBusy, got %v", err)
	}
	if _, err := s.Admit("c", "3", spec, 0, 0); err != nil {
		t.Fatalf("zero means unlimited: %v", err)
	}
}
