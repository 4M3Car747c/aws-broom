package jobs

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"os"
	"os/exec"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/4M3Car747c/aws-broom/internal/awsx"
	"github.com/4M3Car747c/aws-broom/internal/engine"
)

// Supervisor launches one `broom worker` subprocess per job.
type Supervisor struct {
	Executable string        // defaults to os.Executable()
	Timeout    time.Duration // hard cap per job
	Logger     *slog.Logger
}

// Start runs the job asynchronously. Credentials are passed through the
// child's environment only; they never appear in argv or in the Spec.
func (sv *Supervisor) Start(parent context.Context, job *Job, creds awsx.Credentials) error {
	exe := sv.Executable
	if exe == "" {
		var err error
		exe, err = os.Executable()
		if err != nil {
			return err
		}
	}
	logger := sv.Logger
	if logger == nil {
		logger = slog.Default()
	}

	var (
		ctx    context.Context
		cancel context.CancelFunc
	)
	if sv.Timeout > 0 {
		ctx, cancel = context.WithTimeout(parent, sv.Timeout)
	} else {
		ctx, cancel = context.WithCancel(parent)
	}
	job.mu.Lock()
	job.cancel = cancel
	job.mu.Unlock()

	cmd := exec.CommandContext(ctx, exe, "worker")
	cmd.Env = workerEnv(job.Spec, creds)
	cmd.Cancel = func() error { return cmd.Process.Signal(syscall.SIGTERM) }
	cmd.WaitDelay = 5 * time.Second // SIGKILL if SIGTERM is ignored

	stdin, err := cmd.StdinPipe()
	if err != nil {
		cancel()
		return err
	}
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		cancel()
		return err
	}
	stderr, err := cmd.StderrPipe()
	if err != nil {
		cancel()
		return err
	}
	if err := cmd.Start(); err != nil {
		cancel()
		return fmt.Errorf("start worker: %w", err)
	}
	job.setState(StateRunning, "")
	logger.Info("worker started", "job", job.ID, "mode", job.Spec.Mode, "pid", cmd.Process.Pid)

	go func() {
		defer cancel()
		// Send the spec then close stdin so the worker can start.
		if err := json.NewEncoder(stdin).Encode(job.Spec); err != nil {
			logger.Error("write spec", "job", job.ID, "err", err)
		}
		_ = stdin.Close()

		var wg sync.WaitGroup
		var sawFatal string
		wg.Add(2)
		go func() {
			defer wg.Done()
			sawFatal = readEvents(stdout, job)
		}()
		go func() {
			defer wg.Done()
			readLogs(stderr, job)
		}()
		wg.Wait()
		waitErr := cmd.Wait()

		switch {
		case errors.Is(ctx.Err(), context.Canceled):
			job.setState(StateCancelled, "cancelled")
		case errors.Is(ctx.Err(), context.DeadlineExceeded):
			job.setState(StateFailed, "job timed out")
		case waitErr != nil:
			msg := sawFatal
			if msg == "" {
				msg = fmt.Sprintf("worker exited: %v", waitErr)
			}
			job.setState(StateFailed, msg)
		default:
			job.setState(StateSucceeded, "")
		}
		logger.Info("worker finished", "job", job.ID, "state", job.State())
	}()
	return nil
}

func workerEnv(spec engine.Spec, creds awsx.Credentials) []string {
	env := []string{
		"AWS_ACCESS_KEY_ID=" + creds.AccessKeyID,
		"AWS_SECRET_ACCESS_KEY=" + creds.SecretAccessKey,
		"AWS_EC2_METADATA_DISABLED=true",
		"AWS_SDK_LOAD_CONFIG=0",
		"DISABLE_TELEMETRY=true",
		"HOME=/nonexistent", // never pick up ~/.aws on the host
		"PATH=" + os.Getenv("PATH"),
	}
	if creds.SessionToken != "" {
		env = append(env, "AWS_SESSION_TOKEN="+creds.SessionToken)
	}
	if len(spec.Regions) > 0 {
		// Session region used for the "global" pseudo-region (S3, IAM, ...).
		env = append(env, "CLOUD_NUKE_AWS_GLOBAL_REGION="+spec.Regions[0])
	}
	for _, key := range []string{"HTTP_PROXY", "HTTPS_PROXY", "NO_PROXY", "http_proxy", "https_proxy", "no_proxy", "SSL_CERT_FILE", "SSL_CERT_DIR"} {
		if v, ok := os.LookupEnv(key); ok {
			env = append(env, key+"="+v)
		}
	}
	return env
}

// readEvents parses NDJSON events from the worker. Returns the fatal message if one was seen.
func readEvents(r io.Reader, job *Job) string {
	sc := bufio.NewScanner(r)
	sc.Buffer(make([]byte, 0, 64*1024), 4*1024*1024)
	fatal := ""
	for sc.Scan() {
		line := sc.Bytes()
		if len(line) == 0 {
			continue
		}
		var ev engine.Event
		if err := json.Unmarshal(line, &ev); err != nil {
			job.Publish(engine.Event{Type: engine.EvLog, Message: "unparsable worker output: " + truncate(string(line), 300)})
			continue
		}
		if ev.Type == engine.EvFatal {
			fatal = ev.Error
		}
		job.Publish(ev)
	}
	return fatal
}

func readLogs(r io.Reader, job *Job) {
	sc := bufio.NewScanner(r)
	sc.Buffer(make([]byte, 0, 64*1024), 1024*1024)
	for sc.Scan() {
		line := strings.TrimSpace(sc.Text())
		if line == "" {
			continue
		}
		job.Publish(engine.Event{Type: engine.EvLog, Message: truncate(line, 1000)})
	}
}

func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n] + "…"
}
