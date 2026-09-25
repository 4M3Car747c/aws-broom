import { useEffect } from "react";
import { Outlet, useNavigate } from "react-router";

import { Spinner } from "~/components/ui/spinner";
import { useSession } from "~/lib/session";
import { WizardProvider } from "~/lib/wizard";

export default function WizardLayout() {
  const { status } = useSession();
  const navigate = useNavigate();

  useEffect(() => {
    if (status === "anonymous") navigate("/connect", { replace: true });
  }, [status, navigate]);

  if (status !== "authed") {
    return (
      <div className="flex items-center justify-center py-24 text-muted-foreground">
        <Spinner />
      </div>
    );
  }
  return (
    <WizardProvider>
      <Outlet />
    </WizardProvider>
  );
}
