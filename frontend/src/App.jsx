import NocDashboard from "./NocDashboard";
import TopologyView from "./components/TopologyView";
import TopologyErrorBoundary from "./components/TopologyErrorBoundary";
import RootCauseCenter from "./components/RootCauseCenter";

export default function App() {
  return <>
    <NocDashboard />
    <RootCauseCenter />
    <TopologyErrorBoundary>
      <TopologyView />
    </TopologyErrorBoundary>
  </>;
}
