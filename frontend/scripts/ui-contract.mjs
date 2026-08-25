import fs from "node:fs";

const component = fs.readFileSync("src/components/Phase4CommandCenter.jsx", "utf8");
const app = fs.readFileSync("src/App.jsx", "utf8");
const requiredLabels = ["Phase 4 Command Center", "Discover topology", "Rebuild correlation", "Root-cause analysis", "Historical analytics", "Configuration change detection", "Network automation", "AI troubleshooting assistant"];
const requiredEndpoints = ["/api/phase4/overview", "/api/phase4/analytics", "/api/incidents/correlation", "/api/phase4/rca", "/api/phase4/config-changes", "/api/phase4/automation/run", "/api/phase4/assistant"];
const requiredIcons = ["Network", "GitBranch", "ShieldAlert", "Cable", "TrendingUp", "History", "Play", "Bot"];

for (const label of requiredLabels) if (!component.includes(label)) throw new Error(`UI contract missing label: ${label}`);
for (const endpoint of requiredEndpoints) if (!component.includes(endpoint)) throw new Error(`UI contract missing endpoint: ${endpoint}`);
for (const icon of requiredIcons) if (!component.includes(icon)) throw new Error(`UI contract missing visual affordance: ${icon}`);
if (!app.includes("Phase4CommandCenter")) throw new Error("Phase 4 Command Center is not mounted by App.jsx");
if (!component.includes("fixed bottom-5 right-5")) throw new Error("Phase 4 launcher is not positioned as an accessible floating control");
if (!component.includes("overflow-y-auto")) throw new Error("Command Center content is not scrollable");
console.log("UI contract checks passed: launcher, tabs, controls, endpoints and responsive scroll affordances are present.");
