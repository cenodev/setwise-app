import { Navigate } from "react-router-dom";

import { resolveLegacyRoute, type SetTab } from "./routes";

export function LegacyRedirect({ tab }: { tab: SetTab }) {
  const target = resolveLegacyRoute(tab);
  return <Navigate to={target.path} replace />;
}
