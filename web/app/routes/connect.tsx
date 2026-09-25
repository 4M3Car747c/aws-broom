import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate } from "react-router";

import { Button } from "~/components/ui/button";
import { Checkbox } from "~/components/ui/checkbox";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { Textarea } from "~/components/ui/textarea";
import { toast } from "~/components/ui/toast";
import { ApiError } from "~/lib/api";
import { useSession } from "~/lib/session";
import { i18n } from "~/lib/i18n";

export function meta() {
  return [{ title: `${i18n.t("connect.title")} · AWS Broom` }];
}

export default function Connect() {
  const { t } = useTranslation();
  const { status, info, login, logout } = useSession();
  const navigate = useNavigate();
  const [ak, setAk] = useState("");
  const [sk, setSk] = useState("");
  const [token, setToken] = useState("");
  const [ack, setAck] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!ak.trim() || !sk.trim()) {
      setError(t("home.form.errors.required"));
      return;
    }
    if (!ack) {
      setError(t("home.form.errors.ack"));
      return;
    }
    setBusy(true);
    try {
      await login({ accessKeyId: ak.trim(), secretAccessKey: sk.trim(), sessionToken: token.trim() || undefined });
      setAk("");
      setSk("");
      setToken("");
      navigate("/wizard/regions");
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : t("common.unknownError");
      setError(msg);
      toast.add({ title: t("common.unknownError"), description: msg, type: "error" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-[440px] pt-6 md:pt-12">
      <div className="rounded-xl border border-border bg-card p-5 shadow-lg">
        {status === "authed" && info ? (
          <div className="grid gap-4">
            <div>
              <div className="text-xs text-muted-foreground">{t("home.form.signedInAs")}</div>
              <div className="mt-1 font-mono text-lg">{info.accountId}</div>
              {info.principal && <div className="font-mono text-sm">{info.principal}</div>}
              <div className="truncate font-mono text-xs text-muted-foreground" title={info.arn}>
                {info.arn}
              </div>
              <div className="mt-2 text-xs text-muted-foreground">{info.isTemporary ? t("app.temporary") : t("app.longLived")}</div>
            </div>
            <Button size="lg" className="justify-center" render={<Link to="/wizard/regions" />}>
              {t("home.form.continueAs", { account: info.accountId })}
            </Button>
            <Button variant="outline" onClick={() => void logout()}>
              {t("home.form.useAnother")}
            </Button>
          </div>
        ) : (
          <form onSubmit={submit} className="grid gap-4" autoComplete="off">
            <div>
              <h1 className="text-[15px] font-semibold">{t("home.form.title")}</h1>
              <p className="mt-1 text-sm text-muted-foreground">{t("home.form.desc")}</p>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="ak">{t("home.form.accessKey")}</Label>
              <Input id="ak" className="font-mono" value={ak} onChange={(e) => setAk(e.target.value)} spellCheck={false} placeholder="ASIA…" />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="sk">{t("home.form.secretKey")}</Label>
              <Input id="sk" type="password" autoComplete="new-password" className="font-mono" value={sk} onChange={(e) => setSk(e.target.value)} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="st">
                {t("home.form.sessionToken")} <span className="font-normal text-muted-foreground">{t("home.form.optional")}</span>
              </Label>
              <Textarea id="st" autoComplete="off" className="min-h-20 font-mono text-xs" value={token} onChange={(e) => setToken(e.target.value)} spellCheck={false} />
            </div>
            <div className="flex items-start gap-2.5 text-sm">
              <Checkbox id="ack" className="mt-0.5" checked={ack} onCheckedChange={(v) => setAck(Boolean(v))} />
              <Label htmlFor="ack" className="cursor-pointer font-normal leading-snug">
                {t("home.form.ack")}
              </Label>
            </div>
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
            <Button type="submit" size="lg" className="justify-center" disabled={busy}>
              {busy ? t("home.form.submitting") : t("home.form.submit")}
            </Button>
            <div className="border-t border-border pt-4 text-xs text-muted-foreground">
              <p>{t("home.form.cliHint")}</p>
              <pre className="mt-2 overflow-x-auto rounded-lg bg-code px-3.5 py-3 font-mono text-xs text-code-foreground/80">
                <b className="font-medium text-code-foreground">aws</b> sts get-session-token --duration-seconds 3600
              </pre>
              <a
                className="mt-2 inline-block text-foreground underline decoration-border underline-offset-4 hover:decoration-foreground"
                href="https://github.com/4M3Car747c/aws-broom/blob/main/docs/iam-policy.md"
                target="_blank"
                rel="noreferrer"
              >
                {t("home.form.policyLink")}
              </a>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
