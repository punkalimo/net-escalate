import mongoose from "mongoose";

// interfaceMetricsSchema holds the CURRENT snapshot only (last raw counter
// reading used for the next delta calc, last computed rates, current health).
// It is not a time series - per-poll history lives in InterfaceSample so
// utilization/error-rate trending and flap detection stay possible without
// this document growing unbounded.
const interfaceMetricsSchema = new mongoose.Schema(
  {
    ifIndex: { type: Number, default: null }, speedMbps: { type: Number, default: null }, speedSource: { type: String, default: null }, duplex: { type: String, default: "UNKNOWN" }, mtu: { type: Number, default: null }, macAddress: { type: String, default: null }, adminStatus: { type: Number, default: null }, operStatus: { type: Number, default: null }, inOctets: { type: Number, default: 0 }, outOctets: { type: Number, default: 0 }, octetSource: { type: String, enum: ["HC", "legacy", null], default: null }, inErrors: { type: Number, default: 0 }, outErrors: { type: Number, default: 0 }, inDiscards: { type: Number, default: 0 }, outDiscards: { type: Number, default: 0 }, inBps: { type: Number, default: null }, outBps: { type: Number, default: null }, utilizationPercent: { type: Number, default: null },
    // Error/discard RATE (per minute, from a counter delta) - not the raw
    // cumulative counters above, which only ever grow and would otherwise
    // make an interface alert forever once it crossed an absolute lifetime
    // total. These drive the separate "interface degradation" incident type,
    // independent of the utilization-based health below.
    errorRatePerMin: { type: Number, default: null }, discardRatePerMin: { type: Number, default: null },
    sampleIntervalSeconds: { type: Number, default: null }, checkedAt: { type: Date, default: null }, health: { type: String, enum: ["HEALTHY", "WARNING", "DEGRADED", "CRITICAL", "DOWN", "ADMIN_DOWN", "UNMONITORED", "UNKNOWN"], default: "UNKNOWN" }, healthScore: { type: Number, default: null }, healthReasons: { type: [String], default: [] }, activeIncidentId: { type: String, default: null },
    // Independent fault tracks, each with their own incident latch so a
    // status (down/utilization) fault and a rising-error-rate fault on the
    // same interface can be open at the same time as two distinct incidents.
    degradationIncidentId: { type: String, default: null }, degradationIncidentLatched: { type: Boolean, default: false }
  }, { _id: false }
);

// Bounded rolling window of recent up/down transitions, used purely for
// flap detection - not a general audit log. Pruned to the configured
// window on every poll so it can't grow unbounded.
const flapStateSchema = new mongoose.Schema(
  {
    transitions: { type: [{ at: { type: Date, required: true }, status: { type: String, enum: ["UP", "DOWN"], required: true } }], default: [] },
    incidentId: { type: String, default: null },
    incidentLatched: { type: Boolean, default: false },
    // While set and in the future, individual up/down incidents are
    // suppressed for this interface even if the transition count has
    // dropped back under the threshold - the "stops for a cooldown period"
    // requirement, so a pattern that pauses for a few seconds mid-flap
    // doesn't immediately resume paging per-transition.
    cooldownUntil: { type: Date, default: null }
  }, { _id: false }
);

const interfaceSchema = new mongoose.Schema(
  {
    name: { type: String, required: true }, description: { type: String, default: "" }, ipAddress: { type: String, default: "" }, ifIndex: { type: Number, default: null },
    // status = operational state (ifOperStatus), refreshed on the fast poll cadence.
    status: { type: String, enum: ["UP", "DOWN", "UNKNOWN"], default: "UNKNOWN" },
    // adminState = ifAdminStatus, refreshed only on the slow admin-sync cadence
    // (config-driven, changes rarely). Kept as its own top-level field -
    // alongside `status` - for fast current-state lookups without reaching
    // into `metrics`.
    adminState: { type: String, enum: ["UP", "DOWN", "UNKNOWN"], default: "UNKNOWN" },
    // Per-interface alerting opt-out/opt-in. Defaulted at discovery time
    // (true only if the port was admin-up when first seen; unused ports
    // default to false) and preserved across re-discovery - discovery is an
    // upsert keyed on ifIndex, never a delete-and-recreate, so this and any
    // other manual override survives.
    monitored: { type: Boolean, default: true },
    lastAdminSyncAt: { type: Date, default: null },
    lastCheckedAt: { type: Date, default: null }, metrics: { type: interfaceMetricsSchema, default: () => ({}) },
    flap: { type: flapStateSchema, default: () => ({}) }
  }, { _id: false }
);

const monitoredPortSchema = new mongoose.Schema(
  {
    port: { type: Number, required: true, min: 1, max: 65535 }, protocol: { type: String, enum: ["tcp", "udp"], default: "tcp" }, name: { type: String, default: "" }, enabled: { type: Boolean, default: true }, status: { type: String, enum: ["UP", "DOWN", "UNKNOWN"], default: "UNKNOWN" }, lastCheckedAt: { type: Date, default: null }
  }, { _id: false }
);

const snmpSchema = new mongoose.Schema(
  {
    enabled: { type: Boolean, default: false }, version: { type: String, enum: ["1", "2c", "3"], default: "2c" }, community: { type: String, default: "public", trim: true }, username: { type: String, default: "", trim: true }, securityLevel: { type: String, enum: ["noAuthNoPriv", "authNoPriv", "authPriv"], default: "noAuthNoPriv" }, authProtocol: { type: String, default: "", trim: true }, authKey: { type: String, default: "" }, privProtocol: { type: String, default: "", trim: true }, privKey: { type: String, default: "" }
  }, { _id: false }
);

// Current-state snapshot for one system-health metric (CPU or a memory
// pool). Same pattern as interfaceMetricsSchema: last reading + computed
// health here for fast lookups, per-poll history in DeviceSystemSample.
const systemMetricSchema = new mongoose.Schema(
  {
    utilizationPercent: { type: Number, default: null }, checkedAt: { type: Date, default: null }, health: { type: String, enum: ["HEALTHY", "WARNING", "DEGRADED", "CRITICAL", "UNKNOWN"], default: "UNKNOWN" }, healthReasons: { type: [String], default: [] }, activeIncidentId: { type: String, default: null }, incidentLatched: { type: Boolean, default: false }
  }, { _id: false }
);

const deviceSchema = new mongoose.Schema(
  {
    deviceId: { type: String, unique: true, required: true, trim: true }, parentDeviceId: { type: String, default: null, index: true },
    // Every device belongs to exactly one Realm. ipAddress is deliberately
    // NOT globally unique here - two tenants very commonly monitor the same
    // private-range IP (e.g. both have a 10.0.0.1 core router). See the
    // realmId+ipAddress compound unique index below instead.
    realmId: { type: mongoose.Schema.Types.ObjectId, ref: "Realm", required: true, index: true },
    // Optional, not required: existing devices predate Sites and stay
    // "Unassigned" rather than needing a forced backfill. Always the same
    // Realm as the device itself - enforced at the route layer (deviceRoutes.js),
    // never trusted from the client alone.
    siteId: { type: mongoose.Schema.Types.ObjectId, ref: "Site", default: null, index: true },
    // Topology tier, used to weight incident severity (a core-device fault
    // outranks the same fault on an access switch or host) - set explicitly
    // per device rather than inferred from parentDeviceId depth, since a
    // shallow tree doesn't always mean "important."
    role: { type: String, enum: ["core", "edge", "access", "host"], default: "access" },
    hostname: { type: String, required: true, trim: true }, ipAddress: { type: String, required: true, trim: true }, deviceType: { type: String, enum: ["router", "switch", "firewall", "server", "access-point", "printer", "other"], default: "other" }, vendor: { type: String, default: "" }, model: { type: String, default: "" }, location: { type: String, default: "" }, description: { type: String, default: "" }, interfaces: { type: [interfaceSchema], default: [] }, monitoringEnabled: { type: Boolean, default: true }, pollingInterval: { type: Number, default: 30, min: 5 }, monitoringMethods: { type: [{ type: String, enum: ["icmp", "snmp", "http", "https"] }], default: ["icmp"] }, snmp: { type: snmpSchema, default: () => ({}) }, http: { enabled: { type: Boolean, default: false }, protocol: { type: String, enum: ["http", "https"], default: "http" }, port: { type: Number, default: 80, min: 1, max: 65535 }, path: { type: String, default: "/" } },
    alertThresholds: {
      utilizationWarning: { type: Number, default: 70, min: 1, max: 100 }, utilizationDegraded: { type: Number, default: 85, min: 1, max: 100 }, utilizationCritical: { type: Number, default: 95, min: 1, max: 100 },
      // Combined in+out errors/discards per minute (a rate, not a lifetime
      // total) that trigger the separate "interface degradation" incident.
      errorRateWarningPerMin: { type: Number, default: 5, min: 0 }, errorRateCriticalPerMin: { type: Number, default: 30, min: 0 },
      // Flap detection: more than this many up/down transitions inside the
      // window (minutes) creates one flap incident and suppresses
      // individual up/down incidents until the pattern has been quiet for
      // the cooldown period (minutes).
      flapCountThreshold: { type: Number, default: 4, min: 1 }, flapWindowMinutes: { type: Number, default: 10, min: 1 }, flapCooldownMinutes: { type: Number, default: 5, min: 0 },
      cpuWarning: { type: Number, default: 80, min: 1, max: 100 }, cpuCritical: { type: Number, default: 95, min: 1, max: 100 },
      memoryWarning: { type: Number, default: 80, min: 1, max: 100 }, memoryCritical: { type: Number, default: 95, min: 1, max: 100 },
      // How long an active, unresolved incident below CRITICAL is allowed
      // to sit before severity weighting auto-promotes it.
      severityEscalationMinutes: { type: Number, default: 5, min: 1 }
    },
    monitoredPorts: { type: [monitoredPortSchema], default: [] }, status: { type: String, enum: ["UP", "DOWN", "DEGRADED", "UNKNOWN"], default: "UNKNOWN" }, lastSeenAt: { type: Date, default: null }, lastPollAt: { type: Date, default: null }, lastStatusChangeAt: { type: Date, default: null }, activeIncidentId: { type: String, default: null }, lastError: { type: String, default: null }, monitoringResult: { ping: { reachable: { type: Boolean, default: false }, latency: { type: Number, default: null }, error: { type: String, default: null } }, snmp: { reachable: { type: Boolean, default: false }, skipped: { type: Boolean, default: false }, value: { type: mongoose.Schema.Types.Mixed, default: null }, error: { type: String, default: null } }, http: { enabled: { type: Boolean, default: false }, reachable: { type: Boolean, default: false }, statusCode: { type: Number, default: null }, responseTime: { type: Number, default: null }, error: { type: String, default: null } }, ports: { type: mongoose.Schema.Types.Mixed, default: {} } },
    systemHealth: { cpu: { type: systemMetricSchema, default: () => ({}) }, memory: { type: systemMetricSchema, default: () => ({}) } }
  }, { timestamps: true }
);

deviceSchema.index({ realmId: 1, ipAddress: 1 }, { unique: true });
deviceSchema.index({ realmId: 1, status: 1 });
deviceSchema.index({ realmId: 1, monitoringEnabled: 1 });
deviceSchema.index({ realmId: 1, siteId: 1 });

// Normalize legacy records as soon as a device is saved. Runtime SNMP sessions also trim credentials, so existing records remain usable.
deviceSchema.pre("save", function normalizeSnmpCredentials(next) {
  if (this.snmp) {
    for (const field of ["community", "username", "authProtocol", "privProtocol"]) {
      if (typeof this.snmp[field] === "string") this.snmp[field] = this.snmp[field].trim();
    }
  }
  next();
});

const Device = mongoose.models.Device || mongoose.model("Device", deviceSchema);
export default Device;
