import { useEffect, useState } from "react";
import { AlertTriangle, BrainCircuit, LayoutDashboard, LogOut, MapPin, MessageSquare, Network, RefreshCw, Server, Settings, Signal, Sparkles, UserRound } from "lucide-react";
import NocDashboard from "./NocDashboard";
import TopologyView from "./components/TopologyView";
import TopologyErrorBoundary from "./components/TopologyErrorBoundary";
import RootCauseCenter from "./components/RootCauseCenter";
import Phase4CommandCenter from "./components/Phase4CommandCenter";
import Login from "./components/Login";
import EnterRealmBanner from "./components/EnterRealmBanner";
import MyProfileModal from "./components/MyProfile";
import AgentActivityPanel from "./components/AgentActivityPanel";
import PlatformApp from "./platform/PlatformApp";
import { getMe, logout } from "./services/api";
import { disconnectSocket } from "./services/socket";
import { initWebMCP, teardownWebMCP } from "./webmcp/index.js";

const NAV_ITEMS = [
  ["overview", "Operations", LayoutDashboard],
  ["incidents", "Incidents", AlertTriangle],
  ["interfaces", "Interface Health", Signal],
  ["devices", "Devices", Server],
  ["sites", "Sites", MapPin],
  ["technicians", "Escalation Team", UserRound],
  ["chat", "Team Chat", MessageSquare],
  ["rca", "RCA", BrainCircuit],
  ["phase4", "Phase 4 Operations", Sparkles],
  ["topology", "Topology", Network],
];

function clickExisting(label) {
  const button = Array.from(document.querySelectorAll("aside button"))
    .find(candidate => candidate.textContent?.trim().startsWith(label));
  button?.click();
}

function openDestination(id) {
  if (["overview", "incidents", "interfaces", "devices", "sites", "technicians", "chat"].includes(id)) {
    clickExisting(NAV_ITEMS.find(([key]) => key === id)?.[1]);
    return;
  }
  if (id === "rca") document.querySelector('button[title="Open Root Cause Analysis"]')?.click();
  if (id === "phase4") document.querySelector('button[aria-label="Phase 4 Command Center"]')?.click();
  if (id === "topology") document.querySelector('button.fixed.bottom-6.right-6')?.click();
}

function IncidentSearchPolish() {
  return <style>{`
    /* Full-width command workspace */
    main.mx-auto.max-w-[1700px] { max-width: none !important; width: 100% !important; }

    /* Operations / NOC command center */
    main > div.space-y-6:first-child { width: 100%; max-width: none; }
    main > div.space-y-6:first-child > div:first-child {
      min-height: 180px;
      display: flex;
      flex-direction: column;
      justify-content: center;
      padding: 32px clamp(24px, 4vw, 52px) !important;
      border-radius: 18px !important;
      background:
        radial-gradient(circle at 82% 20%, rgb(37 99 235 / .16), transparent 30%),
        linear-gradient(115deg, rgb(15 23 42 / .95), rgb(2 6 23 / .94)) !important;
      box-shadow: inset 0 1px 0 rgb(255 255 255 / .025), 0 22px 65px rgb(0 0 0 / .18);
    }
    main > div.space-y-6:first-child > div:first-child h1 { font-size: clamp(24px, 3vw, 36px) !important; letter-spacing: -.025em; }
    main > div.space-y-6:first-child > div:first-child p { max-width: 720px; font-size: 13px; }

    /* KPI strip */
    main > div.space-y-6:first-child > div:nth-child(2) {
      grid-template-columns: repeat(4, minmax(0, 1fr)) !important;
    }
    main > div.space-y-6:first-child > div:nth-child(2) > div {
      min-height: 126px;
      border-radius: 14px !important;
      background: rgb(8 13 22 / .84) !important;
      box-shadow: inset 0 1px 0 rgb(255 255 255 / .02);
    }

    /* Main command panels */
    main > div.space-y-6:first-child > div:nth-child(3) {
      grid-template-columns: minmax(0, 1.65fr) minmax(320px, .85fr) !important;
      align-items: stretch;
    }
    main > div.space-y-6:first-child > div:nth-child(3) > section {
      min-height: 430px;
      border-radius: 16px !important;
      background: rgb(8 13 22 / .82) !important;
      box-shadow: 0 18px 50px rgb(0 0 0 / .12);
    }
    main > div.space-y-6:first-child > div:nth-child(3) > section:first-child > div:first-child {
      padding: 18px 20px !important;
      background: linear-gradient(180deg, rgb(15 23 42 / .5), transparent);
    }
    main > div.space-y-6:first-child > div:nth-child(3) > section:first-child button {
      transition: background .16s ease;
    }
    main > div.space-y-6:first-child > div:nth-child(3) > section:first-child button:hover {
      background: rgb(30 41 59 / .38);
    }

    /* Fleet panel becomes a visual operations status board */
    main > div.space-y-6:first-child > div:nth-child(3) > section:last-child {
      position: relative;
      overflow: hidden;
    }
    main > div.space-y-6:first-child > div:nth-child(3) > section:last-child::after {
      content: "LIVE";
      position: absolute;
      right: 18px;
      top: 18px;
      border: 1px solid rgb(16 185 129 / .18);
      background: rgb(16 185 129 / .06);
      color: rgb(52 211 153 / .7);
      border-radius: 999px;
      padding: 4px 8px;
      font-size: 8px;
      font-weight: 800;
      letter-spacing: .16em;
    }

    @media (max-width: 1100px) {
      main > div.space-y-6:first-child > div:nth-child(2) { grid-template-columns: repeat(2, minmax(0, 1fr)) !important; }
      main > div.space-y-6:first-child > div:nth-child(3) { grid-template-columns: 1fr !important; }
    }
    @media (max-width: 640px) {
      main > div.space-y-6:first-child > div:first-child { min-height: 150px; padding: 24px !important; }
      main > div.space-y-6:first-child > div:nth-child(2) { grid-template-columns: 1fr !important; }
    }

  `}</style>;
}

function NavigationBridge() {
  const [active, setActive] = useState("overview");
  const [incidentCount, setIncidentCount] = useState(0);

  useEffect(() => {
    const sync = () => {
      const buttons = Array.from(document.querySelectorAll("aside button"));
      const incident = buttons.find(button => button.textContent?.trim().startsWith("Incidents"));
      const count = incident?.querySelector("span:last-child")?.textContent?.trim();
      const nextCount = count && /^\d+$/.test(count) ? Number(count) : 0;
      setIncidentCount(current => current === nextCount ? current : nextCount);
    };
    sync();
    const interval = window.setInterval(sync, 1000);
    return () => window.clearInterval(interval);
  }, []);

  const navigate = id => {
    setActive(id);
    openDestination(id);
  };

  return <>
    <IncidentSearchPolish />
    <nav aria-label="Primary navigation" className="fixed left-0 top-16 z-[45] hidden h-[calc(100vh-16rem)] w-64 overflow-y-auto border-r border-slate-800/80 bg-[#080d16] px-3 py-3 shadow-xl shadow-black/20 lg:block">
      <p className="px-3 py-3 text-[10px] font-semibold uppercase tracking-[.2em] text-slate-600">Navigation</p>
      {NAV_ITEMS.map(([id, label, Icon]) => <button key={id} type="button" onClick={() => navigate(id)} className={`group relative mb-1 flex min-h-11 w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/60 focus-visible:ring-offset-1 focus-visible:ring-offset-[#080d16] ${active === id ? "bg-blue-500/10 text-blue-400" : "text-slate-500 hover:bg-slate-800/50 hover:text-slate-200"}`}>
        {active === id && <span aria-hidden="true" className="absolute left-0 top-2 bottom-2 w-0.5 rounded-full bg-blue-500 shadow-[0_0_10px_rgba(59,130,246,.55)]" />}
        <Icon size={17} strokeWidth={1.9} />
        <span>{label}</span>
        {id === "incidents" && incidentCount > 0 && <span className="ml-auto rounded-full bg-red-500/15 px-2 py-0.5 text-[10px] font-bold text-red-400">{incidentCount}</span>}
      </button>)}
    </nav>

    <nav aria-label="Mobile primary navigation" className="fixed bottom-0 left-0 right-0 z-[55] flex gap-1 overflow-x-auto border-t border-slate-800/80 bg-[#080d16]/98 p-2 shadow-2xl backdrop-blur-xl lg:hidden">
      {NAV_ITEMS.map(([id, label, Icon]) => <button key={id} type="button" onClick={() => navigate(id)} className={`flex shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-[11px] font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/60 ${active === id ? "bg-blue-500/10 text-blue-400" : "text-slate-500"}`}>
        <Icon size={15} />
        <span>{label}</span>
        {id === "incidents" && incidentCount > 0 && <span className="rounded-full bg-red-500/15 px-1.5 py-0.5 text-[9px] text-red-400">{incidentCount}</span>}
      </button>)}
    </nav>
  </>;
}

function UserBadge({ user, onLoggedOut, onUserUpdated }) {
  const [busy, setBusy] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  async function doLogout() {
    setBusy(true);
    try { await logout(); } finally { disconnectSocket(); onLoggedOut(); }
  }
  return <>
    <div className="fixed right-2 top-2 z-[80] flex max-w-[calc(100vw-4.5rem)] items-center gap-1.5 rounded-full border border-slate-800 bg-[#080d16]/95 py-1.5 pl-2.5 pr-1.5 text-xs text-slate-300 shadow-xl backdrop-blur-xl sm:right-3 sm:top-3 sm:max-w-none sm:gap-2 sm:pl-3">
      <UserRound size={13} className="hidden text-slate-500 sm:block" />
      <span className="max-w-[6rem] truncate font-medium sm:max-w-none">{user.name}</span>
      <span className="hidden text-slate-600 sm:inline">·</span>
      <span className="hidden text-slate-500 sm:inline">{user.realmName || user.role}</span>
      <button onClick={() => setProfileOpen(true)} title="My profile" className="ml-1 flex items-center gap-1 rounded-full border border-slate-700 px-2 py-1 text-[11px] text-slate-400 hover:bg-slate-800 hover:text-white"><Settings size={12} /></button>
      <button onClick={doLogout} disabled={busy} title="Sign out" className="flex items-center gap-1 rounded-full border border-slate-700 px-2 py-1 text-[11px] text-slate-400 hover:bg-slate-800 hover:text-white disabled:opacity-50"><LogOut size={12} /><span className="hidden sm:inline">{busy ? "…" : "Sign out"}</span></button>
    </div>
    {profileOpen && <MyProfileModal user={user} onClose={() => setProfileOpen(false)} onUpdated={u => { onUserUpdated({ ...user, ...u }); }} />}
  </>;
}

export default function App() {
  const [user, setUser] = useState(null);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    getMe().then(result => { if (result.success) setUser(result.user); }).catch(() => {}).finally(() => setChecking(false));
    const onUnauthenticated = () => setUser(null);
    window.addEventListener("netescalate:unauthenticated", onUnauthenticated);
    return () => window.removeEventListener("netescalate:unauthenticated", onUnauthenticated);
  }, []);

  // Registers the WebMCP tool surface for this tab once we know who's
  // logged in (see webmcp/index.js/agentContext.js - which tool groups get
  // registered depends on realm vs platform-admin status). Re-runs if the
  // user identity/realm-entry state changes; tears down on logout so a
  // stale session's tools stop being callable.
  useEffect(() => {
    if (!user) return undefined;
    initWebMCP(user);
    return () => { teardownWebMCP(); };
  }, [user?.technicianId, user?.enteredRealm?.realmId]);

  if (checking) {
    return <div className="flex min-h-screen items-center justify-center bg-[#050810] text-sm text-slate-500"><RefreshCw size={16} className="mr-2 animate-spin" /> Loading…</div>;
  }

  if (!user) {
    return <Login onLogin={setUser} />;
  }

  // A platform admin with no active Enter Realm context gets the wholly
  // separate Platform Command Center instead of the realm-user experience
  // below - see PlatformApp.jsx. Once they Enter a realm, user.enteredRealm
  // is set on their next /auth/me refresh and they fall through to the
  // normal tree with the banner prepended, reusing every existing
  // component as-is (the backend already scopes their requests via the
  // Enter Realm context cookie).
  if (user.platformRole && !user.enteredRealm) {
    return <PlatformApp user={user} onLoggedOut={() => setUser(null)} onUserUpdated={setUser} />;
  }

  return <>
    {user.enteredRealm && <EnterRealmBanner realmName={user.enteredRealm.realmName} />}
    <div className={user.enteredRealm ? "pt-9" : ""}>
      <UserBadge user={user} onLoggedOut={() => setUser(null)} onUserUpdated={setUser} />
      <NocDashboard user={user} />
      <NavigationBridge />
      <RootCauseCenter />
      <TopologyErrorBoundary><TopologyView /></TopologyErrorBoundary>
      <Phase4CommandCenter />
      <AgentActivityPanel />
    </div>
  </>;
}
