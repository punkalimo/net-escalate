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
  const button = Array.from(document.querySelectorAll("button")).find(candidate => candidate.textContent?.trim() === label);
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
    document.querySelector('button[title="Open Network Topology"]')?.click();
  }
}

function NavigationBridge() {
  const [active, setActive] = useState("overview");
  const [incidentCount, setIncidentCount] = useState(0);

  useEffect(() => {
    let lastCount = null;

    const sync = () => {
      const buttons = Array.from(document.querySelectorAll("button"));
      const incident = buttons.find(button => button.textContent?.includes("Incidents"));
      const count = incident?.querySelector("span:last-child")?.textContent?.trim();
      const nextCount = count && /^\d+$/.test(count) ? Number(count) : 0;

      // NocDashboard and TopologyView can update the DOM frequently. Do not
      // trigger a React render for every MutationObserver callback when the
      // incident count has not actually changed.
      if (nextCount !== lastCount) {
        lastCount = nextCount;
        setIncidentCount(nextCount);
      }
    };

    sync();
    const observer = new MutationObserver(sync);
    observer.observe(document.body, { subtree: true, childList: true, characterData: true });
    return () => observer.disconnect();
  }, []);

  const navigate = id => {
    setActive(id);
    openDestination(id);
  };

  return <>
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
