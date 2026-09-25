// Maps cloud-nuke resource-type ids to the AWS service they belong to, for the
// icon + label UI shared by the landing page and the services step. Icons live
// in web/public/aws; services without an official icon use the generic AWS tile (aws.svg).

export interface AwsService {
  name: string;
  icon?: string; // file stem under /aws/; "aws" is the generic AWS tile for services without an official icon
  mono?: string; // 2-3 letter tile, kept for callers that prefer text
}

const rules: [RegExp, AwsService][] = [
  [/^(asg|launch-configuration|launch-template)$/, { name: "EC2 Auto Scaling", icon: "auto-scaling" }],
  [/^ebs/, { name: "Amazon EBS", icon: "ebs" }],
  [/^elastic-beanstalk$/, { name: "Elastic Beanstalk", icon: "elastic-beanstalk" }],
  [/^(ec2|ami|eip|ec2-keypairs|ec2-placement-groups|ec2-dedicated-hosts)$/, { name: "Amazon EC2", icon: "ec2" }],
  [/^transit-gateway/, { name: "Transit Gateway", icon: "transit-gateway" }],
  [/^ipam/, { name: "VPC IPAM", icon: "vpc" }],
  [/^vpc-lattice/, { name: "VPC Lattice", icon: "vpc-lattice" }],
  [/^network-firewall/, { name: "Network Firewall", icon: "aws" }],
  [/^(vpc|ec2-subnet|security-group|network-acl|ec2-endpoint|nat-gateway|internet-gateway|egress-only-internet-gateway|network-interface|route-table|ec2-dhcp-option|vpc-peering-connection)$/, { name: "Amazon VPC", icon: "vpc" }],
  [/^elb/, { name: "Elastic Load Balancing", icon: "elb" }],
  [/^ecs-/, { name: "Amazon ECS", icon: "ecs" }],
  [/^eks-/, { name: "Amazon EKS", icon: "eks" }],
  [/^ecr$/, { name: "Amazon ECR", icon: "ecr" }],
  [/^app-runner/, { name: "App Runner", icon: "app-runner" }],
  [/^lambda/, { name: "AWS Lambda", icon: "lambda" }],
  [/^api-gateway/, { name: "API Gateway", icon: "api-gateway" }],
  [/^rds-/, { name: "Amazon RDS", icon: "rds" }],
  [/^dynamodb/, { name: "DynamoDB", icon: "dynamodb" }],
  [/^elasticache/, { name: "ElastiCache", icon: "elasticache" }],
  [/^redshift/, { name: "Amazon Redshift", icon: "redshift" }],
  [/^opensearch/, { name: "OpenSearch", icon: "opensearch" }],
  [/^s3/, { name: "Amazon S3", icon: "s3" }],
  [/^efs$/, { name: "Amazon EFS", icon: "efs" }],
  [/^backup-/, { name: "AWS Backup", icon: "backup" }],
  [/^sqs$/, { name: "Amazon SQS", icon: "sqs" }],
  [/^sns/, { name: "Amazon SNS", icon: "sns" }],
  [/^event-bridge/, { name: "EventBridge", icon: "eventbridge" }],
  [/^mq-/, { name: "Amazon MQ", icon: "mq" }],
  [/^msk-/, { name: "Amazon MSK", icon: "msk" }],
  [/^kinesis/, { name: "Kinesis", icon: "kinesis" }],
  [/^ses-/, { name: "Amazon SES", icon: "ses" }],
  [/^cloudwatch/, { name: "CloudWatch", icon: "cloudwatch" }],
  [/^cloudtrail/, { name: "CloudTrail", icon: "cloudtrail" }],
  [/^managed-prometheus/, { name: "Managed Prometheus", icon: "managed-prometheus" }],
  [/^grafana/, { name: "Managed Grafana", icon: "managed-grafana" }],
  [/^config-/, { name: "AWS Config", icon: "aws" }],
  [/^cloudformation/, { name: "CloudFormation", icon: "cloudformation" }],
  [/^codebuild/, { name: "CodeBuild", icon: "codebuild" }],
  [/^codedeploy/, { name: "CodeDeploy", icon: "codedeploy" }],
  [/^data-pipeline/, { name: "Data Pipeline", icon: "data-pipeline" }],
  [/^data-sync/, { name: "DataSync", icon: "datasync" }],
  [/^cloudmap/, { name: "Cloud Map", icon: "cloud-map" }],
  [/^resource-share/, { name: "Resource Access Manager", icon: "ram" }],
  [/^ssm-/, { name: "Systems Manager", icon: "systems-manager" }],
  [/^sagemaker/, { name: "SageMaker", icon: "sagemaker" }],
  [/^kms/, { name: "AWS KMS", icon: "kms" }],
  [/^secrets-manager/, { name: "Secrets Manager", icon: "secrets-manager" }],
  [/^acmpca/, { name: "Private Certificate Authority", icon: "acm-pca" }],
  [/^acm/, { name: "Certificate Manager", icon: "acm" }],
  [/^guard-duty/, { name: "GuardDuty", icon: "guardduty" }],
  [/^security-hub/, { name: "Security Hub", icon: "security-hub" }],
  [/^macie/, { name: "Macie", icon: "macie" }],
  [/^access-analyzer/, { name: "IAM Access Analyzer", icon: "iam" }],
  [/^(iam-|oidc-provider)/, { name: "IAM", icon: "iam" }],
  [/^cloudfront/, { name: "CloudFront", icon: "cloudfront" }],
  [/^route53/, { name: "Route 53", icon: "route-53" }],
];

const cache = new Map<string, AwsService>();

/** The AWS service a resource type belongs to; unknown ids get a tile made from their initials. */
export function awsServiceOf(typeId: string): AwsService {
  const hit = cache.get(typeId);
  if (hit) return hit;
  let out = rules.find(([re]) => re.test(typeId))?.[1];
  if (!out) out = { name: typeId, icon: "aws" };
  cache.set(typeId, out);
  return out;
}

/** Groups resource-type ids by AWS service, keeping first-seen order. */
export function groupByAwsService<T extends { id: string }>(types: T[]): { service: AwsService; types: T[] }[] {
  const out: { service: AwsService; types: T[] }[] = [];
  for (const t of types) {
    const s = awsServiceOf(t.id);
    const g = out.find((x) => x.service.name === s.name);
    if (g) g.types.push(t);
    else out.push({ service: s, types: [t] });
  }
  return out;
}
