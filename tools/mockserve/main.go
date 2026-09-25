// Command mockserve runs the real HTTP API with fake AWS calls and a fake
// worker so the UI can be developed and reviewed without an AWS account.
//
//	go run ./tools/mockserve            # serves web/build/client on :8098
//	go run ./tools/mockserve -port 8098 -static web/build/client
//
// Any access key / secret is accepted. Scans "find" a few resources per region;
// nukes delete them with a mix of success, warning and failure outcomes.
package main

import (
	"bufio"
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/4M3Car747c/aws-broom/internal/api"
	"github.com/4M3Car747c/aws-broom/internal/awsx"
	"github.com/4M3Car747c/aws-broom/internal/catalog"
	"github.com/4M3Car747c/aws-broom/internal/engine"
	"github.com/4M3Car747c/aws-broom/internal/jobs"
	"github.com/4M3Car747c/aws-broom/internal/session"
	"github.com/4M3Car747c/aws-broom/internal/web"
)

func main() {
	if len(os.Args) > 1 && os.Args[1] == "worker" {
		os.Exit(fakeWorker())
	}
	port := flag.Int("port", 8098, "listen port")
	static := flag.String("static", "web/build/client", "SPA build directory")
	flag.Parse()

	exe, _ := os.Executable()
	logger := slog.New(slog.NewTextHandler(os.Stderr, nil))
	jobStore := jobs.NewStore(2 * time.Hour)
	sessions := session.NewStore(time.Hour, 12*time.Hour, jobStore.CancelSession)
	srv := api.New(api.Config{
		Logger:     logger,
		Sessions:   sessions,
		Jobs:       jobStore,
		Supervisor: &jobs.Supervisor{Executable: exe, Timeout: time.Hour, Logger: logger},
		SPA:        spa(*static),
		Identity: func(_ context.Context, creds awsx.Credentials, _ string) (awsx.Identity, error) {
			if strings.HasPrefix(creds.AccessKeyID, "BAD") {
				return awsx.Identity{}, fmt.Errorf("api error InvalidClientTokenId: The security token included in the request is invalid")
			}
			return awsx.Identity{AccountID: "123456789012", ARN: "arn:aws:iam::123456789012:user/poc-admin", UserID: "AIDAEXAMPLE", IAMUserName: "poc-admin", Principal: "user/poc-admin"}, nil
		},
		Regions: func(context.Context, awsx.Credentials, string) ([]awsx.Region, error) {
			var out []awsx.Region
			for _, c := range []string{"us-east-1", "us-east-2", "us-west-1", "us-west-2", "ca-central-1", "sa-east-1", "eu-west-1", "eu-west-2", "eu-west-3", "eu-central-1", "eu-north-1", "ap-east-1", "ap-northeast-1", "ap-northeast-2", "ap-northeast-3", "ap-southeast-1", "ap-southeast-2", "ap-south-1", "me-south-1", "af-south-1"} {
				out = append(out, awsx.Region{Code: c, Group: awsx.RegionGroup(c)})
			}
			return out, nil
		},
	})
	addr := fmt.Sprintf("127.0.0.1:%d", *port)
	logger.Info("mockserve listening", "addr", "http://"+addr)
	if err := http.ListenAndServe(addr, srv.Handler()); err != nil {
		logger.Error("listen", "err", err)
		os.Exit(1)
	}
}

func spa(dir string) http.Handler {
	fs := http.FileServer(http.Dir(dir))
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		p := filepath.Join(dir, filepath.Clean("/"+r.URL.Path))
		if st, err := os.Stat(p); err == nil && !st.IsDir() {
			fs.ServeHTTP(w, r)
			return
		}
		// Re-read on every request so a `pnpm build` is picked up without restarting;
		// a cached copy would keep pointing at asset hashes the rebuild deleted.
		index, err := os.ReadFile(filepath.Join(dir, "index.html"))
		if err != nil {
			http.Error(w, "SPA build not found: run `pnpm build` in web/", http.StatusServiceUnavailable)
			return
		}
		// Same policy as the production handler so CSP breakage shows up in dev.
		w.Header().Set("Content-Security-Policy", web.ContentSecurityPolicy(index))
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		_, _ = w.Write(index)
	})
}

// ---- fake worker ----

type emitter struct {
	w   *bufio.Writer
	seq int64
}

func (e *emitter) emit(ev engine.Event) {
	e.seq++
	ev.Seq = e.seq
	ev.At = time.Now().UTC()
	b, _ := json.Marshal(ev)
	_, _ = e.w.Write(b)
	_ = e.w.WriteByte('\n')
	_ = e.w.Flush()
}

var sampleIDs = map[string][]string{
	"ec2":                 {"i-0f9e8d7c6b5a43210", "i-0123456789abcdef0", "i-0a1b2c3d4e5f60789"},
	"ebs":                 {"vol-0c2b1a3f4e5d66789"},
	"eip":                 {"eipalloc-0abc1234def56789a"},
	"ec2-keypairs":        {"poc-keypair"},
	"vpc":                 {"vpc-0d1e2f3a4b5c66789"},
	"security-group":      {"sg-0aa11bb22cc33dd44", "sg-0ff11ee22dd33cc44"},
	"ec2-subnet":          {"subnet-0a0a0a0a0a0a0a0a0", "subnet-0b0b0b0b0b0b0b0b0"},
	"elbv2":               {"poc-web-alb"},
	"lambda":              {"poc-image-resize", "poc-webhook"},
	"cloudwatch-loggroup": {"/aws/lambda/poc-webhook", "/aws/lambda/poc-image-resize"},
	"sqs":                 {"poc-jobs", "poc-jobs-dlq"},
	"rds-instance":        {"poc-postgres-1"},
	"dynamodb":            {"poc-sessions"},
	"s3":                  {"poc-uploads-2026", "poc-tf-state-lock"},
	"iam-role":            {"poc-lambda-exec", "poc-ecs-task"},
}

func fakeWorker() int {
	var spec engine.Spec
	if err := json.NewDecoder(os.Stdin).Decode(&spec); err != nil {
		return 2
	}
	e := &emitter{w: bufio.NewWriter(os.Stdout)}
	fmt.Fprintln(os.Stderr, "INFO: fake worker started")

	regions := append([]string(nil), spec.Regions...)
	needGlobal := false
	for _, t := range spec.ResourceTypes {
		if catalog.IsGlobal(t) {
			needGlobal = true
		}
	}
	if needGlobal {
		regions = append(regions, "global")
	}

	scan := func(phase string) map[string]bool {
		e.emit(engine.Event{Type: engine.EvPhase, Phase: phase, Message: "scanning"})
		found := map[string]bool{}
		for _, region := range regions {
			for _, t := range spec.ResourceTypes {
				if (region == "global") != catalog.IsGlobal(t) {
					continue
				}
				e.emit(engine.Event{Type: engine.EvScanProgress, ResourceType: t, Region: region})
				time.Sleep(25 * time.Millisecond)
				if t == "opensearch-domain" && region == regions[0] {
					e.emit(engine.Event{Type: engine.EvGeneralError, ResourceType: t, Message: "Unable to retrieve " + t, Error: "AccessDeniedException: es:ListDomainNames"})
					continue
				}
				ids := sampleIDs[t]
				if region != regions[0] && region != "global" {
					if len(ids) > 1 {
						ids = ids[:1]
					}
				}
				for _, id := range ids {
					nukable := true
					reason := ""
					if id == "i-0a1b2c3d4e5f60789" {
						nukable, reason = false, "termination protection is enabled"
					}
					e.emit(engine.Event{Type: engine.EvResourceFound, ResourceType: t, Region: region, Identifier: id, Nukable: &nukable, Reason: reason})
					found[engine.SelectionKey(t, region, id)] = true
				}
			}
		}
		return found
	}

	if spec.Mode == engine.ModeScan {
		scan("scan")
		e.emit(engine.Event{Type: engine.EvSummary, Summary: &engine.Summary{Mode: engine.ModeScan}})
		return 0
	}

	found := scan("rescan")
	e.emit(engine.Event{Type: engine.EvPhase, Phase: "nuke", Message: "deleting"})
	for i, sel := range spec.Selections {
		time.Sleep(350 * time.Millisecond)
		success, warning, errStr, note := true, false, "", ""
		switch {
		case !found[sel.Key()]:
			note = "already_gone"
		case sel.ResourceType == "vpc":
			success, warning, errStr = false, true, "api error DependencyViolation: The vpc has dependencies and cannot be deleted."
		case sel.ResourceType == "rds-instance":
			success, errStr = false, "api error InvalidParameterCombination: Cannot delete protected DB Instance, please disable deletion protection and try again."
		}
		if i%7 == 0 {
			e.emit(engine.Event{Type: engine.EvNukeProgress, ResourceType: sel.ResourceType, Region: sel.Region, BatchSize: 1})
		}
		e.emit(engine.Event{Type: engine.EvResourceDeleted, ResourceType: sel.ResourceType, Region: sel.Region, Identifier: sel.Identifier, Success: &success, Warning: warning, Error: errStr, Note: note})
	}
	e.emit(engine.Event{Type: engine.EvSummary, Summary: &engine.Summary{Mode: engine.ModeNuke}})
	return 0
}
