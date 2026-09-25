module github.com/4M3Car747c/aws-broom

go 1.26.6

require (
	github.com/aws/aws-sdk-go-v2 v1.47.0
	github.com/aws/aws-sdk-go-v2/config v1.33.5
	github.com/aws/aws-sdk-go-v2/credentials v1.20.5
	github.com/aws/aws-sdk-go-v2/service/ec2 v1.336.0
	github.com/aws/aws-sdk-go-v2/service/sts v1.51.0
	github.com/gruntwork-io/cloud-nuke v0.52.1-0.20260910024755-306d2b7794b9
	github.com/hashicorp/go-multierror v1.1.1
	github.com/pterm/pterm v0.12.83
	golang.org/x/sync v0.23.0
)

require (
	atomicgo.dev/cursor v0.2.0 // indirect
	atomicgo.dev/keyboard v0.2.9 // indirect
	atomicgo.dev/schedule v0.1.0 // indirect
	github.com/aws/aws-sdk-go-v2/aws/protocol/eventstream v1.7.8 // indirect
	github.com/aws/aws-sdk-go-v2/feature/ec2/imds v1.20.0 // indirect
	github.com/aws/aws-sdk-go-v2/internal/configsources v1.5.3 // indirect
	github.com/aws/aws-sdk-go-v2/internal/endpoints/v2 v2.8.3 // indirect
	github.com/aws/aws-sdk-go-v2/internal/v4a v1.5.3 // indirect
	github.com/aws/aws-sdk-go-v2/service/accessanalyzer v1.36.12 // indirect
	github.com/aws/aws-sdk-go-v2/service/acm v1.30.17 // indirect
	github.com/aws/aws-sdk-go-v2/service/acmpca v1.37.17 // indirect
	github.com/aws/aws-sdk-go-v2/service/amp v1.31.0 // indirect
	github.com/aws/aws-sdk-go-v2/service/apigateway v1.28.10 // indirect
	github.com/aws/aws-sdk-go-v2/service/apigatewayv2 v1.24.16 // indirect
	github.com/aws/aws-sdk-go-v2/service/apprunner v1.32.14 // indirect
	github.com/aws/aws-sdk-go-v2/service/autoscaling v1.51.11 // indirect
	github.com/aws/aws-sdk-go-v2/service/backup v1.40.9 // indirect
	github.com/aws/aws-sdk-go-v2/service/cloudformation v1.65.2 // indirect
	github.com/aws/aws-sdk-go-v2/service/cloudfront v1.45.2 // indirect
	github.com/aws/aws-sdk-go-v2/service/cloudtrail v1.47.3 // indirect
	github.com/aws/aws-sdk-go-v2/service/cloudwatch v1.43.13 // indirect
	github.com/aws/aws-sdk-go-v2/service/cloudwatchlogs v1.65.0 // indirect
	github.com/aws/aws-sdk-go-v2/service/codedeploy v1.29.17 // indirect
	github.com/aws/aws-sdk-go-v2/service/configservice v1.51.11 // indirect
	github.com/aws/aws-sdk-go-v2/service/datapipeline v1.30.18 // indirect
	github.com/aws/aws-sdk-go-v2/service/datasync v1.45.3 // indirect
	github.com/aws/aws-sdk-go-v2/service/dynamodb v1.39.9 // indirect
	github.com/aws/aws-sdk-go-v2/service/ecr v1.40.2 // indirect
	github.com/aws/aws-sdk-go-v2/service/ecs v1.53.12 // indirect
	github.com/aws/aws-sdk-go-v2/service/efs v1.34.10 // indirect
	github.com/aws/aws-sdk-go-v2/service/eks v1.57.3 // indirect
	github.com/aws/aws-sdk-go-v2/service/elasticache v1.44.11 // indirect
	github.com/aws/aws-sdk-go-v2/service/elasticbeanstalk v1.28.15 // indirect
	github.com/aws/aws-sdk-go-v2/service/elasticloadbalancing v1.28.16 // indirect
	github.com/aws/aws-sdk-go-v2/service/elasticloadbalancingv2 v1.43.11 // indirect
	github.com/aws/aws-sdk-go-v2/service/eventbridge v1.36.10 // indirect
	github.com/aws/aws-sdk-go-v2/service/firehose v1.36.3 // indirect
	github.com/aws/aws-sdk-go-v2/service/grafana v1.26.14 // indirect
	github.com/aws/aws-sdk-go-v2/service/guardduty v1.52.9 // indirect
	github.com/aws/aws-sdk-go-v2/service/iam v1.39.0 // indirect
	github.com/aws/aws-sdk-go-v2/service/internal/accept-encoding v1.13.19 // indirect
	github.com/aws/aws-sdk-go-v2/service/internal/checksum v1.9.13 // indirect
	github.com/aws/aws-sdk-go-v2/service/internal/endpoint-discovery v1.10.12 // indirect
	github.com/aws/aws-sdk-go-v2/service/internal/presigned-url v1.14.3 // indirect
	github.com/aws/aws-sdk-go-v2/service/internal/s3shared v1.19.21 // indirect
	github.com/aws/aws-sdk-go-v2/service/kafka v1.38.15 // indirect
	github.com/aws/aws-sdk-go-v2/service/kinesis v1.43.5 // indirect
	github.com/aws/aws-sdk-go-v2/service/kms v1.37.17 // indirect
	github.com/aws/aws-sdk-go-v2/service/lambda v1.88.5 // indirect
	github.com/aws/aws-sdk-go-v2/service/macie2 v1.44.8 // indirect
	github.com/aws/aws-sdk-go-v2/service/mq v1.34.19 // indirect
	github.com/aws/aws-sdk-go-v2/service/networkfirewall v1.44.13 // indirect
	github.com/aws/aws-sdk-go-v2/service/opensearch v1.45.10 // indirect
	github.com/aws/aws-sdk-go-v2/service/ram v1.36.2 // indirect
	github.com/aws/aws-sdk-go-v2/service/rds v1.93.11 // indirect
	github.com/aws/aws-sdk-go-v2/service/redshift v1.53.11 // indirect
	github.com/aws/aws-sdk-go-v2/service/route53 v1.48.6 // indirect
	github.com/aws/aws-sdk-go-v2/service/s3 v1.97.3 // indirect
	github.com/aws/aws-sdk-go-v2/service/s3control v1.53.3 // indirect
	github.com/aws/aws-sdk-go-v2/service/sagemaker v1.174.1 // indirect
	github.com/aws/aws-sdk-go-v2/service/scheduler v1.12.16 // indirect
	github.com/aws/aws-sdk-go-v2/service/secretsmanager v1.34.17 // indirect
	github.com/aws/aws-sdk-go-v2/service/securityhub v1.55.8 // indirect
	github.com/aws/aws-sdk-go-v2/service/servicediscovery v1.39.3 // indirect
	github.com/aws/aws-sdk-go-v2/service/ses v1.29.9 // indirect
	github.com/aws/aws-sdk-go-v2/service/signin v1.10.0 // indirect
	github.com/aws/aws-sdk-go-v2/service/sns v1.33.18 // indirect
	github.com/aws/aws-sdk-go-v2/service/sqs v1.37.13 // indirect
	github.com/aws/aws-sdk-go-v2/service/ssm v1.56.0 // indirect
	github.com/aws/aws-sdk-go-v2/service/sso v1.38.0 // indirect
	github.com/aws/aws-sdk-go-v2/service/ssooidc v1.43.0 // indirect
	github.com/aws/aws-sdk-go-v2/service/vpclattice v1.13.9 // indirect
	github.com/aws/smithy-go v1.28.1 // indirect
	github.com/clipperhouse/uax29/v2 v2.7.0 // indirect
	github.com/containerd/console v1.0.5 // indirect
	github.com/cpuguy83/go-md2man/v2 v2.0.2 // indirect
	github.com/go-errors/errors v1.4.2 // indirect
	github.com/google/uuid v1.6.0 // indirect
	github.com/gookit/color v1.6.0 // indirect
	github.com/gruntwork-io/go-commons v0.17.0 // indirect
	github.com/hashicorp/errwrap v1.0.0 // indirect
	github.com/jmespath/go-jmespath v0.4.0 // indirect
	github.com/kr/pretty v0.3.1 // indirect
	github.com/lithammer/fuzzysearch v1.1.8 // indirect
	github.com/mattn/go-runewidth v0.0.20 // indirect
	github.com/rogpeppe/go-internal v1.14.1 // indirect
	github.com/russross/blackfriday/v2 v2.1.0 // indirect
	github.com/sirupsen/logrus v1.8.3 // indirect
	github.com/urfave/cli/v2 v2.10.3 // indirect
	github.com/xo/terminfo v0.0.0-20220910002029-abceb7e1c41e // indirect
	github.com/xrash/smetrics v0.0.0-20201216005158-039620a65673 // indirect
	golang.org/x/exp v0.0.0-20221106115401-f9659909a136 // indirect
	golang.org/x/sys v0.47.0 // indirect
	golang.org/x/term v0.45.0 // indirect
	golang.org/x/text v0.41.0 // indirect
	gopkg.in/check.v1 v1.0.0-20201130134442-10cb98267c6c // indirect
	gopkg.in/yaml.v2 v2.4.0 // indirect
)
