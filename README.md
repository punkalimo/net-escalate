# NetEscalate

NetEscalate is a network operations and incident-response platform for monitoring infrastructure, detecting faults, collecting SNMP interface telemetry, correlating network conditions, and escalating incidents to technicians.

The project is designed as a practical NOC platform rather than a simple device-status dashboard. It combines device monitoring, interface health, historical telemetry, incident lifecycle management, escalation workflows, and an interactive network topology view.

## Agentic NOC

NetEscalate is not "network monitoring with an AI chatbot bolted on." It is an **agent-native NOC**: humans and AI agents share the same operational workspace, through [WebMCP](https://webmachinelearning.github.io/webmcp/) (`document.modelContext`) - the real, current browser API for exposing website capabilities to AI agents, not a look-alike.

```
Traditional NOC:
  Human → dashboard → search → investigate → correlate → assign → document

NetEscalate:
  Human + Agent → shared operational workspace → structured investigation → human-approved action
```

A compatible agent (Claude, ChatGPT, Gemini, or any MCP client bridged into the browser tab) can:

- search devices, inspect device/interface health, and pull incident intelligence - all **read-only**
- run `investigate_incident`, which orchestrates NetEscalate's existing root-cause, blast-radius, correlation, historical-matching, change-correlation and SLA services into one investigation, with observed facts, inferred conclusions and recommendations clearly separated, plus a 0-1 confidence score
- **with explicit human approval**, create an incident, assign it to a specific technician, or add an investigation note - each shown as an "Agent is requesting permission to..." card in the **Agent Activity** panel before anything happens

Every tool call is authenticated exactly like a human dashboard request (same session cookie, same `req.realmId` realm scoping, same authorization middleware) - an agent operates strictly inside the same security boundary a logged-in NOC engineer does, never outside it. See [`docs/WEBMCP.md`](docs/WEBMCP.md) for the full architecture, tool catalog, security model, prompt-injection boundary, and the deterministic demo scenario (`cd backend && npm run seed-demo`).

## WebMCP Challenge Demo

> Don't ask an AI about your NOC. Let the AI work inside your NOC.

**1. What WebMCP adds.** Without it, an AI agent can only describe NetEscalate from a screenshot or a copy-pasted API response. With `document.modelContext.registerTool()` registered directly in the logged-in dashboard tab (`frontend/src/webmcp/`), an agent instead *operates* NetEscalate: it discovers the same tools a human dashboard exposes, calls them with the human's own authenticated session, and its actions - and any pending approvals - render live in the same UI the human is already looking at.

**2. The key tools.** 9 read-only tools (`search_devices`, `get_device_health`, `get_device_interfaces`, `get_interface_health`, `get_active_incidents`, `get_incident`, `investigate_incident`, `get_network_topology`, `find_available_technicians`/`get_technician`) plus 2 platform-admin-only read tools (`list_realms`, `get_realm_overview`), and 3 consequential tools (`create_incident`, `assign_incident`, `add_incident_note`). `investigate_incident` is the flagship: one call orchestrates NetEscalate's existing root-cause, blast-radius, correlation, historical-match, change-correlation and SLA services and returns observed facts, inferred conclusions and recommendations as distinct sections, plus a 0-1 confidence score. Full inventory, schemas and backend routes: [`docs/WEBMCP.md` §4](docs/WEBMCP.md#4-available-tools).

**3. Human approval model.** `create_incident`, `assign_incident` and `add_incident_note` are consequential: calling one blocks on an "Agent is requesting permission to..." card in the **Agent Activity** panel, and the backend fetch that would perform the mutation is literally inside the code path that only runs after a human clicks **Approve** - there is no path around it. **Reject** resolves the call with a normal `APPROVAL_REJECTED` result and performs no mutation at all. See [`docs/WEBMCP.md` §7](docs/WEBMCP.md#7-human-approval-for-consequential-actions).

**4. Realm isolation.** A WebMCP tool call carries no agent-supplied identity or realm id - `req.realmId` is derived once, server-side, from the same session cookie/middleware chain (`requireAuth` → `attachRealmScope`) every human dashboard request already goes through, so an agent can never see or act on another realm's devices, incidents or technicians no matter what a tool call's arguments claim. Covered by automated cross-realm/IDOR tests in `backend/test/webmcpTools.test.js`. See [`docs/WEBMCP.md` §6](docs/WEBMCP.md#6-authentication-and-authorization).

**5. Deterministic demo setup.** `cd backend && npm run seed-demo` seeds an idempotent "Demo NOC" realm: a critical WAN-degradation incident on `Core-Router-01` correlated with three downstream incidents, a full topology, and a login (`demo` / `DemoPass123!`, printed by the script). See [`docs/WEBMCP.md` §15](docs/WEBMCP.md#15-demo-scenario) for the full scripted walkthrough.

**6. How to test WebMCP.** With the seeded scenario running (backend + frontend dev servers, logged in as `demo`), open devtools on the dashboard tab and confirm the tools are live:
```js
const tools = await document.modelContext.getTools();
console.table(tools.map(t => ({ name: t.name })));
```
Then point any MCP-compatible agent (Claude, ChatGPT, an MCP browser extension) at that tab and ask it to investigate `Core-Router-01`. Full step-by-step: [`docs/WEBMCP.md` §11-13](docs/WEBMCP.md#11-local-testing).

**7. Known browser requirements.** NetEscalate uses [`@mcp-b/global`](https://www.npmjs.com/package/@mcp-b/global), which installs `document.modelContext` using the browser's **native** WebMCP implementation when one is present (e.g. Chrome behind `chrome://flags/#enable-webmcp-testing`) and a spec-compliant **polyfill** otherwise - the same code runs in both cases, and NetEscalate never claims native support it can't verify in your browser. No extra extension is required to see the tools register; an MCP-compatible client/extension is only needed to have an actual AI agent call them.

## Core capabilities

- Network device inventory for routers, switches, firewalls, servers, access points and other infrastructure.
- ICMP/device reachability monitoring with live Socket.IO dashboard updates.
- SNMP v1/v2c device polling and SNMP interface discovery.
- Interface operational/admin state monitoring.
- Interface speed, duplex, traffic, error and discard counters.
- Historical interface samples and utilization analysis.
- Interface health and slow-link detection.
- Automatic device/interface outage incidents with lifecycle protection against repeated duplicate incidents.
- Incident severity, acknowledgement, escalation levels, technician assignment and resolution history.
- Simulated escalation/call workflow for development and demonstration.
- Device CRUD, SNMP testing, TCP port testing, polling and interface discovery.
- Interactive SVG network topology discovery using Cisco CDP and standards-based LLDP.
- Live technical NOC dashboard with filtering, prioritisation and responsive UI.

## Architecture

```text
                         +----------------------+
                         |      React NOC UI    |
                         |  Dashboard / Health   |
                         |  Incidents / Devices  |
                         |      Topology SVG     |
                         +----------+-----------+
                                    |
                              REST / Socket.IO
                                    |
                         +----------v-----------+
                         |   Express API        |
                         |                      |
                         | Devices              |
                         | Interfaces           |
                         | Topology             |
                         | Incidents            |
                         | Technicians          |
                         +----------+-----------+
                                    |
             +----------------------+----------------------+
             |                      |                      |
      +------v------+       +-------v-------+       +------v------+
      | Monitoring  |       | SNMP Engine   |       | Escalation  |
      | ICMP / poll|       | IF-MIB/CDP/   |       | / Call-e    |
      |             |       | LLDP          |       | simulation  |
      +------+------+       +-------+-------+       +-------------+
             |                       |
             +-----------+-----------+
                         |
                   +-----v-----+
                   | MongoDB   |
                   +-----------+

                  Network infrastructure
                         |
              +----------+----------+
              |                     |
          SNMP/ICMP               CDP/LLDP
              |                     |
        Routers / Switches / Firewalls / Servers
```

## Repository structure

```text
net-escalate/
├── backend/
│   ├── src/
│   │   ├── models/
│   │   │   ├── Device.js
│   │   │   ├── Incident.js
│   │   │   ├── InterfaceSample.js
│   │   │   └── Technician.js
│   │   ├── routes/
│   │   │   ├── deviceRoutes.js
│   │   │   ├── incidentRoutes.js
│   │   │   ├── interfaceRoutes.js
│   │   │   ├── technicianRoutes.js
│   │   │   └── topologyRoutes.js
│   │   ├── services/
│   │   │   ├── deviceMonitoringService.js
│   │   │   ├── interfaceMonitoringService.js
│   │   │   ├── incidentService.js
│   │   │   ├── snmpService.js
│   │   │   └── topologyService.js
│   │   └── server.js
│   └── package.json
│
└── frontend/
    ├── src/
    │   ├── components/
    │   │   ├── InterfaceHealthCenter.jsx
    │   │   └── TopologyView.jsx
    │   ├── services/api.js
    │   ├── NocDashboard.jsx
    │   ├── App.jsx
    │   └── main.jsx
    └── package.json
```

## Network topology discovery

The topology engine is intended to behave like a visual network-mapping tool: it discovers neighbor relationships and renders an actual labelled diagram rather than returning a plain list of devices.

### Discovery sources

1. **Cisco CDP**
   - Reads Cisco CDP neighbor information through the CDP-MIB.
   - Identifies the local interface, remote device identifier, remote interface, platform and address where available.

2. **LLDP**
   - Reads standards-based LLDP remote-system information.
   - Uses remote system name/chassis information and remote port information where available.

3. **NetEscalate device inventory**
   - Only registered devices are rendered as topology nodes.
   - A discovered neighbor is converted into a drawn link when it can be matched to a registered hostname, device ID or IP address.

### API

```text
GET  /api/topology
POST /api/topology/discover
```

The response contains:

```json
{
  "success": true,
  "generatedAt": "2026-08-25T00:00:00.000Z",
  "discovery": {
    "nodes": 4,
    "links": 3
  },
  "nodes": [],
  "edges": [],
  "diagnostics": []
}
```

Each node includes its hostname, IP address, type, vendor, model and current monitoring status. Each link includes the discovery protocol, local/remote interfaces and an effective link state based on the endpoint states.

### UI

The topology viewer is available from the floating **Topology** action in the NOC interface. It provides:

- SVG-drawn network devices.
- Device-type icons.
- Hostname and IP labels.
- Online/degraded/offline state indicators.
- Interface labels on links.
- Link state visualisation.
- Search/filtering.
- Zoom controls.
- Device selection details.
- Discovery diagnostics showing CDP/LLDP results per device.
- Rediscovery without restarting the application.

## SNMP requirements

For interface monitoring and topology discovery, the device must expose SNMP and the credentials in NetEscalate must match the device.

Example Cisco configuration for a lab router:

```text
snmp-server community netescalate RO
cdp run
lldp run
```

For NetEscalate, configure the device with:

```text
SNMP enabled: Yes
Version: 2c
Community: netescalate
```

A GNS3/Cisco lab can be used for development. The project has already been tested against a Cisco device at `192.168.122.2` using SNMP v2c and the `netescalate` community.

## Interface monitoring

NetEscalate collects standard IF-MIB counters including:

- `ifSpeed`
- `ifHighSpeed`
- `ifAdminStatus`
- `ifOperStatus`
- `ifInOctets`
- `ifOutOctets`
- `ifInErrors`
- `ifOutErrors`
- `ifInDiscards`
- `ifOutDiscards`
- duplex information where supported

Traffic rates and utilization are derived from counter deltas over time. Historical samples are stored so the UI can show utilization trends and investigate slow links.

The monitoring engine also protects against stale SNMP information: a failed poll must not make a previously healthy interface appear healthy, and a parent device that is confirmed down takes precedence over stale interface state.

## Incident lifecycle

The monitoring system is designed to avoid incident storms when a device remains down:

```text
Fault detected
     |
     v
 Incident created
     |
     v
 Escalation workflow
     |
     v
 Technician acknowledgement
     |
     v
 Fault remains monitored
     |
     +---- still down ----> keep incident latched
     |
     +---- recovered ----> monitoring resolves incident
```

Automatic outage incidents should not be manually resolved while the underlying monitored fault remains active. Recovery telemetry releases the incident condition.

## Installation

### Prerequisites

- Node.js 20+ recommended.
- MongoDB 7+ recommended.
- npm.
- SNMP-enabled network devices for live monitoring.
- Optional: GNS3/EVE-NG/CML for a safe lab environment.

### Backend

```bash
cd backend
npm install
```

Create `backend/.env`:

```env
PORT=5000
MONGODB_URI=mongodb://127.0.0.1:27017/netescalate
FRONTEND_URL=http://localhost:5173
```

Start development mode:

```bash
npm run dev
```

### Frontend

```bash
cd frontend
npm install
npm run dev
```

The Vite development server normally runs on:

```text
http://localhost:5173
```

The API normally runs on:

```text
http://localhost:5000
```

## Useful API endpoints

```text
GET    /api/health
GET    /api/devices
POST   /api/devices
PATCH  /api/devices/:deviceId
DELETE /api/devices/:deviceId
POST   /api/devices/:deviceId/poll
POST   /api/devices/:deviceId/test-snmp
POST   /api/devices/:deviceId/test-port
POST   /api/devices/:deviceId/test-connectivity

GET    /api/interfaces/:deviceId
POST   /api/interfaces/:deviceId/discover
GET    /api/interfaces/:deviceId/history

GET    /api/topology
POST   /api/topology/discover

GET    /api/incidents
POST   /api/incidents
PATCH  /api/incidents/:incidentId/resolve
```

## Development workflow

For a local lab, a useful sequence is:

1. Start MongoDB.
2. Start the backend.
3. Start the frontend.
4. Add a router/switch/firewall under **Devices**.
5. Configure SNMP v2c credentials.
6. Confirm **Test SNMP** succeeds.
7. Discover interfaces.
8. Confirm interface state and traffic telemetry.
9. Configure CDP/LLDP on the lab devices.
10. Open **Topology** and run **Rediscover**.
11. Confirm devices and labelled links appear.
12. Introduce a controlled lab failure and verify that device/interface health and incident state change together.

## Troubleshooting topology discovery

### Devices appear but no links are drawn

Check:

- SNMP is enabled on the devices.
- The SNMP community is correct.
- CDP is enabled on Cisco devices, or LLDP is enabled on supported devices.
- The neighboring device has been added to NetEscalate.
- The discovered remote hostname/device ID can be matched to the registered device hostname/device ID.

The topology diagnostics at the bottom of the viewer show whether each device returned CDP/LLDP neighbors.

### SNMP timeout

Test from the monitoring host:

```bash
snmpwalk -v2c -c netescalate <DEVICE_IP> 1.3.6.1.2.1.1.1.0
```

Then test interface state:

```bash
snmpwalk -v2c -c netescalate <DEVICE_IP> 1.3.6.1.2.1.2.2.1.8
```

### Socket cleanup error

NetEscalate's SNMP service uses defensive session cleanup so a UDP socket that has already been closed does not crash the Node.js monitoring process with `ERR_SOCKET_DGRAM_NOT_RUNNING`.

## Roadmap

The topology feature is the foundation for the next NetEscalate intelligence layer:

1. Network topology discovery — implemented.
2. Incident correlation across topology paths.
3. Root-cause analysis for cascading outages.
4. Suppression of child incidents when a root fault explains the outage.
5. Advanced interface health scoring and slow-link detection.
6. Historical performance and availability analytics.
7. Configuration-change correlation.
8. Assisted troubleshooting and recommendations.
9. Controlled network remediation/automation.

## Design principles

- Preserve device-management capabilities while adding monitoring features.
- Prefer real telemetry over inferred health.
- Never treat stale SNMP data as a confirmed healthy state.
- Avoid duplicate incidents for the same persistent fault.
- Make network relationships visible to operators.
- Keep the UI usable for a busy NOC: prioritised data, search, filtering and drill-down.
- Use standards such as SNMP, CDP and LLDP rather than vendor-specific assumptions wherever practical.

## Status

NetEscalate is an active development project. The current codebase includes the monitoring, interface health, incident/escalation and topology foundations needed to evolve it into a full network operations and automated incident-response platform.

## License

[MIT](LICENSE)
