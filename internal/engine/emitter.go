package engine

import (
	"bufio"
	"encoding/json"
	"io"
	"sync"
	"time"

	"github.com/gruntwork-io/cloud-nuke/reporting"
)

// Emitter serialises events as NDJSON with a monotonically increasing seq.
type Emitter struct {
	mu  sync.Mutex
	w   *bufio.Writer
	seq int64
	now func() time.Time

	// tallies maintained from emitted events
	summary Summary
}

// NewEmitter wraps w. Each event is flushed immediately so the parent sees
// progress in real time.
func NewEmitter(w io.Writer) *Emitter {
	return &Emitter{w: bufio.NewWriterSize(w, 64*1024), now: time.Now}
}

// Emit writes one event.
func (e *Emitter) Emit(ev Event) {
	e.mu.Lock()
	defer e.mu.Unlock()
	e.seq++
	ev.Seq = e.seq
	ev.At = e.now().UTC()
	e.tally(ev)
	b, err := json.Marshal(ev)
	if err != nil {
		return
	}
	_, _ = e.w.Write(b)
	_ = e.w.WriteByte('\n')
	_ = e.w.Flush()
}

func (e *Emitter) tally(ev Event) {
	switch ev.Type {
	case EvResourceFound:
		e.summary.Found++
		if ev.Nukable != nil && !*ev.Nukable {
			e.summary.NotNukable++
		} else {
			e.summary.Nukable++
		}
	case EvGeneralError:
		e.summary.GeneralErrors++
	case EvResourceDeleted:
		switch {
		case ev.Note == "already_gone":
			e.summary.AlreadyGone++
		case ev.Success != nil && *ev.Success:
			e.summary.Deleted++
		case ev.Warning:
			e.summary.Warned++
		default:
			e.summary.Failed++
		}
	}
}

// Phase emits a phase marker.
func (e *Emitter) Phase(phase, msg string) {
	e.Emit(Event{Type: EvPhase, Phase: phase, Message: msg})
}

// Fatal emits a fatal error.
func (e *Emitter) Fatal(err error) {
	e.Emit(Event{Type: EvFatal, Error: err.Error()})
}

// SummaryEvent emits the final summary for mode.
func (e *Emitter) SummaryEvent(mode Mode, notSelected int) {
	e.mu.Lock()
	s := e.summary
	e.mu.Unlock()
	s.Mode = mode
	s.NotSelected = notSelected
	e.Emit(Event{Type: EvSummary, Summary: &s})
}

// OnEvent implements reporting.Renderer so the emitter can be attached to a
// cloud-nuke Collector.
func (e *Emitter) OnEvent(event reporting.Event) {
	switch ev := event.(type) {
	case reporting.ScanProgress:
		e.Emit(Event{Type: EvScanProgress, ResourceType: ev.ResourceType, Region: ev.Region})
	case reporting.ResourceFound:
		nukable := ev.Nukable
		e.Emit(Event{Type: EvResourceFound, ResourceType: ev.ResourceType, Region: ev.Region,
			Identifier: ev.Identifier, Nukable: &nukable, Reason: ev.Reason})
	case reporting.GeneralError:
		e.Emit(Event{Type: EvGeneralError, ResourceType: ev.ResourceType, Message: ev.Description, Error: ev.Error})
	case reporting.NukeProgress:
		e.Emit(Event{Type: EvNukeProgress, ResourceType: ev.ResourceType, Region: ev.Region, BatchSize: ev.BatchSize})
	case reporting.ResourceDeleted:
		success := ev.Success
		e.Emit(Event{Type: EvResourceDeleted, ResourceType: ev.ResourceType, Region: ev.Region,
			Identifier: ev.Identifier, Success: &success, Warning: ev.Warning, Error: ev.Error})
	case ResourceGone:
		success := true
		e.Emit(Event{Type: EvResourceDeleted, ResourceType: ev.ResourceType, Region: ev.Region,
			Identifier: ev.Identifier, Success: &success, Note: "already_gone"})
	}
	// ScanStarted/ScanComplete/NukeStarted/NukeComplete/Complete are represented by phase events.
}

var _ reporting.Renderer = (*Emitter)(nil)
