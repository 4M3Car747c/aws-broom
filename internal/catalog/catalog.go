// Package catalog groups cloud-nuke resource types into user-facing AWS
// services. Service and resource-type IDs are stable keys; the frontend owns
// the translated labels.
package catalog

import (
	"sort"
	"sync"

	"github.com/aws/aws-sdk-go-v2/aws"
	cnaws "github.com/gruntwork-io/cloud-nuke/aws"
)

// Risk is a coarse hint for the UI: high-risk services are unselected by default.
type Risk string

const (
	RiskLow    Risk = "low"
	RiskMedium Risk = "medium"
	RiskHigh   Risk = "high"
)

// ResourceType is one cloud-nuke resource type.
type ResourceType struct {
	ID     string `json:"id"`     // cloud-nuke resource type id, e.g. "ec2"
	Label  string `json:"label"`  // English label; frontend may override per locale
	Global bool   `json:"global"` // lives in the "global" pseudo-region
	Risk   Risk   `json:"risk"`
}

// Service is a user-facing group of resource types.
type Service struct {
	ID              string         `json:"id"`
	Risk            Risk           `json:"risk"`
	DefaultSelected bool           `json:"defaultSelected"`
	ResourceTypes   []ResourceType `json:"resourceTypes"`
}

// serviceDef is the hand-maintained grouping. Anything cloud-nuke knows that is
// not listed here lands in the "other" service at build time.
type serviceDef struct {
	id       string
	risk     Risk
	selected bool
	types    []typeDef
}

type typeDef struct {
	id    string
	label string
	risk  Risk // empty = inherit service risk
}

var serviceDefs = []serviceDef{
	{id: "ec2", risk: RiskLow, selected: true, types: []typeDef{
		{id: "ec2", label: "EC2 instances"},
		{id: "asg", label: "Auto Scaling groups"},
		{id: "launch-configuration", label: "Launch configurations"},
		{id: "launch-template", label: "Launch templates"},
		{id: "ebs", label: "EBS volumes"},
		{id: "ebs-snapshot", label: "EBS snapshots"},
		{id: "ami", label: "AMIs"},
		{id: "eip", label: "Elastic IPs"},
		{id: "ec2-keypairs", label: "Key pairs"},
		{id: "ec2-placement-groups", label: "Placement groups"},
		{id: "ec2-dedicated-hosts", label: "Dedicated hosts"},
		{id: "elastic-beanstalk", label: "Elastic Beanstalk environments"},
	}},
	{id: "vpc", risk: RiskMedium, selected: true, types: []typeDef{
		{id: "vpc", label: "VPCs"},
		{id: "ec2-subnet", label: "Subnets"},
		{id: "security-group", label: "Security groups"},
		{id: "network-acl", label: "Network ACLs"},
		{id: "ec2-endpoint", label: "VPC endpoints"},
		{id: "nat-gateway", label: "NAT gateways"},
		{id: "internet-gateway", label: "Internet gateways"},
		{id: "egress-only-internet-gateway", label: "Egress-only internet gateways"},
		{id: "network-interface", label: "Network interfaces"},
		{id: "route-table", label: "Route tables"},
		{id: "ec2-dhcp-option", label: "DHCP option sets"},
		{id: "vpc-peering-connection", label: "VPC peering connections"},
		{id: "transit-gateway", label: "Transit gateways"},
		{id: "transit-gateway-attachment", label: "Transit gateway attachments"},
		{id: "transit-gateway-peering-attachment", label: "Transit gateway peering attachments"},
		{id: "transit-gateway-route-table", label: "Transit gateway route tables"},
		{id: "ipam", label: "IPAM"},
		{id: "ipam-pool", label: "IPAM pools"},
		{id: "ipam-scope", label: "IPAM scopes"},
		{id: "ipam-byoasn", label: "IPAM BYOASN"},
		{id: "ipam-custom-allocation", label: "IPAM custom allocations"},
		{id: "ipam-resource-discovery", label: "IPAM resource discoveries"},
		{id: "vpc-lattice-service", label: "VPC Lattice services"},
		{id: "vpc-lattice-service-network", label: "VPC Lattice service networks"},
		{id: "vpc-lattice-target-group", label: "VPC Lattice target groups"},
		{id: "network-firewall", label: "Network Firewall firewalls"},
		{id: "network-firewall-policy", label: "Network Firewall policies"},
		{id: "network-firewall-rule-group", label: "Network Firewall rule groups"},
		{id: "network-firewall-tls-config", label: "Network Firewall TLS configs"},
		{id: "network-firewall-resource-policy", label: "Network Firewall resource policies"},
	}},
	{id: "load-balancing", risk: RiskLow, selected: true, types: []typeDef{
		{id: "elb", label: "Classic load balancers"},
		{id: "elbv2", label: "Application/Network load balancers"},
	}},
	{id: "containers", risk: RiskLow, selected: true, types: []typeDef{
		{id: "ecs-cluster", label: "ECS clusters"},
		{id: "ecs-service", label: "ECS services"},
		{id: "eks-cluster", label: "EKS clusters"},
		{id: "ecr", label: "ECR repositories"},
		{id: "app-runner-service", label: "App Runner services"},
	}},
	{id: "serverless", risk: RiskLow, selected: true, types: []typeDef{
		{id: "lambda", label: "Lambda functions"},
		{id: "lambda-layer", label: "Lambda layers"},
		{id: "api-gateway", label: "API Gateway (REST)"},
		{id: "api-gateway-v2", label: "API Gateway (HTTP/WebSocket)"},
	}},
	{id: "databases", risk: RiskMedium, selected: true, types: []typeDef{
		{id: "rds-instance", label: "RDS instances"},
		{id: "rds-cluster", label: "RDS/Aurora clusters"},
		{id: "rds-snapshot", label: "RDS snapshots"},
		{id: "rds-cluster-snapshot", label: "RDS cluster snapshots"},
		{id: "rds-parameter-group", label: "RDS parameter groups"},
		{id: "rds-subnet-group", label: "RDS subnet groups"},
		{id: "rds-proxy", label: "RDS proxies"},
		{id: "rds-global-cluster", label: "RDS global clusters"},
		{id: "rds-global-cluster-membership", label: "RDS global cluster memberships"},
		{id: "dynamodb", label: "DynamoDB tables"},
		{id: "elasticache", label: "ElastiCache clusters"},
		{id: "elasticache-serverless", label: "ElastiCache serverless caches"},
		{id: "elasticache-parameter-group", label: "ElastiCache parameter groups"},
		{id: "elasticache-subnet-group", label: "ElastiCache subnet groups"},
		{id: "redshift", label: "Redshift clusters"},
		{id: "redshift-snapshot-copy-grant", label: "Redshift snapshot copy grants"},
		{id: "opensearch-domain", label: "OpenSearch domains"},
	}},
	{id: "storage", risk: RiskMedium, selected: true, types: []typeDef{
		{id: "s3", label: "S3 buckets"},
		{id: "s3-access-point", label: "S3 access points"},
		{id: "s3-multi-region-access-point", label: "S3 multi-region access points"},
		{id: "s3-object-lambda-access-point", label: "S3 Object Lambda access points"},
		{id: "efs", label: "EFS file systems"},
		{id: "backup-plan", label: "AWS Backup plans"},
		{id: "backup-vault", label: "AWS Backup vaults"},
	}},
	{id: "messaging", risk: RiskLow, selected: true, types: []typeDef{
		{id: "sqs", label: "SQS queues"},
		{id: "sns-topic", label: "SNS topics"},
		{id: "event-bridge", label: "EventBridge event buses"},
		{id: "event-bridge-rule", label: "EventBridge rules"},
		{id: "event-bridge-archive", label: "EventBridge archives"},
		{id: "event-bridge-schedule", label: "EventBridge schedules"},
		{id: "event-bridge-schedule-group", label: "EventBridge schedule groups"},
		{id: "mq-broker", label: "Amazon MQ brokers"},
		{id: "msk-cluster", label: "MSK clusters"},
		{id: "kinesis-stream", label: "Kinesis data streams"},
		{id: "kinesis-firehose", label: "Kinesis Firehose streams"},
		{id: "ses-identity", label: "SES identities"},
		{id: "ses-configuration-set", label: "SES configuration sets"},
		{id: "ses-email-template", label: "SES email templates"},
		{id: "ses-receipt-rule-set", label: "SES receipt rule sets"},
		{id: "ses-receipt-filter", label: "SES receipt filters"},
	}},
	{id: "monitoring", risk: RiskLow, selected: true, types: []typeDef{
		{id: "cloudwatch-loggroup", label: "CloudWatch log groups"},
		{id: "cloudwatch-alarm", label: "CloudWatch alarms"},
		{id: "cloudwatch-dashboard", label: "CloudWatch dashboards"},
		{id: "cloudtrail", label: "CloudTrail trails"},
		{id: "managed-prometheus", label: "Managed Prometheus workspaces"},
		{id: "grafana", label: "Managed Grafana workspaces"},
		{id: "config-recorders", label: "AWS Config recorders"},
		{id: "config-rules", label: "AWS Config rules"},
	}},
	{id: "devtools", risk: RiskLow, selected: true, types: []typeDef{
		{id: "cloudformation-stack", label: "CloudFormation stacks"},
		{id: "codedeploy-application", label: "CodeDeploy applications"},
		{id: "data-pipeline", label: "Data Pipeline pipelines"},
		{id: "data-sync-task", label: "DataSync tasks"},
		{id: "data-sync-location", label: "DataSync locations"},
		{id: "cloudmap-namespace", label: "Cloud Map namespaces"},
		{id: "cloudmap-service", label: "Cloud Map services"},
		{id: "resource-share", label: "RAM resource shares"},
		{id: "ssm-parameter", label: "SSM parameters"},
	}},
	{id: "ml", risk: RiskLow, selected: true, types: []typeDef{
		{id: "sagemaker-notebook-instance", label: "SageMaker notebook instances"},
		{id: "sagemaker-endpoint", label: "SageMaker endpoints"},
		{id: "sagemaker-endpoint-config", label: "SageMaker endpoint configs"},
		{id: "sagemaker-studio", label: "SageMaker Studio domains"},
	}},
	{id: "security", risk: RiskHigh, selected: false, types: []typeDef{
		{id: "kms-customer-key", label: "KMS customer keys (scheduled 7-day deletion)"},
		{id: "secrets-manager", label: "Secrets Manager secrets"},
		{id: "acm", label: "ACM certificates"},
		{id: "acmpca", label: "ACM Private CA"},
		{id: "guard-duty", label: "GuardDuty detectors"},
		{id: "security-hub", label: "Security Hub"},
		{id: "macie-member", label: "Macie"},
		{id: "access-analyzer", label: "IAM Access Analyzer analyzers"},
	}},
	{id: "iam", risk: RiskHigh, selected: false, types: []typeDef{
		{id: "iam-user", label: "IAM users"},
		{id: "iam-group", label: "IAM groups"},
		{id: "iam-role", label: "IAM roles"},
		{id: "iam-service-linked-role", label: "IAM service-linked roles"},
		{id: "iam-instance-profile", label: "IAM instance profiles"},
		{id: "iam-policy", label: "IAM customer-managed policies"},
		{id: "oidc-provider", label: "IAM OIDC providers"},
	}},
	{id: "edge-dns", risk: RiskHigh, selected: false, types: []typeDef{
		{id: "cloudfront-distribution", label: "CloudFront distributions"},
		{id: "route53-hosted-zone", label: "Route 53 hosted zones"},
		{id: "route53-cidr-collection", label: "Route 53 CIDR collections"},
		{id: "route53-traffic-policy", label: "Route 53 traffic policies"},
	}},
}

var (
	buildOnce sync.Once
	services  []Service
	byType    map[string]ResourceType
	globalSet map[string]bool
)

func build() {
	known := cnaws.ListResourceTypes()
	knownSet := make(map[string]bool, len(known))
	for _, id := range known {
		knownSet[id] = true
	}
	globalSet = map[string]bool{}
	// Init with an empty config only allocates SDK clients; no API calls are made.
	for _, r := range cnaws.GetAndInitRegisteredResources(aws.Config{}, cnaws.GlobalRegion) {
		globalSet[(*r).ResourceName()] = true
	}

	byType = map[string]ResourceType{}
	services = services[:0]
	for _, def := range serviceDefs {
		svc := Service{ID: def.id, Risk: def.risk, DefaultSelected: def.selected}
		for _, t := range def.types {
			if !knownSet[t.id] {
				continue // dropped upstream; keep the catalog honest
			}
			risk := t.risk
			if risk == "" {
				risk = def.risk
			}
			rt := ResourceType{ID: t.id, Label: t.label, Global: globalSet[t.id], Risk: risk}
			svc.ResourceTypes = append(svc.ResourceTypes, rt)
			byType[t.id] = rt
		}
		if len(svc.ResourceTypes) > 0 {
			services = append(services, svc)
		}
	}

	other := Service{ID: "other", Risk: RiskMedium, DefaultSelected: false}
	for _, id := range known {
		if _, ok := byType[id]; ok {
			continue
		}
		rt := ResourceType{ID: id, Label: id, Global: globalSet[id], Risk: RiskMedium}
		other.ResourceTypes = append(other.ResourceTypes, rt)
		byType[id] = rt
	}
	sort.Slice(other.ResourceTypes, func(i, j int) bool { return other.ResourceTypes[i].ID < other.ResourceTypes[j].ID })
	if len(other.ResourceTypes) > 0 {
		services = append(services, other)
	}
}

// Services returns the full catalog.
func Services() []Service {
	buildOnce.Do(build)
	return services
}

// Lookup returns the resource type for an id.
func Lookup(id string) (ResourceType, bool) {
	buildOnce.Do(build)
	rt, ok := byType[id]
	return rt, ok
}

// IsGlobal reports whether a resource type lives in the "global" pseudo-region.
func IsGlobal(id string) bool {
	buildOnce.Do(build)
	return globalSet[id]
}

// Unmapped lists resource types cloud-nuke knows that are not in serviceDefs
// (they are exposed under the "other" service). Used by tests.
func Unmapped() []string {
	buildOnce.Do(build)
	for _, s := range services {
		if s.ID == "other" {
			ids := make([]string, 0, len(s.ResourceTypes))
			for _, rt := range s.ResourceTypes {
				ids = append(ids, rt.ID)
			}
			return ids
		}
	}
	return nil
}
