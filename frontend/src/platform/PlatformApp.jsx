import { useState } from "react";
import { BrowserRouter, Routes, Route, NavLink } from "react-router-dom";
import { LayoutDashboard, Building2, UserRound, Server, MapPin, AlertTriangle, BarChart3, ScrollText, Network, LogOut, Settings } from "lucide-react";
import { logout } from "../services/api";
import { disconnectSocket } from "../services/socket";
import MyProfileModal from "../components/MyProfile";
import CommandCenter from "./CommandCenter";
import RealmsPage from "./RealmsPage";
import RealmDetailPage from "./RealmDetailPage";
import PlatformTechnicians from "./PlatformTechnicians";
import PlatformDevices from "./PlatformDevices";
import PlatformSites from "./PlatformSites";
import PlatformIncidents from "./PlatformIncidents";
import PlatformAnalytics from "./PlatformAnalytics";
import PlatformAudit from "./PlatformAudit";

const NAV = [
  ["/platform", "Command Center", LayoutDashboard, true],
  ["/platform/realms", "Realms", Building2],
  ["/platform/technicians", "Technicians", UserRound],
  ["/platform/devices", "Devices", Server],
  ["/platform/sites", "Sites", MapPin],
  ["/platform/incidents", "Incidents", AlertTriangle],
  ["/platform/analytics", "Analytics", BarChart3],
  ["/platform/audit", "Audit Log", ScrollText]
];

function Shell({ user, onLoggedOut, onUserUpdated, children }) {
  const [profileOpen, setProfileOpen] = useState(false);
  async function doLogout() {
    try { await logout(); } finally { disconnectSocket(); onLoggedOut(); }
  }
  return <div className="min-h-screen bg-[#050810] text-slate-200">
    <aside className="fixed inset-y-0 left-0 z-40 w-64 border-r border-slate-800/80 bg-[#080d16]/95 backdrop-blur-xl">
      <div className="flex h-16 items-center gap-3 border-b border-slate-800/80 px-5">
        <div className="rounded-xl bg-purple-600 p-2"><Network size={19} /></div>
        <div><p className="font-bold text-white">NetEscalate</p><p className="text-[9px] uppercase tracking-[.22em] text-slate-600">Platform</p></div>
      </div>
      <div className="p-3">
        <p className="px-3 py-3 text-[10px] font-semibold uppercase tracking-[.2em] text-slate-600">Platform administration</p>
        {NAV.map(([to, label, Icon, end]) => <NavLink key={to} to={to} end={end} className={({ isActive }) => `mb-1 flex w-full items-center gap-3 rounded-xl px-3 py-3 text-sm ${isActive ? "bg-purple-500/10 text-purple-400 ring-1 ring-purple-500/20" : "text-slate-500 hover:bg-slate-800/50 hover:text-slate-200"}`}>
          <Icon size={17} /><span>{label}</span>
        </NavLink>)}
      </div>
      <div className="absolute bottom-0 left-0 right-0 border-t border-slate-800/80 p-4">
        <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-3">
          <p className="truncate text-xs font-semibold text-white">{user.name}</p>
          <p className="truncate text-[10px] text-slate-600">{user.platformRole?.replaceAll("_", " ")}</p>
          <div className="mt-2 flex gap-1.5">
            <button onClick={() => setProfileOpen(true)} className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-slate-700 px-2 py-1.5 text-[11px] text-slate-400 hover:bg-slate-800 hover:text-white"><Settings size={12} />Profile</button>
            <button onClick={doLogout} className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-slate-700 px-2 py-1.5 text-[11px] text-slate-400 hover:bg-slate-800 hover:text-white"><LogOut size={12} />Sign out</button>
          </div>
        </div>
      </div>
    </aside>
    <div className="pl-64"><main className="mx-auto max-w-[1700px] p-6">{children}</main></div>
    {profileOpen && <MyProfileModal user={user} onClose={() => setProfileOpen(false)} onUpdated={u => onUserUpdated({ ...user, ...u })} />}
  </div>;
}

export default function PlatformApp({ user, onLoggedOut, onUserUpdated }) {
  return <BrowserRouter>
    <Shell user={user} onLoggedOut={onLoggedOut} onUserUpdated={onUserUpdated}>
      <Routes>
        <Route path="/platform" element={<CommandCenter />} />
        <Route path="/platform/realms" element={<RealmsPage />} />
        <Route path="/platform/realms/:realmId" element={<RealmDetailPage />} />
        <Route path="/platform/technicians" element={<PlatformTechnicians />} />
        <Route path="/platform/devices" element={<PlatformDevices />} />
        <Route path="/platform/sites" element={<PlatformSites />} />
        <Route path="/platform/incidents" element={<PlatformIncidents />} />
        <Route path="/platform/analytics" element={<PlatformAnalytics />} />
        <Route path="/platform/audit" element={<PlatformAudit />} />
        <Route path="*" element={<CommandCenter />} />
      </Routes>
    </Shell>
  </BrowserRouter>;
}
