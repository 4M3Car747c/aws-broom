// Command iampolicy derives the IAM policy documents under docs/iam/ from the
// cloud-nuke sources this build links against.
//
// Every cloud-nuke resource declares the SDK client interface it needs; the
// method names of that interface are exactly the API operations it calls. This
// tool parses those interfaces, maps each operation to its IAM action, groups
// the result by the catalog's user-facing services and writes:
//
//	docs/iam/scan.json           read-only actions for scanning (all services)
//	docs/iam/clean-<service>.json read + delete actions for one service group
//	docs/iam/actions.md          per-resource-type table (for review)
//
// Run it after every cloud-nuke upgrade: `make iam-policy`.
package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"go/ast"
	"go/parser"
	"go/token"
	"io/fs"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"

	cnaws "github.com/gruntwork-io/cloud-nuke/aws"

	"github.com/4M3Car747c/aws-broom/internal/catalog"
)

// iamPrefix maps an aws-sdk-go-v2 service package name to its IAM action prefix
// when the two differ. Unknown packages fail loudly so upgrades get reviewed.
var iamPrefix = map[string]string{
	"accessanalyzer":         "access-analyzer",
	"acm":                    "acm",
	"acmpca":                 "acm-pca",
	"amp":                    "aps",
	"apigateway":             "apigateway",
	"apigatewayv2":           "apigateway",
	"apprunner":              "apprunner",
	"autoscaling":            "autoscaling",
	"backup":                 "backup",
	"cloudformation":         "cloudformation",
	"cloudfront":             "cloudfront",
	"cloudtrail":             "cloudtrail",
	"cloudwatch":             "cloudwatch",
	"cloudwatchlogs":         "logs",
	"codedeploy":             "codedeploy",
	"configservice":          "config",
	"datapipeline":           "datapipeline",
	"datasync":               "datasync",
	"dynamodb":               "dynamodb",
	"ec2":                    "ec2",
	"ecr":                    "ecr",
	"ecs":                    "ecs",
	"efs":                    "elasticfilesystem",
	"eks":                    "eks",
	"elasticache":            "elasticache",
	"elasticbeanstalk":       "elasticbeanstalk",
	"elasticloadbalancing":   "elasticloadbalancing",
	"elasticloadbalancingv2": "elasticloadbalancing",
	"eventbridge":            "events",
	"firehose":               "firehose",
	"grafana":                "grafana",
	"guardduty":              "guardduty",
	"iam":                    "iam",
	"kafka":                  "kafka",
	"kinesis":                "kinesis",
	"kms":                    "kms",
	"lambda":                 "lambda",
	"macie2":                 "macie2",
	"mq":                     "mq",
	"networkfirewall":        "network-firewall",
	"opensearch":             "es",
	"ram":                    "ram",
	"rds":                    "rds",
	"redshift":               "redshift",
	"route53":                "route53",
	"s3":                     "s3",
	"s3control":              "s3",
	"sagemaker":              "sagemaker",
	"scheduler":              "scheduler",
	"secretsmanager":         "secretsmanager",
	"securityhub":            "securityhub",
	"servicediscovery":       "servicediscovery",
	"ses":                    "ses",
	"sns":                    "sns",
	"sqs":                    "sqs",
	"ssm":                    "ssm",
	"sts":                    "sts",
	"vpclattice":             "vpc-lattice",
}

// opActions overrides the default "<prefix>:<Operation>" mapping for APIs whose
// IAM action names differ from the operation names.
var opActions = map[string][]string{
	"s3.ListBuckets":           {"s3:ListAllMyBuckets"},
	"s3.HeadBucket":            {"s3:ListBucket"},
	"s3.ListObjectsV2":         {"s3:ListBucket"},
	"s3.ListObjectVersions":    {"s3:ListBucketVersions"},
	"s3.DeleteObjects":         {"s3:DeleteObject", "s3:DeleteObjectVersion"},
	"s3.DeleteBucketLifecycle": {"s3:PutLifecycleConfiguration"},
	"apigateway.GetRestApis":   {"apigateway:GET"},
	"apigateway.DeleteRestApi": {"apigateway:DELETE"},
	"apigatewayv2.GetApis":     {"apigateway:GET"},
	"apigatewayv2.DeleteApi":   {"apigateway:DELETE"},
}

// baseActions are needed by the server process and by every worker run.
var baseActions = []string{"sts:GetCallerIdentity", "ec2:DescribeRegions"}

var (
	readOnlyRe = regexp.MustCompile(`^[a-z0-9-]+:(List|Describe|Get|Head|Search|Lookup|Query|Scan|Batch(Get|Describe)|GET)`)
	tagWriteRe = regexp.MustCompile(`^[a-z0-9-]+:(CreateTags|Tag[A-Z]\w*|AddTags\w*|PutBucketTagging)$`)
)

type resourceInfo struct {
	ID          string
	File        string
	Iface       string
	Actions     []string // sorted, unique IAM actions
	DryRunCheck bool     // cloud-nuke verifies delete permission during the scan
}

type method struct {
	op      string
	service string
}

func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, "iampolicy:", err)
		os.Exit(1)
	}
}

func run() error {
	dir, version, err := cloudNukeModule()
	if err != nil {
		return err
	}
	infos, err := extract(filepath.Join(dir, "aws", "resources"))
	if err != nil {
		return err
	}

	// Coverage: every resource type cloud-nuke registers must have been found.
	byID := map[string]*resourceInfo{}
	for _, r := range infos {
		byID[r.ID] = r
	}
	var missing []string
	for _, id := range cnaws.ListResourceTypes() {
		if _, ok := byID[id]; !ok {
			missing = append(missing, id)
		}
	}
	if len(missing) > 0 {
		return fmt.Errorf("no client interface found for resource types %v; update tools/iampolicy", missing)
	}

	outDir := "docs/iam"
	if err := os.MkdirAll(outDir, 0o755); err != nil {
		return err
	}

	// scan.json: read-only actions across the whole catalog, plus the tag
	// writes that the "older than" filter needs.
	read, tags := map[string]bool{}, map[string]bool{}
	for _, r := range infos {
		for _, a := range r.Actions {
			switch {
			case readOnlyRe.MatchString(a):
				read[a] = true
			case tagWriteRe.MatchString(a):
				tags[a] = true
			}
		}
	}
	scan := policy{
		{Sid: "BroomBase", Action: baseActions},
		{Sid: "BroomScanReadOnly", Action: keys(read)},
		{Sid: "BroomScanOlderThanFirstSeenTags", Action: keys(tags)},
	}
	// scan.json is meant as an inline policy (10240-char limit), see docs/iam-policy.md.
	if err := writePolicy(filepath.Join(outDir, "scan.json"), scan, false); err != nil {
		return err
	}

	// clean-<service>.json: everything one service group needs.
	var sizes []string
	for _, svc := range catalog.Services() {
		set := map[string]bool{}
		for _, rt := range svc.ResourceTypes {
			for _, a := range byID[rt.ID].Actions {
				set[a] = true
			}
		}
		p := policy{
			{Sid: "BroomBase", Action: baseActions},
			{Sid: "BroomClean" + pascal(svc.ID), Action: keys(set)},
		}
		name := filepath.Join(outDir, "clean-"+svc.ID+".json")
		if err := writePolicy(name, p, true); err != nil {
			return err
		}
		sizes = append(sizes, fmt.Sprintf("%s: %d actions, %d chars", name, len(set), p.size()))
	}

	if err := writeTable(filepath.Join(outDir, "actions.md"), infos, version); err != nil {
		return err
	}
	fmt.Println("cloud-nuke", version)
	fmt.Printf("%s: %d read-only actions, %d chars\n", filepath.Join(outDir, "scan.json"), len(read), scan.size())
	for _, s := range sizes {
		fmt.Println(s)
	}
	return nil
}

func cloudNukeModule() (dir, version string, err error) {
	out, err := exec.Command("go", "list", "-m", "-f", "{{.Dir}} {{.Version}}", "github.com/gruntwork-io/cloud-nuke").Output()
	if err != nil {
		return "", "", fmt.Errorf("go list cloud-nuke: %w", err)
	}
	f := strings.Fields(string(out))
	if len(f) != 2 {
		return "", "", fmt.Errorf("unexpected go list output %q", out)
	}
	return f[0], f[1], nil
}

// extract parses cloud-nuke's aws/resources package and returns one entry per
// registered resource type.
func extract(dir string) ([]*resourceInfo, error) {
	fset := token.NewFileSet()
	pkgs, err := parser.ParseDir(fset, dir, func(fi fs.FileInfo) bool {
		return !strings.HasSuffix(fi.Name(), "_test.go")
	}, 0)
	if err != nil {
		return nil, err
	}
	pkg, ok := pkgs["resources"]
	if !ok {
		return nil, fmt.Errorf("package resources not found in %s", dir)
	}

	// Pass 1: package-level string constants and every client interface.
	consts := map[string]string{}
	ifaces := map[string][]method{}
	for _, f := range pkg.Files {
		imports := map[string]string{} // alias -> service package name
		for _, im := range f.Imports {
			path := strings.Trim(im.Path.Value, `"`)
			alias := filepath.Base(path)
			if im.Name != nil {
				alias = im.Name.Name
			}
			if strings.HasPrefix(path, "github.com/aws/aws-sdk-go-v2/service/") {
				imports[alias] = filepath.Base(path)
			}
		}
		for _, d := range f.Decls {
			gd, ok := d.(*ast.GenDecl)
			if !ok {
				continue
			}
			for _, sp := range gd.Specs {
				switch s := sp.(type) {
				case *ast.ValueSpec:
					if gd.Tok != token.CONST {
						continue
					}
					for i, n := range s.Names {
						if i < len(s.Values) {
							if lit, ok := s.Values[i].(*ast.BasicLit); ok && lit.Kind == token.STRING {
								consts[n.Name], _ = strconv.Unquote(lit.Value)
							}
						}
					}
				case *ast.TypeSpec:
					it, ok := s.Type.(*ast.InterfaceType)
					if !ok {
						continue
					}
					var ms []method
					for _, fld := range it.Methods.List {
						ft, ok := fld.Type.(*ast.FuncType)
						if !ok || len(fld.Names) == 0 || ft.Params == nil || len(ft.Params.List) < 2 {
							continue
						}
						svc := serviceOf(ft.Params.List[1].Type, imports)
						if svc == "" {
							return nil, fmt.Errorf("%s.%s: cannot tell which SDK service the input type belongs to", s.Name.Name, fld.Names[0].Name)
						}
						ms = append(ms, method{op: fld.Names[0].Name, service: svc})
					}
					ifaces[s.Name.Name] = ms
				}
			}
		}
	}

	// Pass 2: resource registrations, one per constructor function.
	var infos []*resourceInfo
	for name, f := range pkg.Files {
		var perr error
		for _, d := range f.Decls {
			fd, ok := d.(*ast.FuncDecl)
			if !ok {
				continue
			}
			ast.Inspect(fd, func(n ast.Node) bool {
				if perr != nil {
					return false
				}
				var iface, id string
				switch x := n.(type) {
				case *ast.CompositeLit:
					// &resource.Resource[XxxAPI]{ResourceTypeName: "..."}
					ix, ok := x.Type.(*ast.IndexExpr)
					if !ok {
						return true
					}
					sel, ok := ix.X.(*ast.SelectorExpr)
					if !ok || sel.Sel.Name != "Resource" {
						return true
					}
					iface = typeName(ix.Index)
					for _, e := range x.Elts {
						kv, ok := e.(*ast.KeyValueExpr)
						if ok && typeName(kv.Key) == "ResourceTypeName" {
							id = stringValue(kv.Value, consts)
						}
					}
				case *ast.CallExpr:
					// NewEC2AwsResource[XxxAPI]("...", ...)
					ix, ok := x.Fun.(*ast.IndexExpr)
					if !ok || typeName(ix.X) != "NewEC2AwsResource" || len(x.Args) == 0 {
						return true
					}
					iface = typeName(ix.Index)
					id = stringValue(x.Args[0], consts)
				default:
					return true
				}
				if id == "" {
					return true // the generic helper itself, not a registration
				}
				ms, ok := ifaces[iface]
				if !ok {
					perr = fmt.Errorf("%s: resource %q uses client type %q, which is not an interface declared in the package", filepath.Base(name), id, iface)
					return false
				}
				set := map[string]bool{}
				for _, m := range ms {
					acts, err := actionsFor(m)
					if err != nil {
						perr = fmt.Errorf("%s: %w", filepath.Base(name), err)
						return false
					}
					for _, a := range acts {
						set[a] = true
					}
				}
				infos = append(infos, &resourceInfo{
					ID: id, File: filepath.Base(name), Iface: iface, Actions: keys(set),
					DryRunCheck: setsPermissionVerifier(fd),
				})
				return true
			})
		}
		if perr != nil {
			return nil, perr
		}
	}
	sort.Slice(infos, func(i, j int) bool { return infos[i].ID < infos[j].ID })
	return infos, nil
}

// serviceOf resolves "*alias.SomethingInput" to the SDK service package name.
func serviceOf(t ast.Expr, imports map[string]string) string {
	if st, ok := t.(*ast.StarExpr); ok {
		t = st.X
	}
	sel, ok := t.(*ast.SelectorExpr)
	if !ok {
		return ""
	}
	return imports[typeName(sel.X)]
}

func actionsFor(m method) ([]string, error) {
	if acts, ok := opActions[m.service+"."+m.op]; ok {
		return acts, nil
	}
	prefix, ok := iamPrefix[m.service]
	if !ok {
		return nil, fmt.Errorf("unknown SDK service %q (operation %s); add it to iamPrefix", m.service, m.op)
	}
	return []string{prefix + ":" + m.op}, nil
}

func typeName(e ast.Expr) string {
	switch x := e.(type) {
	case *ast.Ident:
		return x.Name
	case *ast.StarExpr:
		return "*" + typeName(x.X)
	case *ast.SelectorExpr:
		return typeName(x.X) + "." + x.Sel.Name
	}
	return fmt.Sprintf("%T", e)
}

func stringValue(e ast.Expr, consts map[string]string) string {
	switch x := e.(type) {
	case *ast.BasicLit:
		if x.Kind == token.STRING {
			s, _ := strconv.Unquote(x.Value)
			return s
		}
	case *ast.Ident:
		return consts[x.Name]
	}
	return ""
}

// setsPermissionVerifier reports whether a constructor wires a
// PermissionVerifier, either as a struct field or by assignment.
func setsPermissionVerifier(fd *ast.FuncDecl) bool {
	const key = "PermissionVerifier"
	found := false
	ast.Inspect(fd, func(n ast.Node) bool {
		switch x := n.(type) {
		case *ast.KeyValueExpr:
			if typeName(x.Key) == key && !isNil(x.Value) {
				found = true
			}
		case *ast.AssignStmt:
			for i, l := range x.Lhs {
				if sel, ok := l.(*ast.SelectorExpr); ok && sel.Sel.Name == key && i < len(x.Rhs) && !isNil(x.Rhs[i]) {
					found = true
				}
			}
		}
		return !found
	})
	return found
}

func isNil(e ast.Expr) bool {
	id, ok := e.(*ast.Ident)
	return ok && id.Name == "nil"
}

// ---- output ----

type statement struct {
	Sid      string   `json:"Sid"`
	Effect   string   `json:"Effect"`
	Action   []string `json:"Action"`
	Resource string   `json:"Resource"`
}

type policy []statement

func (p policy) doc() map[string]any {
	stmts := make([]statement, 0, len(p))
	for _, s := range p {
		if len(s.Action) == 0 {
			continue
		}
		s.Effect, s.Resource = "Allow", "*"
		stmts = append(stmts, s)
	}
	return map[string]any{"Version": "2012-10-17", "Statement": stmts}
}

// size approximates how AWS counts policy characters (whitespace excluded);
// managed policies are capped at 6144.
func (p policy) size() int {
	b, _ := json.Marshal(p.doc())
	return len(b)
}

func writePolicy(path string, p policy, managed bool) error {
	var buf bytes.Buffer
	enc := json.NewEncoder(&buf)
	enc.SetIndent("", "  ")
	if err := enc.Encode(p.doc()); err != nil {
		return err
	}
	if managed && p.size() > 6144 {
		fmt.Fprintf(os.Stderr, "warning: %s is %d chars, above the 6144 managed-policy limit\n", path, p.size())
	}
	return os.WriteFile(path, buf.Bytes(), 0o644)
}

func writeTable(path string, infos []*resourceInfo, version string) error {
	group := map[string]string{}
	for _, svc := range catalog.Services() {
		for _, rt := range svc.ResourceTypes {
			group[rt.ID] = svc.ID
		}
	}
	var b strings.Builder
	fmt.Fprintf(&b, "<!-- Generated by `make iam-policy` from cloud-nuke %s. Do not edit. -->\n", version)
	b.WriteString("# IAM actions by resource type\n\n")
	b.WriteString("Derived from the SDK client interface each cloud-nuke resource declares. ")
	b.WriteString("Every run additionally needs `sts:GetCallerIdentity` and `ec2:DescribeRegions`. ")
	b.WriteString("\"Dry-run\" marks types whose scan issues a dry-run delete to test permissions: without the delete action they scan fine but show as not deletable.\n\n")
	b.WriteString("| Resource type | Service group | Dry-run | IAM actions |\n|---|---|---|---|\n")
	for _, r := range infos {
		dry := ""
		if r.DryRunCheck {
			dry = "yes"
		}
		fmt.Fprintf(&b, "| `%s` | %s | %s | %s |\n", r.ID, group[r.ID], dry, "`"+strings.Join(r.Actions, "` `")+"`")
	}
	return os.WriteFile(path, []byte(b.String()), 0o644)
}

func keys(m map[string]bool) []string {
	out := make([]string, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	sort.Strings(out)
	return out
}

func pascal(s string) string {
	var b strings.Builder
	for _, part := range strings.Split(s, "-") {
		if part != "" {
			b.WriteString(strings.ToUpper(part[:1]) + part[1:])
		}
	}
	return b.String()
}
