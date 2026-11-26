import { BrowserRouter, Route, Routes } from 'react-router';
import { Layout } from './components/Layout';
import { RequireAuth } from './components/RequireAuth';
import { AuthCallbackPage } from './pages/AuthCallbackPage';
import { CatalogItemsPage } from './pages/CatalogItemsPage';
import { ImportPage } from './pages/ImportPage';
import { ListPage } from './pages/ListPage';
import { ListPrintPage } from './pages/ListPrintPage';
import { ListsPage } from './pages/ListsPage';
import { LoginPage } from './pages/LoginPage';
import { PlanPage } from './pages/PlanPage';
import { PlanPrintPage } from './pages/PlanPrintPage';
import { ProfilePage } from './pages/ProfilePage';
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
            <Route path="/settings/items" element={<CatalogItemsPage />} />
            <Route path="/profile" element={<ProfilePage />} />
          </Route>
          {/* No app chrome: these pages are meant for the printer. */}
          <Route path="/plan/print" element={<PlanPrintPage />} />
          <Route path="/lists/:id/print" element={<ListPrintPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
