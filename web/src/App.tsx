import { useEffect } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { useAuth } from "./stores/auth.js";
import Login from "./pages/auth/Login.js";
import Register from "./pages/auth/Register.js";
import DevicesPage from "./pages/dashboard/Devices.js";
import GroupsPage from "./pages/dashboard/Groups.js";
import AlertsPage from "./pages/dashboard/Alerts.js";
import UsersPage from "./pages/dashboard/Users.js";
import DeviceDetail from "./pages/device/DeviceDetail.js";
import TerminalPage from "./pages/device/Terminal.js";
import DesktopPage from "./pages/device/Desktop.js";
import FilesPage from "./pages/device/Files.js";
import RecordingsPage from "./pages/device/Recordings.js";
import QuickSupportPage from "./pages/public/QuickSupport.js";
import ShareLinkPage from "./pages/public/ShareLink.js";
import LegalPage from "./pages/public/Legal.js";

function Layout({ children }: { children: React.ReactNode }) {
  const user = useAuth((s) => s.user);
  const logout = useAuth((s) => s.logout);
  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b border-slate-800 bg-slate-900/50">
        <div className="max-w-6xl mx-auto px-6 py-3 flex items-center justify-between">
          <a href="/devices" className="font-bold text-lg">
            Vyom<span className="text-brand-400">Desk</span>
          </a>
          <div className="flex items-center gap-4 text-sm text-slate-300">
            <a href="/devices" className="hover:text-white">Devices</a>
            <a href="/groups" className="hover:text-white">Groups</a>
            <a href="/alerts" className="hover:text-white">Alerts</a>
            <a href="/users" className="hover:text-white">Users</a>
            <span className="text-slate-500">{user?.email}</span>
            <button onClick={logout} className="bg-slate-800 hover:bg-slate-700 rounded-lg px-3 py-1.5">
              Sign out
            </button>
          </div>
        </div>
      </header>
      <main className="flex-1">{children}</main>
    </div>
  );
}

function RequireAuth({ children }: { children: React.ReactNode }) {
  const token = useAuth((s) => s.token);
  if (!token) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

export default function App() {
  const init = useAuth((s) => s.init);
  const loading = useAuth((s) => s.loading);

  useEffect(() => {
    init();
  }, [init]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center text-slate-400">
        Loading VyomDesk...
      </div>
    );
  }

  return (
    <Routes>
      {/* Public quick-support join (GetScreen-style, no login) */}
      <Route path="/join" element={<QuickSupportPage />} />
      <Route
        path="/join/session"
        element={<DesktopPage />}
      />
      {/* Public guest share link (MeshCentral-style, no login) */}
      <Route path="/share/:slug" element={<ShareLinkPage />} />
      <Route path="/share/session" element={<DesktopPage />} />
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />
      <Route path="/legal" element={<LegalPage />} />
      <Route
        path="/devices"
        element={
          <RequireAuth>
            <Layout>
              <DevicesPage />
            </Layout>
          </RequireAuth>
        }
      />
      <Route
        path="/alerts"
        element={
          <RequireAuth>
            <Layout>
              <AlertsPage />
            </Layout>
          </RequireAuth>
        }
      />
      <Route
        path="/groups"
        element={
          <RequireAuth>
            <Layout>
              <GroupsPage />
            </Layout>
          </RequireAuth>
        }
      />
      <Route
        path="/users"
        element={
          <RequireAuth>
            <Layout>
              <UsersPage />
            </Layout>
          </RequireAuth>
        }
      />
      <Route
        path="/devices/:id"
        element={
          <RequireAuth>
            <Layout>
              <DeviceDetail />
            </Layout>
          </RequireAuth>
        }
      />
      <Route
        path="/devices/:id/terminal"
        element={
          <RequireAuth>
            <Layout>
              <TerminalPage />
            </Layout>
          </RequireAuth>
        }
      />
      <Route
        path="/devices/:id/desktop"
        element={
          <RequireAuth>
            <Layout>
              <DesktopPage />
            </Layout>
          </RequireAuth>
        }
      />
      <Route
        path="/devices/:id/files"
        element={
          <RequireAuth>
            <Layout>
              <FilesPage />
            </Layout>
          </RequireAuth>
        }
      />
      <Route
        path="/devices/:id/recordings"
        element={
          <RequireAuth>
            <Layout>
              <RecordingsPage />
            </Layout>
          </RequireAuth>
        }
      />
      <Route
        path="/recordings"
        element={
          <RequireAuth>
            <Layout>
              <RecordingsPage />
            </Layout>
          </RequireAuth>
        }
      />
      <Route path="*" element={<Navigate to="/devices" replace />} />
    </Routes>
  );
}