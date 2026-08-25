import { spawn } from "node:child_process";
import net from "node:net";
import Device from "../models/Device.js";

const COMMAND_TIMEOUT_MS = 30_000;
const MAX_HOPS = 16;

function isSafeTarget(value) {
  if (!value || typeof value !== "string" || value.length > 253) return false;
  if (net.isIP(value)) return true;
  return /^[a-zA-Z0-9.-]+$/.test(value) && !value.startsWith(".") && !value.endsWith(".");
}

function runCommand(command, args, timeout = COMMAND_TIMEOUT_MS) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { shell: false, windowsHide: true });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 1000).unref();
    }, timeout);

    child.stdout.on("data", chunk => { stdout += chunk.toString(); });
    child.stderr.on("data", chunk => { stderr += chunk.toString(); });
    child.on("error", error => {
      clearTimeout(timer);
      resolve({ ok: false, code: error.code || "SPAWN_ERROR", stdout, stderr, error: error.message });
    });
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      resolve({ ok: !timedOut && code === 0, code, signal, stdout, stderr, timedOut });
    });
  });
}

function parseTraceroute(output) {
  const hops = [];
  for (const rawLine of output.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || !/^\d+\s+/.test(line)) continue;
    const hop = Number(line.match(/^(\d+)/)?.[1]);
    if (!Number.isFinite(hop)) continue;
    const tokens = line.replace(/^\d+\s+/, "").split(/\s+/).filter(Boolean);
    const ip = tokens.find(token => net.isIP(token));
    const rtts = tokens.filter(token => /^\d+(?:\.\d+)?\s*ms$/i.test(token)).map(token => Number.parseFloat(token));
    hops.push({ hop, ip: ip || null, rttMs: rtts.length ? Math.min(...rtts) : null, raw: line });
  }
  return hops.slice(0, MAX_HOPS);
}

function parseNmap(output) {
  const lines = output.split(/\r?\n/);
  const openPorts = [];
  let deviceType = null;
  let running = null;
  let osDetails = null;
  let hostname = null;
  let latencyMs = null;

  for (const line of lines) {
    const trimmed = line.trim();
    if (/^Device type:/i.test(trimmed)) deviceType = trimmed.replace(/^Device type:\s*/i, "").trim();
    else if (/^Running:/i.test(trimmed)) running = trimmed.replace(/^Running:\s*/i, "").trim();
    else if (/^OS details:/i.test(trimmed)) osDetails = trimmed.replace(/^OS details:\s*/i, "").trim();
    else if (/^Nmap scan report for /i.test(trimmed)) hostname = trimmed.replace(/^Nmap scan report for /i, "").trim();
    else if (/^Host is up \(/i.test(trimmed)) {
      const match = trimmed.match(/\((\d+(?:\.\d+)?)s\)/i);
      if (match) latencyMs = Number.parseFloat(match[1]) * 1000;
    }

    const portMatch = trimmed.match(/^(\d+)\/(tcp|udp)\s+(open|closed|filtered)\s+(\S+)(?:\s+(.*))?$/i);
    if (portMatch && portMatch[3].toLowerCase() === "open") {
      openPorts.push({ port: Number(portMatch[1]), protocol: portMatch[2].toLowerCase(), state: "open", service: portMatch[4], version: portMatch[5]?.trim() || "" });
    }
  }

  return { hostname, latencyMs, deviceType, running, osDetails, openPorts };
}

function fallbackTraceroute(target) {
  if (process.platform === "win32") return ["tracert", "-d", "-h", String(MAX_HOPS), target];
  return ["traceroute", "-n", "-w", "1", "-q", "1", "-m", String(MAX_HOPS), target];
}

async function traceTarget(target) {
  const [command, ...args] = fallbackTraceroute(target);
  const result = await runCommand(command, args);
  if (result.ok || result.stdout) return { ...result, hops: parseTraceroute(result.stdout) };
  if (process.platform !== "win32") {
    const fallback = await runCommand("tracepath", ["-n", "-m", String(MAX_HOPS), target]);
    return { ...fallback, hops: parseTraceroute(fallback.stdout) };
  }
  return { ...result, hops: [] };
}

export async function discoverDevicePath(deviceId) {
  const device = await Device.findOne({ deviceId }).lean().exec();
  if (!device) return { success: false, status: 404, message: "Device not found." };
  if (!isSafeTarget(device.ipAddress)) return { success: false, status: 400, message: "Device has an invalid or unsupported IP/hostname." };

  const [trace, nmap] = await Promise.all([
    traceTarget(device.ipAddress),
    runCommand("nmap", ["-Pn", "-n", "-sV", "-O", "--osscan-guess", "--open", "--top-ports", "20", device.ipAddress], 45_000)
  ]);

  const hops = trace.hops || [];
  const nodes = [];
  const seen = new Set();
  const registeredByIp = new Map([[device.ipAddress, device]]);

  for (const hop of hops) {
    if (!hop.ip || seen.has(hop.ip)) continue;
    seen.add(hop.ip);
    const registered = registeredByIp.get(hop.ip);
    nodes.push({
      id: `hop-${hop.hop}-${hop.ip}`,
      ipAddress: hop.ip,
      hostname: registered?.hostname || hop.ip,
      label: registered?.hostname || `Hop ${hop.hop}`,
      deviceType: registered?.deviceType || "unknown-hop",
      role: registered ? "REGISTERED_DEVICE" : "ROUTING_HOP",
      status: registered?.status || "UNKNOWN",
      hop: hop.hop,
      rttMs: hop.rttMs,
      registeredDeviceId: registered?.deviceId || null
    });
  }

  const targetNode = {
    id: device.deviceId,
    ipAddress: device.ipAddress,
    hostname: device.hostname,
    label: device.hostname,
    deviceType: device.deviceType,
    role: "TARGET",
    status: device.status,
    vendor: device.vendor,
    model: device.model,
    location: device.location,
    hop: hops.find(h => h.ip === device.ipAddress)?.hop || null
  };
  if (!nodes.some(node => node.ipAddress === device.ipAddress)) nodes.push(targetNode);
  else {
    const existing = nodes.find(node => node.ipAddress === device.ipAddress);
    Object.assign(existing, targetNode);
  }

  const edges = [];
  for (let i = 0; i < nodes.length - 1; i += 1) {
    const current = nodes[i];
    const next = nodes[i + 1];
    if (!current || !next) continue;
    edges.push({ id: `path-${i + 1}`, source: current.id, target: next.id, rttMs: next.rttMs, state: "UP", label: next.rttMs == null ? "route" : `${next.rttMs.toFixed(1)} ms` });
  }

  const nmapParsed = parseNmap(nmap.stdout || "");
  const scanStatus = nmap.error === "ENOENT" ? "NOT_INSTALLED" : nmap.timedOut ? "TIMEOUT" : nmap.ok || nmap.stdout ? "COMPLETE" : "FAILED";

  return {
    success: true,
    generatedAt: new Date().toISOString(),
    target: { deviceId: device.deviceId, hostname: device.hostname, ipAddress: device.ipAddress, status: device.status },
    method: { traceroute: trace.ok || hops.length > 0 ? "COMPLETE" : "FAILED", nmap: scanStatus },
    traceroute: { command: process.platform === "win32" ? "tracert" : "traceroute", hops, error: trace.stderr?.trim() || null },
    nmap: { ...nmapParsed, error: nmap.error || nmap.stderr?.trim() || null },
    nodes,
    edges,
    warnings: [
      ...(trace.timedOut ? ["Traceroute timed out before completing all hops."] : []),
      ...(nmap.error === "ENOENT" ? ["Nmap is not installed on the NetEscalate backend host."] : []),
      ...(nmap.timedOut ? ["Nmap scan timed out."] : [])
    ]
  };
}

export default { discoverDevicePath };
