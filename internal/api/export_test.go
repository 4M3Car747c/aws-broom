package api

import "github.com/4M3Car747c/aws-broom/internal/jobs"

// finish moves a job to succeeded without a worker (test helper).
func finish(j *jobs.Job) { jobs.ForceSucceeded(j) }
