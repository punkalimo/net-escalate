# Device Path Discovery

NetEscalate now supports targeted network-path analysis for a single registered device. This is intentionally different from the fleet topology view: instead of drawing every device known to NetEscalate, the operator selects one target and NetEscalate traces the route toward that target.

## What it does

1. Loads the selected device from the NetEscalate inventory.
2. Runs `traceroute` on Linux/macOS or `tracert` on Windows.
3. Falls back to `tracepath` on Linux when `traceroute` is unavailable.
4. Draws each observed routing hop in order.
5. Correlates hop IP addresses with registered NetEscalate devices when possible.
6. Runs a targeted Nmap scan against only the selected device.
7. Uses Nmap service detection and, where privileges permit, OS/device fingerprinting.
8. Shows open TCP/UDP ports and detected services in the UI.
9. Reports scan warnings instead of silently presenting incomplete discovery data.

## Nmap requirements

Install Nmap on the machine running the NetEscalate backend.

### Debian/Ubuntu/Linux Mint

```bash
sudo apt update
sudo apt install nmap traceroute
```

`tracepath` is used automatically as a Linux fallback when `traceroute` is unavailable.

### Verify

```bash
nmap --version
traceroute --version
```

If Nmap OS fingerprinting cannot run because the backend is not privileged, NetEscalate automatically retries with an unprivileged `-sV` service scan. This still provides useful port and service information without requiring the backend process to run as root.

## API

### GET

`GET /api/topology/devices/:deviceId/path`

### POST

`POST /api/topology/devices/:deviceId/path/discover`

Both endpoints return the same discovery model containing:

- `target` — selected device identity and current monitoring state
- `traceroute` — command, observed hops, RTT and errors
- `nmap` — fingerprint, services, open ports and scan status
- `nodes` — ordered path nodes for rendering
- `edges` — links between observed hops
- `warnings` — explicit operational caveats

## Why this is not TTL-based device typing

TTL values can be useful as a clue, but they are not reliable device classification. NetEscalate therefore does not label an intermediate traceroute hop as a router, switch or firewall merely because of its TTL.

An unregistered hop is labelled `ROUTING_HOP`. If its IP matches a registered NetEscalate device, the existing inventory metadata is used. Nmap fingerprinting is applied to the selected target, where it can provide additional evidence such as device type, OS details and services.

## UI workflow

Open **Topology** and choose **Device path**.

1. Select a registered device.
2. Click **Trace & fingerprint**.
3. Review the path canvas for hop-by-hop latency.
4. Inspect the Nmap panel for exposed services and fingerprint data.
5. Use the traceroute evidence panel to identify the point where latency changes.

The existing **Fleet map** remains available for CDP/LLDP-based infrastructure relationships.
