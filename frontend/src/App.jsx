import NocDashboard from "./NocDashboard";
import TopologyView from "./components/TopologyView";
import TopologyErrorBoundary from "./components/TopologyErrorBoundary";
import RootCauseCenter from "./components/RootCauseCenter";
import Phase4OperationsCenter from "./components/Phase4OperationsCenter";

export default function App() {
  return <>
    <NocDashboard />
    <RootCauseCenter />
    <TopologyErrorBoundary>
      <TopologyView />
    </TopologyErrorBoundary>
    <Phase4OperationsCenter />
  </>;
}
