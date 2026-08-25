import NocDashboard from "./NocDashboard";
import TopologyView from "./components/TopologyView";
import TopologyInteraction from "./components/TopologyInteraction";
import TopologyErrorBoundary from "./components/TopologyErrorBoundary";

export default function App() {
  return <>
    <NocDashboard />
    <TopologyErrorBoundary>
      <TopologyView />
      <TopologyInteraction />
    </TopologyErrorBoundary>
  </>;
}
