import { useEffect } from "react";
import { useNavigate } from "react-router";

export default function WizardIndex() {
  const navigate = useNavigate();
  useEffect(() => {
    navigate("/wizard/regions", { replace: true });
  }, [navigate]);
  return null;
}
