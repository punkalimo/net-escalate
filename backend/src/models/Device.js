import mongoose from "mongoose";

const interfaceMetricsSchema = new mongoose.Schema(
  {
    ifIndex: { type: Number, default: null }, speedMbps: { type: Number, default: null }, speedSource: { type: String, default: null }, duplex: { type: String, default: "UNKNOWN" }, inOctets: { type: Number, default: 0 }, outOctets: { type: Number, default: 0 }, inErrors: { type: Number, default: 0 }, outErrors: { type: Number, default: 0 }, inDiscards: { type: Number, default: 0 }, outDiscards: { type: Number, default: 0 }, inBps: { type: Number, default: null }, outBps: { type: Number, default: null }, utilizationPercent: { type: Number, default: null }, sampleIntervalSeconds: { type: Number, default: null }, checkedAt: { type: Date, default: null }, health: { type: String, enum: ["HEALTHY", "WARNING", "DEGRADED", "CRITICAL", "DOWN", "UNKNOWN"], default: "UNKNOWN" }, healthScore: { type: Number, default: null }, healthReasons: { type: [String], default: [] }, activeIncidentId: { type: String, default: null }
  }, { _id: false }
);

const interfaceSchema = new mongoose.Schema(
  {
    name: { type: String, required: true }, description: { type: String, default: "" }, ipAddress: { type: String, default: "" }, ifIndex: { type: Number, default: null }, status: { type: String, enum: ["UP", "DOWN", "UNKNOWN"], default: "UNKNOWN" }, lastCheckedAt: { type: Date, default: null }, metrics: { type: interfaceMetricsSchema, default: () => ({}) }
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

const deviceSchema = new mongoose.Schema(
  {
    deviceId: { type: String, unique: true, required: true, trim: true }, hostname: { type: String, required: true, trim: true }, ipAddress: { type: String, unique: true, required: true, trim: true }, deviceType: { type: String, enum: ["router", "switch", "firewall", "server", "access-point", "printer", "other"], default: "other" }, vendor: { type: String, default: "" }, model: { type: String, default: "" }, location: { type: String, default: "" }, description: { type: String, default: "" }, interfaces: { type: [interfaceSchema], default: [] }, monitoringEnabled: { type: Boolean, default: true }, pollingInterval: { type: Number, default: 30, min: 5 }, monitoringMethods: { type: [{ type: String, enum: ["icmp", "snmp", "http", "https"] }], default: ["icmp"] }, snmp: { type: snmpSchema, default: () => ({}) }, http: { enabled: { type: Boolean, default: false }, protocol: { type: String, enum: ["http", "https"], default: "http" }, port: { type: Number, default: 80, min: 1, max: 65535 }, path: { type: String, default: "/" } }, monitoredPorts: { type: [monitoredPortSchema], default: [] }, status: { type: String, enum: ["UP", "DOWN", "DEGRADED", "UNKNOWN"], default: "UNKNOWN" }, lastSeenAt: { type: Date, default: null }, lastPollAt: { type: Date, default: null }, lastStatusChangeAt: { type: Date, default: null }, activeIncidentId: { type: String, default: null }, lastError: { type: String, default: null }, monitoringResult: { ping: { reachable: { type: Boolean, default: false }, latency: { type: Number, default: null }, error: { type: String, default: null } }, snmp: { reachable: { type: Boolean, default: false }, skipped: { type: Boolean, default: false }, value: { type: mongoose.Schema.Types.Mixed, default: null }, error: { type: String, default: null } }, http: { enabled: { type: Boolean, default: false }, reachable: { type: Boolean, default: false }, statusCode: { type: Number, default: null }, responseTime: { type: Number, default: null }, error: { type: String, default: null } }, ports: { type: mongoose.Schema.Types.Mixed, default: {} } }
  }, { timestamps: true }
);

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
