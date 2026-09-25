package engine

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"regexp"
	"time"

	cnaws "github.com/gruntwork-io/cloud-nuke/aws"
	"github.com/gruntwork-io/cloud-nuke/config"
	"github.com/gruntwork-io/cloud-nuke/logging"
	"github.com/gruntwork-io/cloud-nuke/reporting"
	"github.com/gruntwork-io/cloud-nuke/telemetry"
	"github.com/pterm/pterm"

	"github.com/4M3Car747c/aws-broom/internal/catalog"
)

// Version is stamped by the build; used only for cloud-nuke's (disabled) telemetry name.
var Version = "dev"

// initCloudNuke must run once per worker process before any cloud-nuke call.
//
//   - Telemetry: TrackEvent panics if InitTelemetry was never called, and would
//     phone home with the AWS account id if DISABLE_TELEMETRY were unset.
//   - Logging: cloud-nuke's pterm helpers write to stdout unconditionally; move
//     them to stderr so stdout stays a clean NDJSON stream.
func initCloudNuke() {
	_ = os.Setenv("DISABLE_TELEMETRY", "true")
	telemetry.InitTelemetry("aws-broom", Version)
	pterm.SetDefaultOutput(os.Stderr)
	pterm.DisableStyling()
	logging.Logger.SetOutput(os.Stderr)
}

// RunWorker reads a Spec from stdin, executes it and writes NDJSON events to
// stdout. The exit status is 0 when the run completed (even with per-resource
// failures), 1 on a fatal error, 2 on invalid input.
func RunWorker(ctx context.Context, stdin io.Reader, stdout io.Writer) int {
	initCloudNuke()
	em := NewEmitter(stdout)

	var spec Spec
	if err := json.NewDecoder(stdin).Decode(&spec); err != nil {
		em.Fatal(fmt.Errorf("decode spec: %w", err))
		return 2
	}
	if err := spec.Validate(); err != nil {
		em.Fatal(fmt.Errorf("invalid spec: %w", err))
		return 2
	}
	if err := Run(ctx, spec, em); err != nil {
		if errors.Is(err, context.Canceled) {
			em.Fatal(errors.New("cancelled"))
		} else {
			em.Fatal(err)
		}
		return 1
	}
	return 0
}

// Run executes the spec, emitting events to em. It is separated from
// RunWorker so tests can drive it with a fake emitter sink.
func Run(ctx context.Context, spec Spec, em *Emitter) error {
	collector := reporting.NewCollector()
	collector.AddRenderer(em)
	defer collector.Complete()

	query, cfg := buildQuery(spec)
	regions := query.Regions

	phase := "scan"
	if spec.Mode == ModeNuke {
		phase = "rescan"
	}
	em.Phase(phase, fmt.Sprintf("scanning %d region(s), %d resource type(s)", len(regions), len(query.ResourceTypes)))

	account, err := cnaws.GetAllResources(ctx, query, cfg, collector)
	if err != nil {
		return fmt.Errorf("scan failed: %w", err)
	}
	if ctx.Err() != nil {
		return ctx.Err()
	}

	if spec.Mode == ModeScan {
		em.SummaryEvent(ModeScan, 0)
		return nil
	}

	selected := make(map[string]struct{}, len(spec.Selections))
	for _, s := range spec.Selections {
		selected[s.Key()] = struct{}{}
	}
	em.Phase("nuke", fmt.Sprintf("deleting %d confirmed resource(s)", len(selected)))

	stats, nukeErr := nukeSelected(ctx, account, regions, selected, query.Parallelism, collector)
	if ctx.Err() != nil {
		return ctx.Err()
	}
	em.SummaryEvent(ModeNuke, stats.NotSelected)
	if nukeErr != nil {
		// Per-resource failures were already emitted; log the aggregate only.
		fmt.Fprintf(os.Stderr, "nuke finished with errors: %v\n", nukeErr)
	}
	return nil
}

// buildQuery converts a Spec into cloud-nuke inputs. Query.Validate() is
// deliberately not called: it would hit ec2:DescribeRegions and only matters
// for ExcludeResourceTypes, which we never use.
func buildQuery(spec Spec) (*cnaws.Query, config.Config) {
	regions := append([]string(nil), spec.Regions...)
	needGlobal := false
	for _, rt := range spec.ResourceTypes {
		if catalog.IsGlobal(rt) {
			needGlobal = true
			break
		}
	}
	if needGlobal {
		regions = append(regions, cnaws.GlobalRegion)
	}

	q := &cnaws.Query{
		Regions:          regions,
		ResourceTypes:    spec.ResourceTypes,
		ExcludeFirstSeen: spec.OlderThan == nil, // never write first-seen tags unless a time filter is on
		Parallelism:      spec.Parallelism,
	}
	if spec.OlderThan != nil && spec.OlderThan.Duration > 0 {
		t := time.Now().Add(-spec.OlderThan.Duration)
		q.ExcludeAfter = &t
	}

	var cfg config.Config
	if spec.ExcludeIAMUserName != "" {
		cfg.IAMUsers.ExcludeRule.NamesRegExp = append(cfg.IAMUsers.ExcludeRule.NamesRegExp,
			config.Expression{RE: *regexp.MustCompile("^" + regexp.QuoteMeta(spec.ExcludeIAMUserName) + "$")})
	}
	return q, cfg
}
