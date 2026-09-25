// Command broom is the AWS Broom server and worker.
//
//	broom serve        start the HTTP server (default)
//	broom worker       run one scan/nuke job: spec on stdin, NDJSON events on stdout
//	broom healthcheck  exit 0 if the local server answers /healthz
package main

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"syscall"
	"time"

	"github.com/4M3Car747c/aws-broom/internal/api"
	"github.com/4M3Car747c/aws-broom/internal/engine"
	"github.com/4M3Car747c/aws-broom/internal/jobs"
	"github.com/4M3Car747c/aws-broom/internal/session"
	"github.com/4M3Car747c/aws-broom/internal/web"
)

var version = "dev"

func main() {
	cmd := "serve"
	if len(os.Args) > 1 {
		cmd = os.Args[1]
	}
	switch cmd {
	case "serve":
		os.Exit(serve())
	case "worker":
		engine.Version = version
		ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGTERM, syscall.SIGINT)
		defer stop()
		os.Exit(engine.RunWorker(ctx, os.Stdin, os.Stdout))
	case "healthcheck":
		os.Exit(healthcheck())
	case "version", "--version", "-v":
		fmt.Println("broom", version)
	default:
		fmt.Fprintf(os.Stderr, "unknown command %q\nusage: broom [serve|worker|healthcheck|version]\n", cmd)
		os.Exit(2)
	}
}

func serve() int {
	logger := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelInfo}))
	slog.SetDefault(logger)

	port := envInt("PORT", 8080)
	idleTTL := envDuration("SESSION_IDLE_TTL", 60*time.Minute)
	maxTTL := envDuration("SESSION_MAX_TTL", 12*time.Hour)
	jobTimeout := envDuration("JOB_TIMEOUT", 2*time.Hour)
	jobRetention := envDuration("JOB_RETENTION", 2*time.Hour)
	ratePerMin := envInt("RATE_LIMIT_PER_MIN", 10)
	maxJobs := envInt("MAX_JOBS", 8)

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGTERM, syscall.SIGINT)
	defer stop()

	jobStore := jobs.NewStore(jobRetention)
	sessions := session.NewStore(idleTTL, maxTTL, jobStore.CancelSession)
	// A session with a scan or cleanup in flight is never idle-expired.
	sessions.SetBusy(func(id string) bool { return jobStore.RunningForSession(id) > 0 })
	go sessions.RunReaper(ctx, time.Minute)
	go jobStore.RunReaper(ctx, time.Minute)

	srv := api.New(api.Config{
		BaseCtx:           ctx,
		Logger:            logger,
		Sessions:          sessions,
		Jobs:              jobStore,
		Supervisor:        &jobs.Supervisor{Timeout: jobTimeout, Logger: logger},
		SessionRatePerMin: ratePerMin,
		MaxJobs:           maxJobs,
		SPA:               web.Handler(),
	})

	httpSrv := &http.Server{
		Addr:              net.JoinHostPort("0.0.0.0", strconv.Itoa(port)),
		Handler:           srv.Handler(),
		ReadHeaderTimeout: 10 * time.Second,
		ReadTimeout:       30 * time.Second,
		WriteTimeout:      0, // SSE streams disable it per-request anyway
		IdleTimeout:       120 * time.Second,
		BaseContext:       func(net.Listener) context.Context { return ctx },
	}

	errCh := make(chan error, 1)
	go func() { errCh <- httpSrv.ListenAndServe() }()
	logger.Info("broom serving", "addr", httpSrv.Addr, "version", version)

	select {
	case err := <-errCh:
		if err != nil && !errors.Is(err, http.ErrServerClosed) {
			logger.Error("listen", "err", err)
			return 1
		}
	case <-ctx.Done():
		logger.Info("shutting down")
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		_ = httpSrv.Shutdown(shutdownCtx)
	}
	sessions.Close() // zero all credentials
	return 0
}

func healthcheck() int {
	port := envInt("PORT", 8080)
	client := &http.Client{Timeout: 3 * time.Second}
	resp, err := client.Get(fmt.Sprintf("http://127.0.0.1:%d/healthz", port))
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		return 1
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		fmt.Fprintln(os.Stderr, "status", resp.Status)
		return 1
	}
	return 0
}

func envInt(key string, def int) int {
	if v := os.Getenv(key); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			return n
		}
	}
	return def
}

func envDuration(key string, def time.Duration) time.Duration {
	if v := os.Getenv(key); v != "" {
		if d, err := time.ParseDuration(v); err == nil {
			return d
		}
	}
	return def
}
