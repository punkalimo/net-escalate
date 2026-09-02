import { useState } from "react";
import { BrowserRouter, Routes, Route, NavLink, useLocation } from "react-router-dom";
import { LayoutDashboard, Building2, UserRound, Server, MapPin, AlertTriangle, BarChart3, ScrollText, Menu, Network, LogOut, Settings } from "lucide-react";
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
import AgentActivityPanel from "../components/AgentActivityPanel";

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
  const [mobile, setMobile] = useState(false);
  const location = useLocation();
  const currentLabel = NAV.find(([to, , , end]) => end ? to === location.pathname : location.pathname.startsWith(to))?.[1] || "Platform";
  async function doLogout() {
    try { await logout(); } finally { disconnectSocket(); onLoggedOut(); }
  }
  return <div className="min-h-screen bg-[#050810] text-slate-200">
    <aside className={`fixed inset-y-0 left-0 z-40 flex w-64 flex-col border-r border-slate-800/80 bg-[#080d16]/95 backdrop-blur-xl transition-transform lg:translate-x-0 ${mobile ? "translate-x-0" : "-translate-x-full"}`}>
      <div className="flex h-16 shrink-0 items-center gap-3 border-b border-slate-800/80 px-5">
        <div className="rounded-xl bg-purple-600 p-2"><Network size={19} /></div>
        <div><p className="font-bold text-white">NetEscalate</p><p className="text-[9px] uppercase tracking-[.22em] text-slate-600">Platform</p></div>
      </div>
      <div className="flex-1 overflow-y-auto p-3">
        <p className="px-3 py-3 text-[10px] font-semibold uppercase tracking-[.2em] text-slate-600">Platform administration</p>
        {NAV.map(([to, label, Icon, end]) => <NavLink key={to} to={to} end={end} onClick={() => setMobile(false)} className={({ isActive }) => `mb-1 flex w-full items-center gap-3 rounded-xl px-3 py-3 text-sm ${isActive ? "bg-purple-500/10 text-purple-400 ring-1 ring-purple-500/20" : "text-slate-500 hover:bg-slate-800/50 hover:text-slate-200"}`}>
          <Icon size={17} /><span>{label}</span>
        </NavLink>)}
      </div>
      <div className="shrink-0 border-t border-slate-800/80 p-4">
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
    {mobile && <button className="fixed inset-0 z-30 bg-black/60 lg:hidden" onClick={() => setMobile(false)} />}
    <div className="lg:pl-64">
      <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-slate-800/80 bg-[#050810]/85 px-4 backdrop-blur-xl lg:hidden">
        <button onClick={() => setMobile(true)} className="rounded-lg p-2 text-slate-500"><Menu size={20} /></button>
        <p className="text-sm font-semibold text-white">{currentLabel}</p>
      </header>
      <main className="mx-auto max-w-[1700px] p-4 sm:p-6">{children}</main>
    </div>
    {profileOpen && <MyProfileModal user={user} onClose={() => setProfileOpen(false)} onUpdated={u => onUserUpdated({ ...user, ...u })} />}
    <AgentActivityPanel />
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
