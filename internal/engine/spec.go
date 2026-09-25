// Package engine is the only package that imports cloud-nuke. It runs inside
// the `broom worker` subprocess: reads a Spec from stdin, performs a scan (and
// optionally a subset delete), and streams NDJSON events to stdout.
package engine

import (
	"encoding/json"
	"fmt"
	"strings"
	"time"
)

// Mode selects what the worker does.
type Mode string

const (
	ModeScan Mode = "scan"
	ModeNuke Mode = "nuke"
)

// Selection identifies one resource the user confirmed for deletion.
type Selection struct {
	ResourceType string `json:"resourceType"`
	Region       string `json:"region"`
	Identifier   string `json:"identifier"`
}

// Key is the canonical map key for a selection.
func (s Selection) Key() string { return SelectionKey(s.ResourceType, s.Region, s.Identifier) }

// SelectionKey builds the canonical key for (type, region, identifier).
func SelectionKey(resourceType, region, identifier string) string {
	return resourceType + "\x00" + region + "\x00" + identifier
}

// Spec is the worker input. Credentials are NOT part of it; they arrive via
// the AWS_* environment variables.
type Spec struct {
	Mode          Mode     `json:"mode"`
	Regions       []string `json:"regions"`       // regional regions only; "global" is added automatically
	ResourceTypes []string `json:"resourceTypes"` // cloud-nuke resource type ids
	// OlderThan, when set, restricts scan/nuke to resources created before now-OlderThan.
	// Enabling it makes cloud-nuke write `cloud-nuke-first-seen` tags on resources
	// that have no native creation timestamp.
	OlderThan *Duration `json:"olderThan,omitempty"`
	// ExcludeIAMUserName protects the IAM user whose keys are being used.
	ExcludeIAMUserName string `json:"excludeIamUserName,omitempty"`
	// Selections is required in nuke mode; only these identifiers are deleted.
	Selections  []Selection `json:"selections,omitempty"`
	Parallelism int         `json:"parallelism,omitempty"`
}

// Validate checks the spec for obvious mistakes before any AWS call.
func (s *Spec) Validate() error {
	switch s.Mode {
	case ModeScan, ModeNuke:
	default:
		return fmt.Errorf("invalid mode %q", s.Mode)
	}
	if len(s.ResourceTypes) == 0 {
		return fmt.Errorf("at least one resource type is required")
	}
	for _, r := range s.Regions {
		if r == "global" || strings.TrimSpace(r) == "" {
			return fmt.Errorf("invalid region %q", r)
		}
	}
	if s.Mode == ModeNuke && len(s.Selections) == 0 {
		return fmt.Errorf("nuke mode requires at least one selection")
	}
	if s.Parallelism < 0 || s.Parallelism > 32 {
		return fmt.Errorf("parallelism out of range")
	}
	return nil
}

// Duration is a JSON-friendly time.Duration (accepts "2h30m" strings or nanoseconds).
type Duration struct{ time.Duration }

func (d Duration) MarshalJSON() ([]byte, error) { return json.Marshal(d.String()) }

func (d *Duration) UnmarshalJSON(b []byte) error {
	var v any
	if err := json.Unmarshal(b, &v); err != nil {
		return err
	}
	switch x := v.(type) {
	case float64:
		d.Duration = time.Duration(x)
	case string:
		p, err := time.ParseDuration(x)
		if err != nil {
			return err
		}
		d.Duration = p
	default:
		return fmt.Errorf("invalid duration %v", v)
	}
	return nil
}

// Event is one NDJSON line from worker to server (and on to the browser).
// Fields are flattened; unused ones are omitted.
type Event struct {
	Seq  int64     `json:"seq"`
	Type EventType `json:"type"`
	At   time.Time `json:"at"`

	Phase   string `json:"phase,omitempty"`   // phase: scan | rescan | nuke
	Message string `json:"message,omitempty"` // phase/log/fatal text

	ResourceType string `json:"resourceType,omitempty"`
	Region       string `json:"region,omitempty"`
	Identifier   string `json:"identifier,omitempty"`

	Nukable *bool  `json:"nukable,omitempty"` // resource_found
	Reason  string `json:"reason,omitempty"`  // resource_found (why not nukable)

	Success *bool  `json:"success,omitempty"` // resource_deleted
	Warning bool   `json:"warning,omitempty"` // resource_deleted: transient failure
	Error   string `json:"error,omitempty"`   // resource_deleted / general_error / fatal
	Note    string `json:"note,omitempty"`    // resource_deleted: e.g. "already_gone"

	BatchSize int      `json:"batchSize,omitempty"` // nuke_progress
	Summary   *Summary `json:"summary,omitempty"`   // summary
}

// EventType enumerates event kinds.
type EventType string

const (
	EvPhase           EventType = "phase"
	EvScanProgress    EventType = "scan_progress"
	EvResourceFound   EventType = "resource_found"
	EvGeneralError    EventType = "general_error"
	EvNukeProgress    EventType = "nuke_progress"
	EvResourceDeleted EventType = "resource_deleted"
	EvSummary         EventType = "summary"
	EvFatal           EventType = "fatal"
	EvLog             EventType = "log" // added server-side from worker stderr
)

// Summary is the final tally of a run.
type Summary struct {
	Mode          Mode `json:"mode"`
	Found         int  `json:"found"`
	Nukable       int  `json:"nukable"`
	NotNukable    int  `json:"notNukable"`
	GeneralErrors int  `json:"generalErrors"`
	Deleted       int  `json:"deleted"`
	Warned        int  `json:"warned"`
	Failed        int  `json:"failed"`
	AlreadyGone   int  `json:"alreadyGone"`
	NotSelected   int  `json:"notSelected"` // found in rescan but not confirmed by the user
}
