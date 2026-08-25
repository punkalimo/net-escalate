import NocDashboard from "./NocDashboard";
import TopologyView from "./components/TopologyView";
import TopologyErrorBoundary from "./components/TopologyErrorBoundary";

export default function App() {
  return <>
    <NocDashboard />
    <TopologyErrorBoundary>
      <TopologyView />
    </TopologyErrorBoundary>
  </>;
}
