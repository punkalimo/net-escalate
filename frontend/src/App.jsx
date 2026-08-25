import { useEffect, useState } from "react";
import { AlertTriangle, BrainCircuit, LayoutDashboard, Network, Server, Signal, Sparkles, UserRound } from "lucide-react";
import NocDashboard from "./NocDashboard";
import TopologyView from "./components/TopologyView";
import TopologyErrorBoundary from "./components/TopologyErrorBoundary";
import RootCauseCenter from "./components/RootCauseCenter";
import Phase4CommandCenter from "./components/Phase4CommandCenter";

const NAV_ITEMS = [
  ["overview", "Operations", LayoutDashboard],
  ["incidents", "Incidents", AlertTriangle],
  ["interfaces", "Interface Health", Signal],
  ["devices", "Devices", Server],
  ["technicians", "Escalation Team", UserRound],
  ["rca", "RCA", BrainCircuit],
  ["phase4", "Phase 4 Operations", Sparkles],
  ["topology", "Topology", Network],
];

function clickExisting(label) {
  // The lightweight navigation is rendered above NocDashboard. Do not click
  // the bridge button itself; target the original dashboard navigation button.
  const button = Array.from(document.querySelectorAll("aside button"))
    .find(candidate => candidate.textContent?.trim().startsWith(label));
  button?.click();
}

function openDestination(id) {
  if (["overview", "incidents", "interfaces", "devices", "technicians"].includes(id)) {
    clickExisting(NAV_ITEMS.find(([key]) => key === id)?.[1]);
    return;
  }

  if (id === "rca") {
    document.querySelector('button[title="Open Root Cause Analysis"]')?.click();
    return;
  }

  if (id === "phase4") {
    document.querySelector('button[aria-label="Phase 4 Command Center"]')?.click();
    return;
  }

  if (id === "topology") {
    document.querySelector('button.fixed.bottom-6.right-6')?.click();
  }
}

function IncidentSearchPolish() {
  return <style>{`
    /* Incident command search/filter refinement. Kept here so the existing
       incident data/filter logic remains untouched while the controls get a
       more deliberate NOC-console presentation. */
    input[placeholder^="Search ID, device"] {
      min-height: 44px;
      border-radius: 12px !important;
      border-color: rgb(30 41 59 / .95) !important;
      background: rgb(2 6 23 / .72) !important;
      box-shadow: inset 0 1px 0 rgb(255 255 255 / .02);
      font-size: 13px;
      transition: border-color .15s ease, box-shadow .15s ease, background .15s ease;
    }
    input[placeholder^="Search ID, device"]:focus {
      border-color: rgb(59 130 246 / .55) !important;
      background: rgb(2 6 23 / .95) !important;
      box-shadow: 0 0 0 3px rgb(59 130 246 / .08), inset 0 1px 0 rgb(255 255 255 / .03);
    }
    input[placeholder^="Search ID, device"]::placeholder { color: rgb(71 85 105); }

    input[placeholder^="Search ID, device"] + * { pointer-events: none; }

    section:has(input[placeholder^="Search ID, device"]) > div:first-child {
      padding: 18px !important;
      background: linear-gradient(180deg, rgb(15 23 42 / .42), rgb(15 23 42 / .18));
    }
    section:has(input[placeholder^="Search ID, device"]) > div:first-child > div:first-child {
      align-items: stretch;
      gap: 12px;
    }
    section:has(input[placeholder^="Search ID, device"]) select {
      min-height: 42px;
      min-width: 145px;
      border-radius: 10px !important;
      border-color: rgb(30 41 59 / .95) !important;
      background-color: rgb(2 6 23 / .78) !important;
      color: rgb(203 213 225) !important;
      font-size: 12px;
      font-weight: 600;
      cursor: pointer;
      transition: border-color .15s ease, background-color .15s ease;
    }
    section:has(input[placeholder^="Search ID, device"]) select:hover {
      border-color: rgb(51 65 85) !important;
      background-color: rgb(15 23 42 / .95) !important;
    }
    section:has(input[placeholder^="Search ID, device"]) select:focus {
      border-color: rgb(59 130 246 / .55) !important;
      box-shadow: 0 0 0 3px rgb(59 130 246 / .08);
      outline: none;
    }
    section:has(input[placeholder^="Search ID, device"]) > div:first-child > div:last-child {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      padding-top: 0 !important;
      border-top: 1px solid rgb(30 41 59 / .7);
      margin-top: 2px;
      padding-top: 14px !important;
    }
    @media (min-width: 1024px) {
      section:has(input[placeholder^="Search ID, device"]) > div:first-child > div:first-child { align-items: center; }
      section:has(input[placeholder^="Search ID, device"]) input[placeholder^="Search ID, device"] { min-width: 280px; }
    }
    @media (max-width: 640px) {
      section:has(input[placeholder^="Search ID, device"]) select { flex: 1 1 145px; min-width: 0; }
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
    <nav aria-label="Primary navigation" className="fixed left-0 top-16 z-[45] hidden h-[calc(100vh-16rem)] w-64 border-r border-slate-800/80 bg-[#080d16] px-3 py-3 shadow-xl shadow-black/20 lg:block">
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

export default function App() {
  return <>
    <NocDashboard />
    <NavigationBridge />
    <RootCauseCenter />
    <TopologyErrorBoundary><TopologyView /></TopologyErrorBoundary>
    <Phase4CommandCenter />
  </>;
}
