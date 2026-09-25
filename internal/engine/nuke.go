package engine

import (
	"context"
	"fmt"
	"sync"
	"time"

	cnaws "github.com/gruntwork-io/cloud-nuke/aws"
	"github.com/gruntwork-io/cloud-nuke/aws/resources"
	"github.com/gruntwork-io/cloud-nuke/reporting"
	"github.com/gruntwork-io/cloud-nuke/util"
	"github.com/hashicorp/go-multierror"
	"golang.org/x/sync/errgroup"
)

// Tunables, overridable in tests.
var (
	batchDelay    = 10 * time.Second
	throttleDelay = 1 * time.Minute
)

// ResourceGone is a reporting event for a confirmed identifier that the
// rescan no longer sees. cloud-nuke's ResourceDeleted has no way to carry
// that distinction, so it gets its own event type.
type ResourceGone struct {
	ResourceType string
	Region       string
	Identifier   string
}

// EventType implements reporting.Event.
func (ResourceGone) EventType() string { return "resource_gone" }

// NukeStats is what nukeSelected reports back to the caller.
type NukeStats struct {
	Attempted   int // identifiers passed to Nuke
	NotSelected int // identifiers found in the rescan but not confirmed
	AlreadyGone int // confirmed identifiers that no longer exist
}

// nukeSelected deletes only the identifiers in `selected`, walking the account
// in cloud-nuke's registry order (dependency-safe), batching per resource type,
// running regional regions in parallel and the global pseudo-region last.
//
// It mirrors cloud-nuke's NukeAllResources/nukeAllResourcesInRegion but adds
// the identifier filter that the upstream API does not expose.
func nukeSelected(ctx context.Context, account *cnaws.AwsAccountResources, regions []string,
	selected map[string]struct{}, parallelism int, collector *reporting.Collector) (NukeStats, error) {

	if parallelism <= 0 {
		parallelism = util.DefaultParallelism
	}
	ctx = context.WithValue(ctx, util.ParallelismKey, parallelism)

	var (
		mu        sync.Mutex
		allErrors *multierror.Error
		stats     NukeStats
		seen      = make(map[string]struct{}, len(selected))
	)

	nukeRegion := func(region string) {
		res := account.Resources[region]
		st, err := nukeRegionSelected(ctx, region, res.Resources, selected, collector, func(k string) {
			mu.Lock()
			seen[k] = struct{}{}
			mu.Unlock()
		})
		mu.Lock()
		stats.Attempted += st.Attempted
		stats.NotSelected += st.NotSelected
		if err != nil {
			allErrors = multierror.Append(allErrors, err)
		}
		mu.Unlock()
	}

	eg := new(errgroup.Group)
	eg.SetLimit(parallelism)
	for _, region := range regions {
		if region == cnaws.GlobalRegion {
			continue
		}
		eg.Go(func() error {
			nukeRegion(region)
			return nil
		})
	}
	_ = eg.Wait()

	for _, region := range regions {
		if region == cnaws.GlobalRegion {
			nukeRegion(region)
		}
	}

	// Anything the user confirmed that the rescan no longer sees is reported as
	// already gone so the UI can close it out.
	for key := range selected {
		if _, ok := seen[key]; ok {
			continue
		}
		rt, region, id := splitKey(key)
		collector.Emit(ResourceGone{ResourceType: rt, Region: region, Identifier: id})
		stats.AlreadyGone++
	}

	return stats, allErrors.ErrorOrNil()
}

func nukeRegionSelected(ctx context.Context, region string, list []*resources.AwsResource,
	selected map[string]struct{}, collector *reporting.Collector, markSeen func(key string)) (NukeStats, error) {

	var (
		stats     NukeStats
		allErrors *multierror.Error
	)

	for _, res := range list {
		if ctx.Err() != nil {
			return stats, ctx.Err()
		}
		r := *res
		typeName := r.ResourceName()

		var ids []string
		for _, id := range r.ResourceIdentifiers() {
			key := SelectionKey(typeName, region, id)
			if _, ok := selected[key]; !ok {
				stats.NotSelected++
				continue
			}
			markSeen(key)
			ids = append(ids, id)
		}
		if len(ids) == 0 {
			continue
		}

		batches := util.Split(ids, r.MaxBatchSize())
		for i, batch := range batches {
			if ctx.Err() != nil {
				return stats, ctx.Err()
			}
			collector.Emit(reporting.NukeProgress{ResourceType: typeName, Region: region, BatchSize: len(batch)})
			stats.Attempted += len(batch)

			results, err := r.Nuke(ctx, batch)
			reported := make(map[string]bool, len(results))
			for _, result := range results {
				reported[result.Identifier] = true
				errStr := ""
				if result.Error != nil {
					errStr = result.Error.Error()
				}
				collector.Emit(reporting.ResourceDeleted{
					ResourceType: typeName,
					Region:       region,
					Identifier:   result.Identifier,
					Success:      result.Error == nil,
					Warning:      result.Error != nil && util.IsWarningError(result.Error),
					Error:        errStr,
				})
			}
			// Some nukers return a bare error without per-identifier results.
			if err != nil {
				for _, id := range batch {
					if reported[id] {
						continue
					}
					collector.Emit(reporting.ResourceDeleted{
						ResourceType: typeName, Region: region, Identifier: id,
						Success: false, Warning: util.IsWarningError(err), Error: err.Error(),
					})
				}
				if util.IsThrottlingError(err) {
					sleepCtx(ctx, throttleDelay)
					continue
				}
				allErrors = multierror.Append(allErrors, fmt.Errorf("[%s] %s: %w", region, typeName, err))
			}
			if i != len(batches)-1 {
				sleepCtx(ctx, batchDelay)
			}
		}
	}
	return stats, allErrors.ErrorOrNil()
}

func sleepCtx(ctx context.Context, d time.Duration) {
	if d <= 0 {
		return
	}
	t := time.NewTimer(d)
	defer t.Stop()
	select {
	case <-ctx.Done():
	case <-t.C:
	}
}

func splitKey(key string) (resourceType, region, identifier string) {
	first, second := -1, -1
	for i := 0; i < len(key); i++ {
		if key[i] == 0 {
			if first < 0 {
				first = i
			} else {
				second = i
				break
			}
		}
	}
	if first < 0 || second < 0 {
		return key, "", ""
	}
	return key[:first], key[first+1 : second], key[second+1:]
}
