package jobs

// ForceSucceeded marks a job as succeeded without running a worker. It exists
// for tests in other packages and must not be used by production code.
func ForceSucceeded(j *Job) {
	j.setState(StateRunning, "")
	j.setState(StateSucceeded, "")
}
