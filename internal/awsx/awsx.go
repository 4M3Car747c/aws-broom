// Package awsx holds the few AWS calls the server process makes directly
// (identity check and region discovery). Everything that scans or deletes
// resources lives in the worker process via internal/engine.
package awsx

import (
	"context"
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/credentials"
	"github.com/aws/aws-sdk-go-v2/service/ec2"
	ec2types "github.com/aws/aws-sdk-go-v2/service/ec2/types"
	"github.com/aws/aws-sdk-go-v2/service/sts"
)

// Credentials is a static AWS credential triple. It is never logged or persisted.
type Credentials struct {
	AccessKeyID     string
	SecretAccessKey string
	SessionToken    string
}

// Zero overwrites the secret material in place.
func (c *Credentials) Zero() {
	c.AccessKeyID = ""
	c.SecretAccessKey = ""
	c.SessionToken = ""
}

// IsTemporary reports whether the credentials look like STS temporary credentials.
func (c Credentials) IsTemporary() bool {
	return c.SessionToken != "" || strings.HasPrefix(c.AccessKeyID, "ASIA")
}

// Identity is the result of sts:GetCallerIdentity plus derived fields.
type Identity struct {
	AccountID   string
	ARN         string
	UserID      string
	IAMUserName string // set when the ARN is an IAM user (arn:aws:iam::123:user/name)
	Principal   string // human-readable principal: "user/name", "assumed-role/Role/session", "root"
	Partition   string // "aws", "aws-cn" or "aws-us-gov", from the ARN
}

// Config builds an aws.Config for the given region using static credentials.
// The IMDS credential source is disabled so a bad key never falls back to the
// host's own role.
func Config(ctx context.Context, creds Credentials, region string) (aws.Config, error) {
	return config.LoadDefaultConfig(ctx,
		config.WithRegion(region),
		config.WithCredentialsProvider(credentials.NewStaticCredentialsProvider(creds.AccessKeyID, creds.SecretAccessKey, creds.SessionToken)),
		config.WithEC2IMDSClientEnableState(1), // imds.ClientDisabled
		config.WithRetryMaxAttempts(3),
	)
}

// GetCallerIdentity validates the credentials and returns the caller's identity.
func GetCallerIdentity(ctx context.Context, creds Credentials, region string) (Identity, error) {
	if region == "" {
		region = "us-east-1"
	}
	cfg, err := Config(ctx, creds, region)
	if err != nil {
		return Identity{}, err
	}
	ctx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()
	out, err := sts.NewFromConfig(cfg).GetCallerIdentity(ctx, &sts.GetCallerIdentityInput{})
	if err != nil {
		return Identity{}, err
	}
	id := Identity{
		AccountID: aws.ToString(out.Account),
		ARN:       aws.ToString(out.Arn),
		UserID:    aws.ToString(out.UserId),
	}
	id.IAMUserName = iamUserNameFromARN(id.ARN)
	id.Principal = principalFromARN(id.ARN)
	id.Partition = partitionFromARN(id.ARN)
	return id, nil
}

func partitionFromARN(arn string) string {
	parts := strings.SplitN(arn, ":", 3)
	if len(parts) < 3 || parts[1] == "" {
		return "aws"
	}
	return parts[1]
}

// seedRegions returns the regions to try for DescribeRegions, most likely
// first. Each failed attempt costs up to 20 s, so the partition matters.
func seedRegions(partition string) []string {
	switch partition {
	case "aws-cn":
		return []string{"cn-north-1", "cn-northwest-1"}
	case "aws-us-gov":
		return []string{"us-gov-west-1", "us-gov-east-1"}
	default:
		return []string{"us-east-1", "eu-west-1", "ap-southeast-1"}
	}
}

// principalFromARN returns the resource part of an IAM/STS ARN, e.g.
// "user/alice", "assumed-role/Admin/alice@laptop", "root".
func principalFromARN(arn string) string {
	parts := strings.SplitN(arn, ":", 6)
	if len(parts) != 6 {
		return arn
	}
	return parts[5]
}

func iamUserNameFromARN(arn string) string {
	// arn:aws:iam::123456789012:user/path/name
	parts := strings.SplitN(arn, ":", 6)
	if len(parts) != 6 || parts[2] != "iam" {
		return ""
	}
	res := parts[5]
	if !strings.HasPrefix(res, "user/") {
		return ""
	}
	segs := strings.Split(res, "/")
	return segs[len(segs)-1]
}

// Region describes an enabled AWS region.
type Region struct {
	Code  string `json:"code"`
	Group string `json:"group"` // americas | europe | asia-pacific | middle-east-africa | china | gov | other
}

// ListEnabledRegions returns the regions enabled for the account, sorted by
// code. partition selects which seed regions to query (see seedRegions).
func ListEnabledRegions(ctx context.Context, creds Credentials, partition string) ([]Region, error) {
	var lastErr error
	for _, seed := range seedRegions(partition) {
		cfg, err := Config(ctx, creds, seed)
		if err != nil {
			return nil, err
		}
		cctx, cancel := context.WithTimeout(ctx, 20*time.Second)
		out, err := ec2.NewFromConfig(cfg).DescribeRegions(cctx, &ec2.DescribeRegionsInput{
			AllRegions: aws.Bool(false),
			Filters: []ec2types.Filter{{
				Name:   aws.String("opt-in-status"),
				Values: []string{"opt-in-not-required", "opted-in"},
			}},
		})
		cancel()
		if err != nil {
			lastErr = err
			continue
		}
		regions := make([]Region, 0, len(out.Regions))
		for _, r := range out.Regions {
			code := aws.ToString(r.RegionName)
			regions = append(regions, Region{Code: code, Group: RegionGroup(code)})
		}
		sort.Slice(regions, func(i, j int) bool { return regions[i].Code < regions[j].Code })
		return regions, nil
	}
	if lastErr == nil {
		lastErr = errors.New("no seed region answered DescribeRegions")
	}
	return nil, fmt.Errorf("describe regions: %w", lastErr)
}

// RegionGroup classifies a region code for display grouping.
func RegionGroup(code string) string {
	switch {
	case strings.HasPrefix(code, "us-gov-"):
		return "gov"
	case strings.HasPrefix(code, "cn-"):
		return "china"
	case strings.HasPrefix(code, "us-"), strings.HasPrefix(code, "ca-"), strings.HasPrefix(code, "sa-"), strings.HasPrefix(code, "mx-"):
		return "americas"
	case strings.HasPrefix(code, "eu-"):
		return "europe"
	case strings.HasPrefix(code, "ap-"):
		return "asia-pacific"
	case strings.HasPrefix(code, "me-"), strings.HasPrefix(code, "af-"), strings.HasPrefix(code, "il-"):
		return "middle-east-africa"
	default:
		return "other"
	}
}
