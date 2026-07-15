import { Navigate, Route, Routes } from "react-router-dom";

import { ActivityPage } from "../pages/ActivityPage";
import { OperationPage } from "../pages/OperationPage";
import { AppShell } from "./AppShell";

export function App() {
  return (
    <AppShell>
      <Routes>
        <Route path="/" element={<Navigate to="/swap" replace />} />
        <Route path="/swap" element={<OperationPage operation="swap" />} />
        <Route path="/deposit" element={<OperationPage operation="deposit" />} />
        <Route path="/withdraw" element={<OperationPage operation="withdraw" />} />
        <Route path="/activity" element={<ActivityPage />} />
        <Route path="*" element={<Navigate to="/swap" replace />} />
      </Routes>
    </AppShell>
  );
}
