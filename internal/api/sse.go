package api

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"time"

	"github.com/4M3Car747c/aws-broom/internal/engine"
)

// handleJobEvents streams job events as Server-Sent Events. Reconnecting
// clients send Last-Event-ID (or ?after= on the first connection) and
// receive only newer events.
func (s *Server) handleJobEvents(w http.ResponseWriter, r *http.Request) {
	sess := sessionFrom(r)
	job, ok := s.jobFor(w, r)
	if !ok {
		return
	}
	// The browser sets Last-Event-ID on automatic reconnects; it must win over
	// the ?after= the page baked into the URL, or every event is replayed.
	after, _ := strconv.ParseInt(r.URL.Query().Get("after"), 10, 64)
	if h := r.Header.Get("Last-Event-ID"); h != "" {
		after, _ = strconv.ParseInt(h, 10, 64)
	}

	h := w.Header()
	h.Set("Content-Type", "text/event-stream")
	h.Set("Cache-Control", "no-cache")
	h.Set("Connection", "keep-alive")
	h.Set("X-Accel-Buffering", "no")
	rc := http.NewResponseController(w)
	_ = rc.SetWriteDeadline(time.Time{})
	w.WriteHeader(http.StatusOK)
	_ = rc.Flush()

	ch, unsub := job.Subscribe(after)
	defer func() { unsub() }()
	ping := time.NewTicker(15 * time.Second)
	defer ping.Stop()
	lastSeq := after

	for {
		select {
		case <-r.Context().Done():
			return
		case <-ping.C:
			// A page that only holds this stream open is still in use.
			s.cfg.Sessions.Touch(sess.ID)
			_, _ = fmt.Fprint(w, ": ping\n\n")
			_ = rc.Flush()
		case ev, open := <-ch:
			if !open {
				snap := job.Snapshot()
				if !snap.State.Terminal() {
					// We were dropped as a slow subscriber; resume from what
					// we last delivered instead of telling the client we are done.
					unsub()
					ch, unsub = job.Subscribe(lastSeq)
					continue
				}
				b, _ := json.Marshal(map[string]any{"state": snap.State, "error": snap.Error})
				_, _ = fmt.Fprintf(w, "event: done\ndata: %s\n\n", b)
				_ = rc.Flush()
				return
			}
			if err := writeEvent(w, ev); err != nil {
				return
			}
			lastSeq = ev.Seq
			_ = rc.Flush()
		}
	}
}

func writeEvent(w http.ResponseWriter, ev engine.Event) error {
	b, err := json.Marshal(ev)
	if err != nil {
		return nil // skip an unmarshalable event, keep the stream alive
	}
	_, err = fmt.Fprintf(w, "id: %d\nevent: %s\ndata: %s\n\n", ev.Seq, ev.Type, b)
	return err
}
