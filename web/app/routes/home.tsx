import { CheckIcon, CopyIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { cn } from "cn";

import { BrandMark } from "~/components/app-shell";
import { LAND_PATH, MARKERS, OPT_IN } from "~/lib/landing-map";
import { useSession } from "~/lib/session";
import { useIsDark } from "~/lib/use-dark";

import "./home.css";

export function meta() {
  return [{ title: "AWS Broom" }];
}

const REPO = "https://github.com/4M3Car747c/aws-broom";
const DOCKER = "docker run -d --name broom \\\n  -p 127.0.0.1:8080:8080 \\\n  -e SESSION_IDLE_TTL=30m \\\n  ghcr.io/4m3car747c/aws-broom:main";

const CHIPS: [string, string][] = [
  ["ec2", "EC2"], ["auto-scaling", "Auto Scaling"], ["ebs", "EBS"], ["vpc", "VPC"], ["elb", "ELB"], ["ecs", "ECS"], ["eks", "EKS"],
  ["lambda", "Lambda"], ["api-gateway", "API Gateway"], ["rds", "RDS"], ["dynamodb", "DynamoDB"], ["opensearch", "OpenSearch"], ["s3", "S3"],
  ["sqs", "SQS"], ["sns", "SNS"], ["kinesis", "Kinesis"], ["cloudwatch", "CloudWatch"], ["codebuild", "CodeBuild"], ["sagemaker", "SageMaker"],
  ["kms", "KMS"], ["secrets-manager", "Secrets Manager"], ["iam", "IAM"], ["cloudfront", "CloudFront"], ["route-53", "Route 53"],
];

type Member = { icon?: string; mono?: string; name: string; types: string[] };
type Group = { key: string; name?: string; label?: string; count: number; risk: "lo" | "md" | "hi"; on: boolean; members: Member[] };
const GROUPS: Group[] = [
  { key: "ec2", name: "EC2", count: 9, risk: "lo", on: true, members: [
    { icon: "ec2", name: "Amazon EC2", types: ["ec2", "ami", "eip", "ec2-keypairs"] },
    { icon: "auto-scaling", name: "EC2 Auto Scaling", types: ["asg", "launch-configuration", "launch-template"] },
    { icon: "ebs", name: "Amazon EBS", types: ["ebs", "ebs-snapshot"] },
  ] },
  { key: "vpc", name: "VPC", count: 8, risk: "md", on: true, members: [
    { icon: "vpc", name: "Amazon VPC", types: ["vpc", "ec2-subnet", "security-group", "network-acl", "nat-gateway", "internet-gateway"] },
    { icon: "elb", name: "Elastic Load Balancing", types: ["elb", "elbv2"] },
  ] },
  { key: "ct", label: "sv.ct", count: 4, risk: "lo", on: true, members: [
    { icon: "ecs", name: "Amazon ECS", types: ["ecs-cluster", "ecs-service"] },
    { icon: "eks", name: "Amazon EKS", types: ["eks-cluster"] },
    { icon: "app-runner", name: "App Runner", types: ["app-runner-service"] },
  ] },
  { key: "sl", label: "sv.sl", count: 4, risk: "lo", on: true, members: [
    { icon: "lambda", name: "AWS Lambda", types: ["lambda", "lambda-layer"] },
    { icon: "api-gateway", name: "API Gateway", types: ["api-gateway", "api-gateway-v2"] },
  ] },
  { key: "db", label: "sv.db", count: 5, risk: "md", on: true, members: [
    { icon: "rds", name: "Amazon RDS", types: ["rds-instance", "rds-cluster", "rds-snapshot", "rds-proxy"] },
    { icon: "dynamodb", name: "DynamoDB", types: ["dynamodb"] },
  ] },
  { key: "st", label: "sv.st", count: 4, risk: "md", on: true, members: [
    { icon: "s3", name: "Amazon S3", types: ["s3", "s3-access-point"] },
    { icon: "backup", name: "Backup", types: ["backup-plan", "backup-vault"] },
  ] },
  { key: "iam", name: "IAM", count: 4, risk: "hi", on: false, members: [
    { icon: "iam", name: "IAM", types: ["iam-user", "iam-role", "iam-policy", "iam-group"] },
  ] },
  { key: "sec", label: "sv.sec", count: 2, risk: "hi", on: false, members: [
    { icon: "kms", name: "AWS KMS", types: ["kms-customer-key"] },
    { icon: "secrets-manager", name: "Secrets Manager", types: ["secretsmanager"] },
  ] },
];

const REGION_ORDER = ["us-east-1", "us-west-2", "ca-central-1", "sa-east-1"];

function Check() {
  return (
    <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M2 6l3 3 5-6" />
    </svg>
  );
}
function Cb({ on }: { on: boolean }) {
  return <span className={cn("cb", on && "on")}>{on && <Check />}</span>;
}
function Icon({ d, strokeWidth = 2 }: { d: string; strokeWidth?: number }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
      {d.split("|").map((p) => (
        <path key={p} d={p} />
      ))}
    </svg>
  );
}
const LOCK = "M3 11h18v10H3z|M7 11V7a5 5 0 0 1 10 0v4";

function useRegionDemo(): string[] {
  const [sel, setSel] = useState<string[]>([]);
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setSel(REGION_ORDER);
      return;
    }
    let i = 0;
    let timer = 0;
    const step = () => {
      if (i <= REGION_ORDER.length) {
        setSel(REGION_ORDER.slice(0, i));
        i++;
        timer = window.setTimeout(step, i > REGION_ORDER.length ? 2600 : 1300);
      } else {
        i = 0;
        setSel([]);
        timer = window.setTimeout(step, 900);
      }
    };
    timer = window.setTimeout(step, 700);
    return () => window.clearTimeout(timer);
  }, []);
  return sel;
}

function RegionPane({ sel }: { sel: string[] }) {
  const { t } = useTranslation();
  return (
    <div className="pane">
      <div className="two mapwrap">
        <svg className="map" viewBox="150 75 250 345" aria-hidden="true">
          <g className="land">
            <path d={LAND_PATH} />
          </g>
          {MARKERS.map((m) => (
            <g key={m.r} className={cn("m", sel.includes(m.r) && "sel")}>
              <circle className="ring" cx={m.x} cy={m.y} r="8" />
              <circle className="core" cx={m.x} cy={m.y} r="3.2" />
              <text x={m.anchor === "start" ? m.x + 11 : m.x - 11} y={m.y + 4} textAnchor={m.anchor}>
                {m.r}
              </text>
            </g>
          ))}
          {OPT_IN.map((o) => (
            <circle key={`${o.x}-${o.y}`} className="m opt" cx={o.x} cy={o.y} r="2.6" />
          ))}
        </svg>
        <div className="side">
          <div className="side-h">{t("landing.rg.cur")}</div>
          <div className="kv"><span>{t("landing.rg.acc")}</span><b>123456789012</b></div>
          <div className="kv"><span>{t("landing.rg.n")}</span><b>{sel.length}</b></div>
          <div className="chips">
            {sel.map((r) => (
              <i key={r}>{r}</i>
            ))}
          </div>
          <div className="hint">{t("landing.rg.hint")}</div>
        </div>
      </div>
      <div className="legend">
        <span><i className="lg sel" />{t("landing.lg.sel")}</span>
        <span><i className="lg" />{t("landing.lg.on")}</span>
        <span><i className="lg opt" />{t("landing.lg.opt")}</span>
      </div>
    </div>
  );
}

function ServicesPane() {
  const { t } = useTranslation();
  const [open, setOpen] = useState<string | null>("ec2");
  const [on, setOn] = useState<Set<string>>(() => new Set(GROUPS.filter((g) => g.on).map((g) => g.key)));
  const toggle = (key: string) =>
    setOn((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  return (
    <div className="pane">
      <div className="svcs">
        {GROUPS.map((g) => {
          const isOn = on.has(g.key);
          return (
            <div key={g.key} className={cn("svc", open === g.key && "open", !isOn && "off")}>
              <button type="button" className="svc-h" aria-expanded={open === g.key} onClick={() => setOpen(open === g.key ? null : g.key)}>
                <span
                  role="checkbox"
                  aria-checked={isOn}
                  tabIndex={-1}
                  onClick={(e) => {
                    e.stopPropagation();
                    toggle(g.key);
                  }}
                >
                  <Cb on={isOn} />
                </span>
                <b>{g.name ?? t(`landing.${g.label}`)}</b>
                <span className="cnt">{t("landing.sv.types", { n: g.count })}</span>
                <span className="ics">
                  {g.members.map((m) =>
                    m.icon ? <img key={m.name} src={`/aws/${m.icon}.svg`} alt={m.name} title={m.name} width={22} height={22} /> : <span key={m.name} className="mg">{m.mono}</span>,
                  )}
                </span>
                <em className={g.risk}>{t(`landing.r.${g.risk}`)}</em>
                <svg className="chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 9l6 6 6-6" /></svg>
              </button>
              {open === g.key && (
                <div className="mems">
                  {g.members.map((m) => (
                    <div key={m.name} className="mem">
                      {m.icon ? <img src={`/aws/${m.icon}.svg`} alt="" width={20} height={20} /> : <span className="mg">{m.mono}</span>}
                      <span className="mn">{m.name}</span>
                      <span className="rt">
                        {m.types.map((ty) => (
                          <i key={ty}>{ty}</i>
                        ))}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
      <div className="pfoot">
        <span>{t("landing.sv.sum")}</span>
        <span className="btn-mini">{t("landing.sv.go")}</span>
      </div>
    </div>
  );
}

function ScanPane() {
  const { t } = useTranslation();
  const rows: [string, string, string][] = [
    ["ec2", "ap-east-1", "i-0f3a9c2e7b41d5a08"], ["ebs", "ap-east-1", "vol-0c2b1a3f4e5d66789"], ["rds-instance", "ap-east-1", "poc-postgres-1"],
    ["nat-gateway", "us-east-1", "nat-0c81d2f6a9e3b7c54"], ["security-group", "us-east-1", "sg-0a7e4d19c3b2f8e61"], ["lambda", "us-east-1", "poc-image-resize"],
    ["s3", "global", "poc-artifacts-7f3a1c"],
  ];
  const byRegion: [string, number][] = [["ap-east-1", 62], ["us-east-1", 58], ["eu-central-1", 41], ["ap-northeast-1", 19], ["global", 3]];
  return (
    <div className="pane">
      <div className="stats">
        <div><span>{t("landing.sc.prog")}</span><b>1456<small>/ 2223</small></b></div>
        <div><span>{t("landing.sc.found")}</span><b className="ok">183</b></div>
        <div><span>{t("landing.sc.nodel")}</span><b className="warn">1</b></div>
        <div><span>{t("landing.sc.err")}</span><b>0</b></div>
      </div>
      <div className="bar"><i style={{ width: "65%" }} /></div>
      <div className="two">
        <div className="tbl">
          <div className="th"><span>{t("landing.th.ty")}</span><span>{t("landing.th.reg")}</span><span>{t("landing.th.id")}</span><span /></div>
          {rows.map(([ty, rg, id]) => (
            <div key={id} className="tr"><span className="mono">{ty}</span><span className="mono dim">{rg}</span><span className="mono">{id}</span><i className="dot ok" /></div>
          ))}
        </div>
        <div className="side">
          <div className="side-h">{t("landing.sc.byreg")}</div>
          {byRegion.map(([r, n]) => (
            <div key={r} className="kv"><span>{r}</span><b>{n}</b></div>
          ))}
        </div>
      </div>
    </div>
  );
}

function ReviewPane() {
  const { t } = useTranslation();
  const row = (id: string, rg: string, ty: string, ok: boolean) => (
    <div key={id} className={cn("tr", !ok && "off")}>
      <Cb on={ok} /><span className="mono">{id}</span><span className="mono dim">{rg}</span><span className="mono dim">{ty}</span>
      <span className={cn("st", ok ? "ok" : "warn")}>{ok ? t("landing.rv.will") : t("landing.rv.prot")}</span>
    </div>
  );
  return (
    <div className="pane p4">
      <div className="stats">
        <div><span>{t("landing.rv.reg")}</span><b>4<small>+ global</small></b></div>
        <div><span>{t("landing.rv.svc")}</span><b>6</b></div>
        <div><span>{t("landing.rv.found")}</span><b>183</b></div>
        <div><span>{t("landing.rv.nodel")}</span><b className="warn">1</b></div>
      </div>
      <div className="tbl">
        <div className="th"><span /><span>{t("landing.th.id")}</span><span>{t("landing.th.reg")}</span><span>{t("landing.th.ty")}</span><span>{t("landing.th.st")}</span></div>
        <div className="tg"><Cb on /><b>EC2</b><span className="mono dim">3 / 4</span></div>
        {row("i-0f3a9c2e7b41d5a08", "ap-east-1", "ec2", true)}
        {row("i-0a1b2c3d4e5f60789", "ap-east-1", "ec2", false)}
        {row("vol-0c2b1a3f4e5d66789", "ap-east-1", "ebs", true)}
        {row("poc-keypair", "us-east-1", "ec2-keypairs", true)}
        <div className="tg"><Cb on /><b>VPC</b><span className="mono dim">2 / 2</span></div>
        {row("nat-0c81d2f6a9e3b7c54", "us-east-1", "nat-gateway", true)}
        {row("vpc-05b9e3a1f7c2d4e80", "us-east-1", "vpc", true)}
      </div>
      <div className="pfoot">
        <span><b>182</b> / 183 {t("landing.rv.sel")} · 1 {t("landing.rv.kept")}</span>
        <span className="btn-mini danger">{t("landing.rv.go")}</span>
      </div>
    </div>
  );
}

function CleanPane() {
  const { t } = useTranslation();
  const rows: [string, string, string, string, string][] = [
    ["poc-web-alb", "ap-east-1", "elbv2", "ok", t("landing.r.ok")],
    ["i-0f3a9c2e7b41d5a08", "ap-east-1", "ec2", "ok", t("landing.r.ok")],
    ["vpc-05b9e3a1f7c2d4e80", "us-east-1", "vpc", "warn", "DependencyViolation"],
    ["poc-postgres-1", "ap-east-1", "rds-instance", "bad", "InvalidParameterCombination"],
    ["poc-hook", "us-east-1", "lambda", "dim", t("landing.r.gone")],
    ["poc-artifacts-7f3a1c", "global", "s3", "run", t("landing.cl.wait")],
  ];
  const progress: [string, string, string][] = [["ap-east-1", "62/62", "100%"], ["us-east-1", "55/58", "95%"], ["eu-central-1", "41/41", "100%"], ["ap-northeast-1", "13/19", "68%"], ["global", "0/3", "0"]];
  return (
    <div className="pane p5">
      <div className="stats">
        <div><span>{t("landing.cl.done")}</span><b className="ok">171</b></div>
        <div><span>{t("landing.cl.retry")}</span><b className="warn">2</b></div>
        <div><span>{t("landing.cl.fail")}</span><b className="bad">1</b></div>
        <div><span>{t("landing.cl.left")}</span><b>8</b></div>
      </div>
      <div className="bar"><i className="red" style={{ width: "94%" }} /></div>
      <div className="two">
        <div className="tbl">
          <div className="th"><span>{t("landing.th.id")}</span><span>{t("landing.th.reg")}</span><span>{t("landing.th.ty")}</span><span>{t("landing.th.res")}</span></div>
          {rows.map(([id, rg, ty, st, label]) => (
            <div key={id} className="tr"><span className="mono">{id}</span><span className="mono dim">{rg}</span><span className="mono dim">{ty}</span><span className={cn("st", st)}>{label}</span></div>
          ))}
        </div>
        <div className="side">
          <div className="side-h">{t("landing.sc.byreg")}</div>
          {progress.map(([r, n, w]) => (
            <div key={r} className="pr"><span>{r}</span><b>{n}</b><i style={{ width: w }} /></div>
          ))}
        </div>
      </div>
    </div>
  );
}

function Tour() {
  const { t } = useTranslation();
  const [pane, setPane] = useState(1);
  const sel = useRegionDemo();
  const steps = [
    { n: 1, title: t("landing.st.1"), body: t("landing.tr.1"), k: `${sel.length} / 6` },
    { n: 2, title: t("landing.st.2"), body: t("landing.tr.2"), k: "6 / 8" },
    { n: 3, title: t("landing.st.3"), body: t("landing.tr.3"), k: "1456 / 2223" },
    { n: 4, title: t("landing.st.4"), body: t("landing.tr.4"), k: "182 / 183" },
    { n: 5, title: t("landing.st.5"), body: t("landing.tr.5"), k: "171 / 183", danger: true },
  ];
  const current = steps[pane - 1];
  return (
    <section className="container sec" id="tour">
      <div className="sec-head">
        <h2>{t("landing.tr.h")}</h2>
        <p>{t("landing.tr.p")}</p>
      </div>
      <div className="tour">
        <div className="tabs" role="tablist" aria-label={t("landing.aria.steps")}>
          {steps.map((s) => (
            <button key={s.n} type="button" className={cn("tab", s.danger && "danger")} role="tab" aria-selected={pane === s.n} tabIndex={pane === s.n ? 0 : -1} onClick={() => setPane(s.n)} onKeyDown={(e) => {
              const d = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
              if (!d) return;
              e.preventDefault();
              const n = ((pane - 1 + d + steps.length) % steps.length) + 1;
              setPane(n);
              (e.currentTarget.parentElement?.children[n - 1] as HTMLElement | undefined)?.focus();
            }}>
              <span className="n">{s.n}</span>
              <span><b>{s.title}</b><span>{s.body}</span></span>
            </button>
          ))}
        </div>
        <div className="screen">
          <div className="hd"><span className="t">{current.title}</span><span className="k">{current.k}</span></div>
          {pane === 1 && <RegionPane sel={sel} />}
          {pane === 2 && <ServicesPane />}
          {pane === 3 && <ScanPane />}
          {pane === 4 && <ReviewPane />}
          {pane === 5 && <CleanPane />}
        </div>
      </div>
    </section>
  );
}

/** Deterministic pseudo-random so server and client render the same tiles. */
function seeded(i: number): number {
  const x = Math.sin(i * 12.9898 + 78.233) * 43758.5453;
  return x - Math.floor(x);
}

function Mosaic() {
  const cells: React.ReactNode[] = [];
  for (let i = 0; i < 9 * 6; i++) {
    const r = seeded(i);
    if (r < 0.42) {
      cells.push(<span key={i} />);
      continue;
    }
    const style = { "--d": `${(-seeded(i + 100) * 12).toFixed(2)}s`, "--t": `${(7 + seeded(i + 200) * 8).toFixed(2)}s`, "--o": (0.35 + seeded(i + 300) * 0.55).toFixed(2) } as React.CSSProperties;
    cells.push(<i key={i} style={style} />);
  }
  return (
    <div className="mosaic" aria-hidden="true">
      {cells}
    </div>
  );
}

function CopyCode() {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const done = () => {
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  const copy = () => {
    const fallback = () => {
      const el = ref.current;
      if (el) {
        const r = document.createRange();
        r.selectNodeContents(el);
        const s = window.getSelection();
        s?.removeAllRanges();
        s?.addRange(r);
      }
      done();
    };
    if (navigator.clipboard?.writeText) navigator.clipboard.writeText(DOCKER).then(done, fallback);
    else fallback();
  };
  return (
    <div className="code" ref={ref}>
      <button type="button" onClick={copy} aria-label={copied ? t("landing.copied") : t("landing.copy")} title={copied ? t("landing.copied") : t("landing.copy")}>
        {copied ? <CheckIcon /> : <CopyIcon />}
      </button>
      <span className="c">{t("landing.code.c")}</span>
      {"\n"}
      {DOCKER}
    </div>
  );
}

export default function Home() {
  const { t, i18n } = useTranslation();
  const { status } = useSession();
  const dark = useIsDark();
  const connectTo = status === "authed" ? "/wizard" : "/connect";
  const shot = `/landing/review-${dark ? "dark" : "light"}-${i18n.language === "zh-CN" ? "zh" : "en"}.jpg`;

  return (
    <div className="lp">
      <section className="container hero">
        <h1>{t("landing.h1")}</h1>
        <p className="lead">{t("landing.lead")}</p>
        <div className="cta">
          <Link className="btn btn-primary btn-lg" to={connectTo}>
            {t("landing.connect")}
            <Icon d="M5 12h14|M13 6l6 6-6 6" />
          </Link>
          <a className="btn btn-outline btn-lg" href={REPO} target="_blank" rel="noreferrer">
            <svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 .5C5.7.5.5 5.7.5 12c0 5.1 3.3 9.4 7.9 10.9.6.1.8-.3.8-.6v-2c-3.2.7-3.9-1.4-3.9-1.4-.5-1.3-1.3-1.7-1.3-1.7-1-.7.1-.7.1-.7 1.2.1 1.8 1.2 1.8 1.2 1 1.8 2.7 1.3 3.4 1 .1-.8.4-1.3.7-1.6-2.6-.3-5.3-1.3-5.3-5.7 0-1.3.4-2.3 1.2-3.1-.1-.3-.5-1.5.1-3.1 0 0 1-.3 3.2 1.2a11 11 0 0 1 5.8 0c2.2-1.5 3.2-1.2 3.2-1.2.6 1.6.2 2.8.1 3.1.8.8 1.2 1.8 1.2 3.1 0 4.4-2.7 5.4-5.3 5.7.4.4.8 1.1.8 2.2v3.2c0 .3.2.7.8.6 4.6-1.5 7.9-5.8 7.9-10.9C23.5 5.7 18.3.5 12 .5z" /></svg>
            <span>{t("landing.src")}</span>
          </a>
        </div>
        <p className="fine">
          {t("landing.fine")} ·{" "}
          <a href={`${REPO}/blob/main/docs/iam-policy.md`} target="_blank" rel="noreferrer">
            {t("landing.fineLink")}
          </a>
        </p>

        <div className="shot" aria-label={t("landing.aria.preview")}>
          <div className="win">
            <div className="win-bar">
              <span className="lights" aria-hidden="true"><i /><i /><i /></span>
              <span className="url">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><rect x="4" y="11" width="16" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></svg>
                broom.example.com/wizard/review
              </span>
            </div>
            <img className="shotimg" src={shot} alt={t("landing.shotAlt")} width={1480} height={812} />
          </div>
        </div>
      </section>

      <section className="container services" aria-label={t("landing.aria.services")}>
        <div className="marquee">
          <div className="track">
            {[0, 1].map((dup) =>
              CHIPS.map(([slug, label]) => (
                <span key={`${dup}-${slug}`} className="chip" aria-hidden={dup === 1}>
                  <img src={`/aws/${slug}.svg`} alt="" width={28} height={28} />
                  {label}
                </span>
              )),
            )}
          </div>
        </div>
      </section>

      <section className="container sec" id="features">
        <div className="sec-head center">
          <h2>{t("landing.f.h")}</h2>
          <p>{t("landing.f.p")}</p>
        </div>
        <div className="cards">
          <div className="ccard">
            <div className="art">
              <div className="g"><div className="g-rows"><div><span className="cb on"><Check /></span><i /></div><div><span className="cb on"><Check /></span><i /></div><div className="off"><span className="cb" /><i /></div></div></div>
              <span className="val">40 / 41</span>
            </div>
            <div className="who"><span className="tile"><Icon d="M9 11l3 3L22 4|M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" /></span><div><b>{t("landing.c1.t")}</b><span>{t("landing.c1.s")}</span></div></div>
            <div className="metrics"><div><span>{t("landing.c1.a")}</span><b>40</b></div><i /><div><span>{t("landing.c1.b")}</span><b>1</b></div></div>
          </div>
          <div className="ccard">
            <div className="art">
              <div className="g">
                <svg className="ring" viewBox="0 0 100 100">
                  <circle className="tr" cx="50" cy="50" r="40" />
                  <circle className="pr" cx="50" cy="50" r="40" strokeDasharray="196.0 251.3" />
                  <g className="ic" transform="translate(38 38)"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="10" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg></g>
                </svg>
              </div>
              <span className="val">60 min</span>
            </div>
            <div className="who"><span className="tile"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="10" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg></span><div><b>{t("landing.c2.t")}</b><span>{t("landing.c2.s")}</span></div></div>
            <div className="metrics"><div><span>{t("landing.c2.a")}</span><b>60<small>min</small></b></div><i /><div><span>{t("landing.c2.b")}</span><b>12<small>h</small></b></div></div>
          </div>
          <div className="ccard">
            <div className="art">
              <div className="g">
                <svg className="venn" viewBox="0 0 200 120">
                  <circle cx="78" cy="56" r="42" /><circle cx="122" cy="56" r="42" />
                  <path className="x" d="M100 20.6a42 42 0 0 1 0 70.8 42 42 0 0 1 0-70.8z" />
                  <text x="46" y="112" textAnchor="middle">{t("landing.venn.rescan")}</text><text x="154" y="112" textAnchor="middle">{t("landing.venn.confirmed")}</text>
                </svg>
              </div>
              <span className="val">A ∩ B</span>
            </div>
            <div className="who"><span className="tile"><Icon d="M21 12a9 9 0 1 1-3-6.7|M21 3v6h-6" /></span><div><b>{t("landing.c3.t")}</b><span>{t("landing.c3.s")}</span></div></div>
            <div className="metrics"><div><span>{t("landing.c3.a")}</span><b>0<small>{t("landing.c3.aUnit")}</small></b></div><i /><div><span>{t("landing.c3.b")}</span><b><small>{t("landing.c3.bVal")}</small></b></div></div>
          </div>
          <div className="ccard">
            <div className="art">
              <div className="g"><div className="g-tg"><div>EC2<span className="sw on" /></div><div>IAM<em>{t("landing.high")}</em><span className="sw" /></div><div>KMS<em>{t("landing.high")}</em><span className="sw" /></div></div></div>
              <span className="val">{t("landing.c4.groups")}</span>
            </div>
            <div className="who"><span className="tile"><Icon d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /></span><div><b>{t("landing.c4.t")}</b><span>{t("landing.c4.s")}</span></div></div>
            <div className="metrics"><div><span>{t("landing.c4.a")}</span><b>3</b></div><i /><div><span>{t("landing.c4.b")}</span><b>{t("landing.c4.off")}</b></div></div>
          </div>
          <div className="ccard">
            <div className="art">
              <div className="g">
                <svg className="ring" viewBox="0 0 100 100">
                  <circle className="tr" cx="50" cy="50" r="40" />
                  <circle className="pr red" cx="50" cy="50" r="40" strokeDasharray="194.8 251.3" />
                  <text x="50" y="55" textAnchor="middle">31 / 40</text>
                </svg>
              </div>
              <span className="val">31 / 40</span>
            </div>
            <div className="who"><span className="tile"><Icon d="M22 12h-4l-3 9L9 3l-3 9H2" /></span><div><b>{t("landing.c5.t")}</b><span>{t("landing.c5.s")}</span></div></div>
            <div className="metrics"><div><span>{t("landing.c5.a")}</span><b>29</b></div><i /><div><span>{t("landing.c5.b")}</span><b>1</b></div></div>
          </div>
        </div>
      </section>

      <Tour />

      <section className="container sec" id="security">
        <div className="sec-head center">
          <h2>{t("landing.se.h")}</h2>
          <p>{t("landing.se.p")}</p>
        </div>
        <div className="cflow" aria-label={t("landing.aria.credFlow")}>
          <div className="cnode n1"><span className="ic"><Icon d="M2 4h20v16H2z|M2 9h20" /></span><b>{t("landing.cf.1")}</b><span>{t("landing.cf.1s")}</span></div>
          <div className="carrow a1"><small>{t("landing.cf.a1")}</small></div>
          <div className="cnode hot n2"><span className="ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="2" width="20" height="8" rx="2" /><rect x="2" y="14" width="20" height="8" rx="2" /><path d="M6 6h.01M6 18h.01" /></svg></span><b>{t("landing.cf.2")}</b><span>{t("landing.cf.2s")}</span></div>
          <div className="vline v1" />
          <div className="cnode sub s1"><b>{t("landing.cf.s1")}</b><span className="chips"><i>{t("landing.cf.s1a")}</i><i>{t("landing.cf.s1b")}</i><i>{t("landing.cf.s1c")}</i><i>{t("landing.cf.s1d")}</i></span></div>
          <div className="carrow a2"><small>{t("landing.cf.a2")}</small></div>
          <div className="cnode n3"><span className="ic"><Icon d="M4 17l6-5-6-5|M12 19h8" /></span><b>{t("landing.cf.3")}</b><span>{t("landing.cf.3s")}</span></div>
          <div className="vline v2" />
          <div className="cnode sub s2"><b>{t("landing.cf.s2")}</b><span className="chips"><i>{t("landing.cf.s2a")}</i><i>{t("landing.cf.s2b")}</i><i>{t("landing.cf.s2c")}</i></span></div>
          <div className="carrow a3"><small>{t("landing.cf.a3")}</small></div>
          <div className="cnode n4"><span className="ic"><Icon d="M17.5 19a4.5 4.5 0 0 0 0-9 6 6 0 0 0-11.5-1.5A5 5 0 0 0 6.5 19z" /></span><b>AWS</b><span>{t("landing.cf.4s")}</span></div>
        </div>
      </section>

      <section id="selfhost">
        <div className="cta-wrap">
          <Mosaic />
          <div className="band">
            <div>
              <h2>{t("landing.cta.h")}</h2>
              <p>{t("landing.cta.p")}</p>
              <div className="acts">
                <Link className="btn btn-lg btn-inv" to={connectTo}>{t("landing.cta.a")}</Link>
                <a className="btn btn-lg btn-ghost" href={`${REPO}/blob/main/docs/security.md`} target="_blank" rel="noreferrer">{t("landing.cta.b")}</a>
              </div>
            </div>
            <CopyCode />
          </div>

          <footer>
            <div className="foot">
              <div className="foot-in">
              <div className="cols">
                <div>
                  <h4>{t("landing.ft.h1")}</h4>
                  <ul>
                    <li><a href={REPO} target="_blank" rel="noreferrer">{t("landing.ft.src")}</a></li>
                    <li><a href={`${REPO}/releases`} target="_blank" rel="noreferrer">{t("landing.ft.releases")}</a></li>
                    <li><a href="https://github.com/gruntwork-io/cloud-nuke" target="_blank" rel="noreferrer">cloud-nuke</a></li>
                  </ul>
                </div>
                <div>
                  <h4>{t("landing.ft.h2")}</h4>
                  <ul>
                    <li><a href={`${REPO}/blob/main/docs/iam-policy.md`} target="_blank" rel="noreferrer">{t("landing.ft.iam")}</a></li>
                    <li><a href={`${REPO}/blob/main/docs/security.md`} target="_blank" rel="noreferrer">{t("landing.ft.sec")}</a></li>
                    <li><a href="#selfhost">{t("landing.ft.host")}</a></li>
                  </ul>
                </div>
              </div>
              <div className="rule" />
              <div className="bottom">
                <div>
                  <Link className="brand" to="/"><BrandMark inverse />AWS Broom</Link>
                  <p className="tagline">{t("landing.ft.p")}</p>
                </div>
                <div className="meta">
                  <div className="social">
                    <a href={REPO} target="_blank" rel="noreferrer" aria-label="GitHub" title="GitHub">
                      <svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 .5C5.7.5.5 5.7.5 12c0 5.1 3.3 9.4 7.9 10.9.6.1.8-.3.8-.6v-2c-3.2.7-3.9-1.4-3.9-1.4-.5-1.3-1.3-1.7-1.3-1.7-1-.7.1-.7.1-.7 1.2.1 1.8 1.2 1.8 1.2 1 1.8 2.7 1.3 3.4 1 .1-.8.4-1.3.7-1.6-2.6-.3-5.3-1.3-5.3-5.7 0-1.3.4-2.3 1.2-3.1-.1-.3-.5-1.5.1-3.1 0 0 1-.3 3.2 1.2a11 11 0 0 1 5.8 0c2.2-1.5 3.2-1.2 3.2-1.2.6 1.6.2 2.8.1 3.1.8.8 1.2 1.8 1.2 3.1 0 4.4-2.7 5.4-5.3 5.7.4.4.8 1.1.8 2.2v3.2c0 .3.2.7.8.6 4.6-1.5 7.9-5.8 7.9-10.9C23.5 5.7 18.3.5 12 .5z" /></svg>
                    </a>
                  </div>
                  <div className="legal">{t("landing.ft.legal")}</div>
                </div>
              </div>
              </div>
            </div>
          </footer>
        </div>
      </section>
    </div>
  );
}
