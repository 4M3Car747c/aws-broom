import { useTranslation } from "react-i18next";
import { Link } from "react-router";

import { Button } from "~/components/ui/button";

export function meta() {
  return [{ title: "404 · AWS Broom" }];
}

export default function NotFound() {
  const { t } = useTranslation();
  return (
    <main className="mx-auto max-w-3xl p-6 pt-16">
      <h1 className="text-2xl font-semibold">{t("error.notFoundTitle")}</h1>
      <p className="mt-2 text-muted-foreground">{t("error.notFoundBody")}</p>
      <Button className="mt-6" render={<Link to="/" />}>
        {t("error.home")}
      </Button>
    </main>
  );
}
