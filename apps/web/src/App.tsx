import { BrowserRouter, Route, Routes } from 'react-router';
import { Layout } from './components/Layout';
import { RequireAuth } from './components/RequireAuth';
import { AuthCallbackPage } from './pages/AuthCallbackPage';
import { ImportPage } from './pages/ImportPage';
import { ListPage } from './pages/ListPage';
import { ListsPage } from './pages/ListsPage';
import { LoginPage } from './pages/LoginPage';
import { PlanPage } from './pages/PlanPage';
import { PlanPrintPage } from './pages/PlanPrintPage';
import { SettingsPage } from './pages/SettingsPage';
import { StoresPage } from './pages/StoresPage';

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/auth/callback" element={<AuthCallbackPage />} />
        <Route element={<RequireAuth />}>
          <Route element={<Layout />}>
            <Route index element={<ListsPage />} />
            <Route path="/lists/:id" element={<ListPage />} />
            <Route path="/plan" element={<PlanPage />} />
            <Route path="/stores" element={<StoresPage />} />
            <Route path="/import" element={<ImportPage />} />
            <Route path="/settings" element={<SettingsPage />} />
          </Route>
          {/* No app chrome: this page is meant for the printer. */}
          <Route path="/plan/print" element={<PlanPrintPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
