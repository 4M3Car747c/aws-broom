package catalog

import (
	"testing"

	cnaws "github.com/gruntwork-io/cloud-nuke/aws"
)

func TestCatalogCoversEveryCloudNukeType(t *testing.T) {
	seen := map[string]int{}
	for _, s := range Services() {
		for _, rt := range s.ResourceTypes {
			seen[rt.ID]++
		}
	}
	for _, id := range cnaws.ListResourceTypes() {
		if seen[id] != 1 {
			t.Errorf("resource type %q appears %d times in catalog, want exactly 1", id, seen[id])
		}
	}
	if u := Unmapped(); len(u) > 0 {
		t.Logf("unmapped cloud-nuke types exposed under 'other' (consider grouping): %v", u)
	}
}

func TestServiceDefsOnlyReferenceKnownTypes(t *testing.T) {
	known := map[string]bool{}
	for _, id := range cnaws.ListResourceTypes() {
		known[id] = true
	}
	for _, def := range serviceDefs {
		for _, typ := range def.types {
			if !known[typ.id] {
				t.Errorf("service %q references unknown cloud-nuke type %q", def.id, typ.id)
			}
		}
	}
}

func TestGlobalTypesAreMarked(t *testing.T) {
	for _, id := range []string{"s3", "iam-user", "iam-role", "cloudfront-distribution", "route53-hosted-zone"} {
		rt, ok := Lookup(id)
		if !ok {
			t.Fatalf("missing %s", id)
		}
		if !rt.Global {
			t.Errorf("%s should be global", id)
		}
	}
	if rt, _ := Lookup("ec2"); rt.Global {
		t.Error("ec2 should be regional")
	}
}
