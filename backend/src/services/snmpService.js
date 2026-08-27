import snmp from "net-snmp";

const DEFAULT_TIMEOUT = 5000;
const DEFAULT_RETRIES = 2;

export function normaliseSnmpVersion(value) {
  const version = String(value ?? "2c").trim().toLowerCase();
  if (["1", "v1"].includes(version)) return "1";
  if (["2", "2c", "v2c"].includes(version)) return "2c";
  if (["3", "v3"].includes(version)) return "3";
  throw new Error(`Unsupported SNMP version: ${value}`);
}

function cleanCredential(value, fallback = "") {
  return String(value ?? fallback).trim();
}

function authProtocol(value) {
  const protocol = cleanCredential(value, "SHA").toUpperCase();
  if (protocol === "MD5") return snmp.AuthProtocols.md5;
  if (protocol === "SHA" || protocol === "SHA1") return snmp.AuthProtocols.sha;
  if (protocol === "SHA224") return snmp.AuthProtocols.sha224;
  if (protocol === "SHA256") return snmp.AuthProtocols.sha256;
  if (protocol === "SHA384") return snmp.AuthProtocols.sha384;
  if (protocol === "SHA512") return snmp.AuthProtocols.sha512;
  throw new Error(`Unsupported SNMP authentication protocol: ${value}`);
}

function privProtocol(value) {
  const protocol = cleanCredential(value, "AES").toUpperCase();
  if (protocol === "DES") return snmp.PrivProtocols.des;
  if (protocol === "AES" || protocol === "AES128") return snmp.PrivProtocols.aes;
  if (protocol === "AES256B") return snmp.PrivProtocols.aes256b;
  if (protocol === "AES256R") return snmp.PrivProtocols.aes256r;
  throw new Error(`Unsupported SNMP privacy protocol: ${value}`);
}

function securityLevel(value) {
  const level = cleanCredential(value, "noAuthNoPriv");
  const levels = snmp.SecurityLevel || {};
  if (!levels[level]) throw new Error(`Unsupported SNMPv3 security level: ${level}`);
  return levels[level];
}

function createCommonOptions(device) {
  const timeout = Math.max(1000, Number(device.snmp?.timeout || DEFAULT_TIMEOUT));
  const retries = Number.isInteger(device.snmp?.retries) ? Math.max(0, device.snmp.retries) : DEFAULT_RETRIES;
  return { timeout, retries, transport: "udp4", port: Number(device.snmp?.port || 161), backoff: 1.2 };
}

function createSnmpSession(device) {
  if (!device) throw new Error("Device information is required.");
  if (!device.ipAddress) throw new Error("Device IP address is required.");

  const version = normaliseSnmpVersion(device.snmp?.version);
  const options = createCommonOptions(device);
  const community = cleanCredential(device.snmp?.community, "public") || "public";

  if (version === "1") return snmp.createSession(String(device.ipAddress).trim(), community, { ...options, version: snmp.Version1 });
  if (version === "2c") return snmp.createSession(String(device.ipAddress).trim(), community, { ...options, version: snmp.Version2c });

  const username = cleanCredential(device.snmp?.username);
  if (!username) throw new Error("SNMPv3 username is required.");
  const levelName = cleanCredential(device.snmp?.securityLevel, "noAuthNoPriv") || "noAuthNoPriv";
  const user = { name: username, level: securityLevel(levelName) };

  if (levelName === "authNoPriv" || levelName === "authPriv") {
    const authKey = cleanCredential(device.snmp?.authKey);
    if (!authKey) throw new Error("SNMPv3 authentication key is required.");
    user.authProtocol = authProtocol(device.snmp.authProtocol);
    user.authKey = authKey;
  }
  if (levelName === "authPriv") {
    const privKey = cleanCredential(device.snmp?.privKey);
    if (!privKey) throw new Error("SNMPv3 privacy key is required.");
    user.privProtocol = privProtocol(device.snmp.privProtocol);
    user.privKey = privKey;
  }

  return snmp.createV3Session(String(device.ipAddress).trim(), user, { ...options, context: cleanCredential(device.snmp?.context) });
}

function safeClose(session) {
  if (!session || typeof session.close !== "function") return;
  try { session.close(); } catch (error) {
    if (error?.code !== "ERR_SOCKET_DGRAM_NOT_RUNNING") console.warn(`[SNMP] Session cleanup warning: ${error.message}`);
  }
}

function normaliseSnmpError(error) {
  if (!error) return null;
  const message = String(error.message || error);
  const lower = message.toLowerCase();
  if (lower.includes("timeout") || lower.includes("timed out")) return new Error("SNMP request timed out. Verify UDP/161 reachability, SNMP is enabled, and the configured credentials are correct.");
  if (lower.includes("authorization") || lower.includes("authentication") || lower.includes("community")) return new Error("SNMP authentication/authorization failed. Verify the SNMP version and credentials.");
  if (error.code === "EHOSTUNREACH" || error.code === "ENETUNREACH") return new Error(`SNMP network unreachable (${error.code}). Verify routing and firewall rules to UDP/161.`);
  return error instanceof Error ? error : new Error(message);
}

export async function testSnmpConnection(device) {
  const session = createSnmpSession(device);
  const oid = "1.3.6.1.2.1.1.5.0";
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      safeClose(session);
      error ? reject(normaliseSnmpError(error)) : resolve(value);
    };
    try {
      session.get([oid], (error, varbinds) => {
        if (error) return finish(error);
        const varbind = varbinds?.[0];
        if (!varbind) return finish(new Error("SNMP returned no varbind for sysName.0."));
        if (snmp.isVarbindError(varbind)) return finish(new Error(`SNMP varbind error for ${oid}: ${snmp.varbindError(varbind)}`));
        finish(null, { sysName: decodeSnmpText(varbind.value), snmpVersion: normaliseSnmpVersion(device.snmp?.version), communityNormalized: normaliseSnmpVersion(device.snmp?.version) !== "3" });
      });
    } catch (error) { finish(error); }
  });
}

const IF_OIDS = {
  speed: "1.3.6.1.2.1.2.2.1.5", adminStatus: "1.3.6.1.2.1.2.2.1.7", operStatus: "1.3.6.1.2.1.2.2.1.8", inOctets: "1.3.6.1.2.1.2.2.1.10", inDiscards: "1.3.6.1.2.1.2.2.1.13", inErrors: "1.3.6.1.2.1.2.2.1.14", outOctets: "1.3.6.1.2.1.2.2.1.16", outDiscards: "1.3.6.1.2.1.2.2.1.19", outErrors: "1.3.6.1.2.1.2.2.1.20", highSpeed: "1.3.6.1.2.1.31.1.1.1.15", ifName: "1.3.6.1.2.1.31.1.1.1.1", ifAlias: "1.3.6.1.2.1.31.1.1.1.18", duplex: "1.3.6.1.2.1.10.7.2.1.19", hcInOctets: "1.3.6.1.2.1.31.1.1.1.6", hcOutOctets: "1.3.6.1.2.1.31.1.1.1.10"
};

// SNMPv1 has no per-varbind exception values: a single unsupported OID (the
// HC/64-bit counters don't exist pre-v2c) fails the whole GET, not just that
// varbind. Never request them over v1.
const V1_UNSUPPORTED_OIDS = new Set(["hcInOctets", "hcOutOctets"]);

// net-snmp returns Counter64 varbinds as a raw big-endian byte Buffer, not a
// JS number - Number(buffer) silently produces NaN. Decode it by hand; the
// result is only converted back to a plain Number (safe up to 2^53, i.e.
// ~9 petabytes of octets - far beyond any realistic counter lifetime here)
// so it stays a normal Mongoose Number field like everything else.
export function decodeCounter64(value) {
  if (!Buffer.isBuffer(value)) {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  let big = 0n;
  for (const byte of value) big = (big << 8n) | BigInt(byte);
  return Number(big);
}

export function decodeDuplex(value) {
  const n = Number(value);
  if (n === 1) return "UNKNOWN";
  if (n === 2) return "HALF";
  if (n === 3) return "FULL";
  return "UNKNOWN";
}

export function speedFromValues(highSpeed, speed) {
  const hs = Number(highSpeed), legacy = Number(speed);
  if (Number.isFinite(hs) && hs > 0) return hs;
  if (Number.isFinite(legacy) && legacy > 0 && legacy < 4294967295) return legacy / 1000000;
  return null;
}

function isPrintableText(text) {
  return /^[\x09\x0A\x0D\x20-\x7E]*$/.test(text);
}

export function decodeSnmpText(value) {
  if (Buffer.isBuffer(value)) {
    const text = value.toString("utf8").replace(/\0+$/g, "");
    return isPrintableText(text) ? text.trim() : value.toString("hex");
  }
  return String(value ?? "").trim();
}

export function decodeSnmpBinary(value) {
  return Buffer.isBuffer(value) ? value.toString("hex") : String(value ?? "").trim();
}

function interfaceRecord(index) {
  return { ifIndex: Number(index), ifDescr: null, ifName: null, ifAlias: null, ifType: null, ifMtu: null, ifSpeed: null, ifPhysAddress: null, ifAdminStatus: null, ifOperStatus: null, highSpeed: null };
}

function walkSubtree(session, oid, onVarbind) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = error => {
      if (settled) return;
      settled = true;
      error ? reject(normaliseSnmpError(error)) : resolve();
    };
    try {
      session.subtree(oid, 20, varbinds => {
        for (const varbind of varbinds || []) if (!snmp.isVarbindError(varbind)) onVarbind(varbind);
      }, finish);
    } catch (error) { finish(error); }
  });
}

export async function discoverInterfaces(device) {
  const session = createSnmpSession(device);
  const interfaces = new Map();
  const consume = (varbind, extended = false) => {
    const parts = varbind.oid.split("."), column = parts[parts.length - 2], index = parts[parts.length - 1];
    const item = interfaces.get(index) || interfaceRecord(index), value = varbind.value;
    if (!extended) {
      switch (column) {
        case "1": item.ifIndex = Number(value); break;
        case "2": item.ifDescr = decodeSnmpText(value); break;
        case "3": item.ifType = Number(value); break;
        case "4": item.ifMtu = Number(value); break;
        case "5": item.ifSpeed = Number(value); break;
        case "6": item.ifPhysAddress = decodeSnmpBinary(value); break;
        case "7": item.ifAdminStatus = Number(value); break;
        case "8": item.ifOperStatus = Number(value); break;
      }
    } else {
      switch (column) {
        case "1": item.ifName = decodeSnmpText(value); break;
        case "15": item.highSpeed = Number(value); break;
        case "18": item.ifAlias = decodeSnmpText(value); break;
      }
    }
    interfaces.set(index, item);
  };

  try {
    await walkSubtree(session, "1.3.6.1.2.1.2.2.1", v => consume(v, false));
    try {
      await walkSubtree(session, "1.3.6.1.2.1.31.1.1.1", v => consume(v, true));
    } catch (error) {
      console.info(`[SNMP] Optional ifXTable unavailable on ${device.hostname || device.ipAddress}: ${error.message}`);
    }
    // Duplex (EtherLike-MIB dot3StatsDuplexStatus) isn't part of ifEntry/
    // ifXTable, but it changes on the same rare, config-driven cadence as
    // admin status - fetched here, once per discovery/admin-sync cycle, and
    // cached, rather than re-walked on every fast poll.
    try {
      await walkSubtree(session, IF_OIDS.duplex, v => {
        const parts = v.oid.split(".");
        const index = parts[parts.length - 1];
        const item = interfaces.get(index) || interfaceRecord(index);
        item.duplexRaw = Number(v.value);
        interfaces.set(index, item);
      });
    } catch (error) {
      console.info(`[SNMP] Optional duplex status unavailable on ${device.hostname || device.ipAddress}: ${error.message}`);
    }
    const result = [...interfaces.values()]
      .filter(item => Number.isInteger(item.ifIndex) && item.ifIndex > 0)
      .sort((a, b) => a.ifIndex - b.ifIndex)
      .map(item => ({ ...item, ifSpeedMbps: speedFromValues(item.highSpeed, item.ifSpeed), duplex: decodeDuplex(item.duplexRaw), displayName: item.ifName || item.ifDescr || `Interface ${item.ifIndex}` }));
    safeClose(session);
    return result;
  } catch (error) {
    safeClose(session);
    throw normaliseSnmpError(error);
  }
}

// Fast-cycle poll data for every interface on a device, in as few SNMP
// round trips as possible regardless of interface count - the scaling
// requirement for polling beyond a handful of devices.
//
// ifOperStatus and the octet/error/discard counters all live in the same
// ifEntry table (1.3.6.1.2.1.2.2.1), so ONE subtree walk of that base OID
// returns every interface's row in a handful of GETBULK round trips total,
// not one GET per interface. net-snmp's walk API only walks one base OID at
// a time, so this - rather than a separate walk per column - is what
// actually minimises round trips: splitting into six column-only walks
// would mean six separate multi-round-trip walks instead of one.
//
// ifAdminStatus IS present in this same walk response, but it is
// deliberately ignored here: admin status is synced on its own slow cadence
// (see discoverInterfaces, used for that sync) and alerting decisions use
// that cached value, not whatever this fast walk happens to also carry back
// - the cadence separation is a behavioural guarantee (a transient blip on
// this one column can't flip an alerting decision), not just a bandwidth
// optimisation.
//
// HC (64-bit) octet counters live in ifXTable and aren't part of ifEntry,
// so on SNMPv2c/v3 two further targeted walks fetch just those two columns.
// Total per fast poll: 1 walk on SNMPv1, 3 walks on v2c/v3 - independent of
// how many interfaces the device has.
export async function bulkGetInterfaceOperationalTable(device) {
  const session = createSnmpSession(device);
  const version = normaliseSnmpVersion(device.snmp?.version);
  const useHc = version !== "1";
  const rows = new Map();

  const row = ifIndex => {
    if (!rows.has(ifIndex)) rows.set(ifIndex, { ifIndex });
    return rows.get(ifIndex);
  };

  const consumeIfEntry = varbind => {
    const parts = varbind.oid.split(".");
    const column = parts[parts.length - 2];
    const ifIndex = Number(parts[parts.length - 1]);
    if (!Number.isInteger(ifIndex) || ifIndex <= 0) return;
    const value = varbind.value;
    switch (column) {
      case "8": row(ifIndex).operStatus = Number(value); break;
      case "10": row(ifIndex).inOctets = Number(value); break;
      case "13": row(ifIndex).inDiscards = Number(value); break;
      case "14": row(ifIndex).inErrors = Number(value); break;
      case "16": row(ifIndex).outOctets = Number(value); break;
      case "19": row(ifIndex).outDiscards = Number(value); break;
      case "20": row(ifIndex).outErrors = Number(value); break;
    }
  };

  const consumeHcColumn = (varbind, key) => {
    const parts = varbind.oid.split(".");
    const ifIndex = Number(parts[parts.length - 1]);
    if (!Number.isInteger(ifIndex) || ifIndex <= 0) return;
    row(ifIndex)[key] = decodeCounter64(varbind.value);
  };

  try {
    await walkSubtree(session, "1.3.6.1.2.1.2.2.1", consumeIfEntry);

    if (useHc) {
      try {
        await walkSubtree(session, IF_OIDS.hcInOctets, v => consumeHcColumn(v, "hcInOctets"));
        await walkSubtree(session, IF_OIDS.hcOutOctets, v => consumeHcColumn(v, "hcOutOctets"));
      } catch (error) {
        console.info(`[SNMP] HC counters unavailable on ${device.hostname || device.ipAddress}, falling back to 32-bit: ${error.message}`);
      }
    }

    safeClose(session);
  } catch (error) {
    safeClose(session);
    throw normaliseSnmpError(error);
  }

  const result = new Map();
  for (const [ifIndex, values] of rows) {
    const hcAvailable = Number.isFinite(values.hcInOctets) && Number.isFinite(values.hcOutOctets);
    const inOctets = hcAvailable ? values.hcInOctets : (values.inOctets ?? 0);
    const outOctets = hcAvailable ? values.hcOutOctets : (values.outOctets ?? 0);
    result.set(ifIndex, {
      ifIndex,
      operStatus: values.operStatus ?? null,
      inOctets,
      outOctets,
      octetSource: hcAvailable ? "HC" : "legacy",
      inErrors: values.inErrors ?? 0,
      outErrors: values.outErrors ?? 0,
      inDiscards: values.inDiscards ?? 0,
      outDiscards: values.outDiscards ?? 0,
      checkedAt: new Date()
    });
  }
  return result;
}

export async function getInterfaceStatus(device, ifIndex) {
  const session = createSnmpSession(device);
  const adminOid = `${IF_OIDS.adminStatus}.${ifIndex}`, operOid = `${IF_OIDS.operStatus}.${ifIndex}`;
  return new Promise((resolve, reject) => {
    session.get([adminOid, operOid], (error, varbinds) => {
      safeClose(session);
      if (error) return reject(normaliseSnmpError(error));
      let adminStatus = null, operStatus = null;
      for (const varbind of varbinds || []) {
        if (snmp.isVarbindError(varbind)) continue;
        if (varbind.oid === adminOid) adminStatus = Number(varbind.value);
        if (varbind.oid === operOid) operStatus = Number(varbind.value);
      }
      resolve({ ifIndex, adminStatus, operStatus, adminState: adminStatus === 1 ? "UP" : adminStatus === 2 ? "DOWN" : "UNKNOWN", operState: operStatus === 1 ? "UP" : operStatus === 2 ? "DOWN" : "UNKNOWN" });
    });
  });
}

export async function getInterfaceMetrics(device, ifIndex) {
  const session = createSnmpSession(device);
  const version = normaliseSnmpVersion(device.snmp?.version);
  const skipKeys = new Set(["ifName", "ifAlias"]);
  if (version === "1") for (const key of V1_UNSUPPORTED_OIDS) skipKeys.add(key);
  const oids = Object.fromEntries(Object.entries(IF_OIDS).filter(([key]) => !skipKeys.has(key)).map(([key, oid]) => [key, `${oid}.${ifIndex}`]));
  return new Promise((resolve, reject) => {
    session.get(Object.values(oids), (error, varbinds) => {
      safeClose(session);
      if (error) return reject(normaliseSnmpError(error));
      const values = {};
      for (const varbind of varbinds || []) {
        if (snmp.isVarbindError(varbind)) continue;
        const key = Object.keys(oids).find(name => oids[name] === varbind.oid);
        if (!key) continue;
        values[key] = key === "hcInOctets" || key === "hcOutOctets" ? decodeCounter64(varbind.value) : Number(varbind.value);
      }
      const speedMbps = speedFromValues(values.highSpeed, values.speed);
      const hcAvailable = Number.isFinite(values.hcInOctets) && Number.isFinite(values.hcOutOctets);
      const inOctets = hcAvailable ? values.hcInOctets : (values.inOctets ?? 0);
      const outOctets = hcAvailable ? values.hcOutOctets : (values.outOctets ?? 0);
      resolve({ ifIndex, speedMbps, speedSource: Number(values.highSpeed) > 0 ? "ifHighSpeed" : "ifSpeed", duplex: decodeDuplex(values.duplex), adminStatus: values.adminStatus ?? null, operStatus: values.operStatus ?? null, inOctets, outOctets, octetSource: hcAvailable ? "HC" : "legacy", inErrors: values.inErrors ?? 0, outErrors: values.outErrors ?? 0, inDiscards: values.inDiscards ?? 0, outDiscards: values.outDiscards ?? 0, checkedAt: new Date() });
    });
  });
}

// CISCO-PROCESS-MIB cpmCPUTotal5minRev - CPU utilization averaged over the
// last 5 minutes, as a corrected 0-100 percentage (the older
// cpmCPUTotal5min column saturates and is unreliable above 100% loads on
// some platforms; the "Rev" column is the documented replacement).
const CISCO_CPU_5MIN_REV_OID = "1.3.6.1.4.1.9.9.109.1.1.1.1.8";

// CISCO-MEMORY-POOL-MIB ciscoMemoryPoolTable columns: name, bytes used,
// bytes free. Indexed per memory pool (Processor, I/O, etc.) - walked in
// full since pool indices aren't predictable ahead of time, same reasoning
// as the interface table walks above.
const CISCO_MEM_POOL_NAME_OID = "1.3.6.1.4.1.9.9.48.1.1.1.2";
const CISCO_MEM_POOL_USED_OID = "1.3.6.1.4.1.9.9.48.1.1.1.5";
const CISCO_MEM_POOL_FREE_OID = "1.3.6.1.4.1.9.9.48.1.1.1.6";

function lastOidSegment(oid) {
  const parts = oid.split(".");
  return parts[parts.length - 1];
}

// Device-level CPU/memory poll, using the same bulk-walk-per-table approach
// as interface polling: a small fixed number of GETBULK walks regardless of
// how many CPU cores or memory pools the device reports. Both MIBs are
// Cisco-proprietary; a device that doesn't support them (or isn't Cisco)
// simply comes back with null values for that metric rather than failing
// the whole poll - CPU/memory monitoring is additive, not a prerequisite
// for interface/device monitoring to keep working.
export async function getDeviceSystemMetrics(device) {
  const session = createSnmpSession(device);
  const cpuRows = new Map();
  const poolRows = new Map();

  const poolRow = index => {
    if (!poolRows.has(index)) poolRows.set(index, { index });
    return poolRows.get(index);
  };

  try {
    await walkSubtree(session, CISCO_CPU_5MIN_REV_OID, varbind => {
      cpuRows.set(lastOidSegment(varbind.oid), Number(varbind.value));
    });
  } catch (error) {
    console.info(`[SNMP] CISCO-PROCESS-MIB unavailable on ${device.hostname || device.ipAddress}: ${error.message}`);
  }

  try {
    await walkSubtree(session, CISCO_MEM_POOL_NAME_OID, varbind => { poolRow(lastOidSegment(varbind.oid)).name = decodeSnmpText(varbind.value); });
    await walkSubtree(session, CISCO_MEM_POOL_USED_OID, varbind => { poolRow(lastOidSegment(varbind.oid)).used = Number(varbind.value); });
    await walkSubtree(session, CISCO_MEM_POOL_FREE_OID, varbind => { poolRow(lastOidSegment(varbind.oid)).free = Number(varbind.value); });
  } catch (error) {
    console.info(`[SNMP] CISCO-MEMORY-POOL-MIB unavailable on ${device.hostname || device.ipAddress}: ${error.message}`);
  }

  safeClose(session);

  const cpuValues = [...cpuRows.values()].filter(value => Number.isFinite(value));
  // Multiple cores report as separate rows; the busiest core is what
  // actually matters for "is this device under CPU pressure," not the mean.
  const cpuPercent = cpuValues.length ? Math.max(...cpuValues) : null;

  const pools = [...poolRows.values()].filter(row => Number.isFinite(row.used) && Number.isFinite(row.free));
  const primaryPool = pools.find(row => /processor/i.test(row.name || "")) || pools[0] || null;
  const memoryUsedBytes = primaryPool ? primaryPool.used : null;
  const memoryFreeBytes = primaryPool ? primaryPool.free : null;
  const memoryTotalBytes = primaryPool ? primaryPool.used + primaryPool.free : null;
  const memoryUtilizationPercent = memoryTotalBytes ? (memoryUsedBytes / memoryTotalBytes) * 100 : null;

  return {
    cpuPercent,
    memoryPoolName: primaryPool?.name || null,
    memoryUsedBytes,
    memoryFreeBytes,
    memoryUtilizationPercent,
    checkedAt: new Date()
  };
}

export default { testSnmpConnection, discoverInterfaces, bulkGetInterfaceOperationalTable, getInterfaceStatus, getInterfaceMetrics, getDeviceSystemMetrics, decodeSnmpText, decodeSnmpBinary, decodeDuplex, decodeCounter64, speedFromValues, normaliseSnmpVersion };
