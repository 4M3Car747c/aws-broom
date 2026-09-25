package engine

import (
	"context"
	"errors"
	"sort"
	"sync"
	"testing"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	cnaws "github.com/gruntwork-io/cloud-nuke/aws"
	"github.com/gruntwork-io/cloud-nuke/aws/resources"
	"github.com/gruntwork-io/cloud-nuke/config"
	"github.com/gruntwork-io/cloud-nuke/reporting"
	"github.com/gruntwork-io/cloud-nuke/resource"
)

// fakeResource implements resources.AwsResource for tests.
type fakeResource struct {
	name  string
	ids   []string
	batch int
	fail  map[string]error // per-identifier failure
	err   error            // bare error returned from Nuke

	mu    sync.Mutex
	calls [][]string
}

func (f *fakeResource) Init(aws.Config)                {}
func (f *fakeResource) ResourceName() string           { return f.name }
func (f *fakeResource) ResourceIdentifiers() []string  { return f.ids }
func (f *fakeResource) MaxBatchSize() int              { return f.batch }
func (f *fakeResource) IsNukable(string) (bool, error) { return true, nil }
func (f *fakeResource) GetAndSetResourceConfig(config.Config) config.ResourceType {
	return config.ResourceType{}
}
func (f *fakeResource) GetAndSetIdentifiers(context.Context, config.Config) ([]string, error) {
	return f.ids, nil
}
func (f *fakeResource) Nuke(_ context.Context, ids []string) ([]resource.NukeResult, error) {
	f.mu.Lock()
	f.calls = append(f.calls, append([]string(nil), ids...))
	f.mu.Unlock()
	if f.err != nil {
		return nil, f.err
	}
	out := make([]resource.NukeResult, 0, len(ids))
	var agg error
	for _, id := range ids {
		out = append(out, resource.NukeResult{Identifier: id, Error: f.fail[id]})
		if f.fail[id] != nil {
			agg = errors.Join(agg, f.fail[id]) // real Resource.Nuke aggregates non-warning errors
		}
	}
	return out, agg
}

type recorder struct {
	mu     sync.Mutex
	events []reporting.Event
}

func (r *recorder) OnEvent(e reporting.Event) {
	r.mu.Lock()
	r.events = append(r.events, e)
	r.mu.Unlock()
}

func (r *recorder) deleted() []reporting.ResourceDeleted {
	r.mu.Lock()
	defer r.mu.Unlock()
	var out []reporting.ResourceDeleted
	for _, e := range r.events {
		if d, ok := e.(reporting.ResourceDeleted); ok {
			out = append(out, d)
		}
	}
	return out
}

func (r *recorder) gone() []ResourceGone {
	r.mu.Lock()
	defer r.mu.Unlock()
	var out []ResourceGone
	for _, e := range r.events {
		if g, ok := e.(ResourceGone); ok {
			out = append(out, g)
		}
	}
	return out
}

func ptrs(rs ...resources.AwsResource) []*resources.AwsResource {
	out := make([]*resources.AwsResource, len(rs))
	for i := range rs {
		r := rs[i]
		out[i] = &r
	}
	return out
}

func TestNukeSelectedFiltersOrdersAndBatches(t *testing.T) {
	batchDelay, throttleDelay = 0, 0

	ec2 := &fakeResource{name: "ec2", ids: []string{"i-1", "i-2", "i-3"}, batch: 2}
	vpc := &fakeResource{name: "vpc", ids: []string{"vpc-1"}, batch: 50}
	s3 := &fakeResource{name: "s3", ids: []string{"bucket-a", "bucket-b"}, batch: 50, fail: map[string]error{"bucket-b": errors.New("boom")}}

	account := &cnaws.AwsAccountResources{Resources: map[string]cnaws.AwsResources{
		"us-east-1": {Resources: ptrs(ec2, vpc)},
		"global":    {Resources: ptrs(s3)},
	}}
	selected := map[string]struct{}{
		SelectionKey("ec2", "us-east-1", "i-1"):   {},
		SelectionKey("ec2", "us-east-1", "i-3"):   {},
		SelectionKey("vpc", "us-east-1", "vpc-1"): {},
		SelectionKey("s3", "global", "bucket-a"):  {},
		SelectionKey("s3", "global", "bucket-b"):  {},
		SelectionKey("s3", "global", "gone"):      {}, // no longer exists
	}

	rec := &recorder{}
	collector := reporting.NewCollector()
	collector.AddRenderer(rec)

	stats, err := nukeSelected(context.Background(), account, []string{"us-east-1", "global"}, selected, 2, collector)
	if err == nil {
		t.Fatalf("expected aggregate error for bucket-b failure")
	}
	if stats.Attempted != 5 || stats.NotSelected != 1 || stats.AlreadyGone != 1 {
		t.Fatalf("stats = %+v", stats)
	}

	// i-2 must never be passed to Nuke; i-1 and i-3 fit one batch of 2.
	if len(ec2.calls) != 1 || len(ec2.calls[0]) != 2 {
		t.Fatalf("ec2 calls = %v", ec2.calls)
	}
	for _, id := range ec2.calls[0] {
		if id == "i-2" {
			t.Fatal("unselected i-2 was nuked")
		}
	}

	del := rec.deleted()
	got := map[string]reporting.ResourceDeleted{}
	for _, d := range del {
		got[SelectionKey(d.ResourceType, d.Region, d.Identifier)] = d
	}
	if !got[SelectionKey("s3", "global", "bucket-a")].Success {
		t.Error("bucket-a should succeed")
	}
	if got[SelectionKey("s3", "global", "bucket-b")].Success || got[SelectionKey("s3", "global", "bucket-b")].Error != "boom" {
		t.Errorf("bucket-b = %+v", got[SelectionKey("s3", "global", "bucket-b")])
	}
	if _, ok := got[SelectionKey("s3", "global", "gone")]; ok {
		t.Error("already-gone selection must not be reported as a deletion")
	}
	if gone := rec.gone(); len(gone) != 1 || gone[0].Identifier != "gone" {
		t.Errorf("expected one ResourceGone event for \"gone\", got %+v", gone)
	}
	if _, ok := got[SelectionKey("ec2", "us-east-1", "i-2")]; ok {
		t.Error("i-2 must not appear in results")
	}
	if len(del) != 5 {
		t.Errorf("expected 5 ResourceDeleted events, got %d", len(del))
	}
}

func TestNukeSelectedBatchesRespectMaxBatchSize(t *testing.T) {
	batchDelay, throttleDelay = 0, 0
	ids := []string{"a", "b", "c", "d", "e"}
	r := &fakeResource{name: "sqs", ids: ids, batch: 2}
	account := &cnaws.AwsAccountResources{Resources: map[string]cnaws.AwsResources{"eu-west-1": {Resources: ptrs(r)}}}
	selected := map[string]struct{}{}
	for _, id := range ids {
		selected[SelectionKey("sqs", "eu-west-1", id)] = struct{}{}
	}
	collector := reporting.NewCollector()
	collector.AddRenderer(&recorder{})
	if _, err := nukeSelected(context.Background(), account, []string{"eu-west-1"}, selected, 1, collector); err != nil {
		t.Fatal(err)
	}
	if len(r.calls) != 3 {
		t.Fatalf("expected 3 batches, got %d: %v", len(r.calls), r.calls)
	}
	var flat []string
	for _, c := range r.calls {
		flat = append(flat, c...)
	}
	sort.Strings(flat)
	if len(flat) != 5 {
		t.Fatalf("flat = %v", flat)
	}
}

func TestNukeSelectedBareErrorReportsEveryIdentifier(t *testing.T) {
	batchDelay, throttleDelay = 0, 0
	r := &fakeResource{name: "lambda", ids: []string{"f1", "f2"}, batch: 50, err: errors.New("AccessDenied")}
	account := &cnaws.AwsAccountResources{Resources: map[string]cnaws.AwsResources{"us-west-2": {Resources: ptrs(r)}}}
	selected := map[string]struct{}{
		SelectionKey("lambda", "us-west-2", "f1"): {},
		SelectionKey("lambda", "us-west-2", "f2"): {},
	}
	rec := &recorder{}
	collector := reporting.NewCollector()
	collector.AddRenderer(rec)
	_, err := nukeSelected(context.Background(), account, []string{"us-west-2"}, selected, 1, collector)
	if err == nil {
		t.Fatal("expected error")
	}
	del := rec.deleted()
	if len(del) != 2 {
		t.Fatalf("expected 2 failure events, got %d", len(del))
	}
	for _, d := range del {
		if d.Success || d.Error != "AccessDenied" {
			t.Errorf("unexpected %+v", d)
		}
	}
}

func TestNukeSelectedHonoursCancellation(t *testing.T) {
	batchDelay = time.Hour // would hang if not cancelled
	defer func() { batchDelay = 10 * time.Second }()
	r := &fakeResource{name: "sns-topic", ids: []string{"a", "b", "c"}, batch: 1}
	account := &cnaws.AwsAccountResources{Resources: map[string]cnaws.AwsResources{"us-east-1": {Resources: ptrs(r)}}}
	selected := map[string]struct{}{}
	for _, id := range r.ids {
		selected[SelectionKey("sns-topic", "us-east-1", id)] = struct{}{}
	}
	ctx, cancel := context.WithCancel(context.Background())
	go func() { time.Sleep(50 * time.Millisecond); cancel() }()
	collector := reporting.NewCollector()
	collector.AddRenderer(&recorder{})
	done := make(chan struct{})
	go func() {
		defer close(done)
		_, _ = nukeSelected(ctx, account, []string{"us-east-1"}, selected, 1, collector)
	}()
	select {
	case <-done:
	case <-time.After(5 * time.Second):
		t.Fatal("nukeSelected did not stop after cancellation")
	}
}

func TestSplitKeyRoundTrip(t *testing.T) {
	rt, region, id := splitKey(SelectionKey("ec2", "us-east-1", "i-abc"))
	if rt != "ec2" || region != "us-east-1" || id != "i-abc" {
		t.Fatalf("got %q %q %q", rt, region, id)
	}
}

func TestBuildQueryAddsGlobalAndProtectsCaller(t *testing.T) {
	q, cfg := buildQuery(Spec{Mode: ModeScan, Regions: []string{"us-east-1"}, ResourceTypes: []string{"ec2", "s3"}, ExcludeIAMUserName: "me.admin"})
	if len(q.Regions) != 2 || q.Regions[1] != "global" {
		t.Fatalf("regions = %v", q.Regions)
	}
	if !q.ExcludeFirstSeen {
		t.Error("ExcludeFirstSeen should be true when no time filter is set")
	}
	if len(cfg.IAMUsers.ExcludeRule.NamesRegExp) != 1 || !cfg.IAMUsers.ExcludeRule.NamesRegExp[0].RE.MatchString("me.admin") {
		t.Error("caller IAM user is not excluded")
	}
	if cfg.IAMUsers.ExcludeRule.NamesRegExp[0].RE.MatchString("mexadmin") {
		t.Error("exclusion regex must be anchored and escaped")
	}

	q2, _ := buildQuery(Spec{Mode: ModeScan, Regions: []string{"us-east-1"}, ResourceTypes: []string{"ec2"}, OlderThan: &Duration{2 * time.Hour}})
	if q2.ExcludeAfter == nil || q2.ExcludeFirstSeen {
		t.Error("time filter should set ExcludeAfter and allow first-seen tagging")
	}
	if len(q2.Regions) != 1 {
		t.Errorf("no global region expected, got %v", q2.Regions)
	}
}
