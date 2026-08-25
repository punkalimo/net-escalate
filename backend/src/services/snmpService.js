import snmp from "net-snmp";

const DEFAULT_TIMEOUT = 5000;
const DEFAULT_RETRIES = 2;

function normaliseSnmpVersion(value) {
  const version = String(value ?? "2c").toLowerCase();
  if (["1", "v1"].includes(version)) return "1";
  if (["2", "2c", "v2c"].includes(version)) return "2c";
  if (["3", "v3"].includes(version)) return "3";
  throw new Error(`Unsupported SNMP version: ${value}`);
}

function authProtocol(value) {
  const protocol = String(value || "SHA").toUpperCase();
  if (protocol === "MD5") return snmp.AuthProtocols.md5;
  if (protocol === "SHA" || protocol === "SHA1") return snmp.AuthProtocols.sha;
  if (protocol === "SHA224") return snmp.AuthProtocols.sha224;
  if (protocol === "SHA256") return snmp.AuthProtocols.sha256;
  if (protocol === "SHA384") return snmp.AuthProtocols.sha384;
  if (protocol === "SHA512") return snmp.AuthProtocols.sha512;
  throw new Error(`Unsupported SNMP authentication protocol: ${value}`);
}

function privProtocol(value) {
  const protocol = String(value || "AES").toUpperCase();
  if (protocol === "DES") return snmp.PrivProtocols.des;
  if (protocol === "AES" || protocol === "AES128") return snmp.PrivProtocols.aes;
  if (protocol === "AES256B") return snmp.PrivProtocols.aes256b;
  if (protocol === "AES256R") return snmp.PrivProtocols.aes256r;
  throw new Error(`Unsupported SNMP privacy protocol: ${value}`);
}

function securityLevel(value) {
  const level = String(value || "noAuthNoPriv");
  const levels = snmp.SecurityLevel || {};
  if (!levels[level]) throw new Error(`Unsupported SNMPv3 security level: ${level}`);
  return levels[level];
}

function createCommonOptions(device) {
  const timeout = Math.max(1000, Number(device.snmp?.timeout || DEFAULT_TIMEOUT));
  const retries = Number.isInteger(device.snmp?.retries) ? Math.max(0, device.snmp.retries) : DEFAULT_RETRIES;
  return {
    timeout,
    retries,
    transport: "udp4",
    port: Number(device.snmp?.port || 161),
    backoff: 1.2
  };
}

function createSnmpSession(device) {
  if (!device) throw new Error("Device information is required.");
  if (!device.ipAddress) throw new Error("Device IP address is required.");

  const version = normaliseSnmpVersion(device.snmp?.version);
  const options = createCommonOptions(device);

  if (version === "1") {
    return snmp.createSession(device.ipAddress, device.snmp?.community || "public", {
      ...options, version: snmp.Version1
    });
  }

  if (version === "2c") {
    return snmp.createSession(device.ipAddress, device.snmp?.community || "public", {
      ...options, version: snmp.Version2c
    });
  }

  const username = String(device.snmp?.username || "").trim();
  if (!username) throw new Error("SNMPv3 username is required.");
  const levelName = device.snmp?.securityLevel || "noAuthNoPriv";
  const user = { name: username, level: securityLevel(levelName) };

  if (levelName === "authNoPriv" || levelName === "authPriv") {
    if (!device.snmp?.authKey) throw new Error("SNMPv3 authentication key is required.");
    user.authProtocol = authProtocol(device.snmp.authProtocol);
    user.authKey = String(device.snmp.authKey);
  }
  if (levelName === "authPriv") {
    if (!device.snmp?.privKey) throw new Error("SNMPv3 privacy key is required.");
    user.privProtocol = privProtocol(device.snmp.privProtocol);
    user.privKey = String(device.snmp.privKey);
  }

  return snmp.createV3Session(device.ipAddress, user, {
    ...options, context: String(device.snmp?.context || "")
  });
}

function safeClose(session) {
  if (!session || typeof session.close !== "function") return;
  try { session.close(); } catch (error) {
    if (error?.code !== "ERR_SOCKET_DGRAM_NOT_RUNNING") console.warn(`[SNMP] Session cleanup warning: ${error.message}`);
  }
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
      error ? reject(error) : resolve(value);
    };
    try {
      session.get([oid], (error, varbinds) => {
        if (error) return finish(error);
        const varbind = varbinds?.[0];
        if (!varbind || snmp.isVarbindError(varbind)) return finish(new Error("SNMP returned no usable sysName.0 response."));
        finish(null, { sysName: String(varbind.value), snmpVersion: normaliseSnmpVersion(device.snmp?.version) });
      });
    } catch (error) { finish(error); }
  });
}

const IF_OIDS = {
  speed: "1.3.6.1.2.1.2.2.1.5",
  adminStatus: "1.3.6.1.2.1.2.2.1.7",
  operStatus: "1.3.6.1.2.1.2.2.1.8",
  inOctets: "1.3.6.1.2.1.2.2.1.10",
  inDiscards: "1.3.6.1.2.1.2.2.1.13",
  inErrors: "1.3.6.1.2.1.2.2.1.14",
  outOctets: "1.3.6.1.2.1.2.2.1.16",
  outDiscards: "1.3.6.1.2.1.2.2.1.19",
  outErrors: "1.3.6.1.2.1.2.2.1.20",
  highSpeed: "1.3.6.1.2.1.31.1.1.1.15",
  ifName: "1.3.6.1.2.1.31.1.1.1.1",
  ifAlias: "1.3.6.1.2.1.31.1.1.1.18",
  duplex: "1.3.6.1.2.1.10.7.2.1.19"
};

function decodeDuplex(value) {
  const n = Number(value);
  if (n === 1) return "UNKNOWN";
  if (n === 2) return "HALF";
  if (n === 3) return "FULL";
  return "UNKNOWN";
}

function speedFromValues(highSpeed, speed) {
  const hs = Number(highSpeed), legacy = Number(speed);
  if (Number.isFinite(hs) && hs > 0) return hs;
  if (Number.isFinite(legacy) && legacy > 0 && legacy < 4294967295) return legacy / 1000000;
  return null;
}

function valueToString(value) {
  if (Buffer.isBuffer(value)) return value.toString("hex");
  return String(value ?? "");
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
      error ? reject(error) : resolve();
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
        case "2": item.ifDescr = valueToString(value); break;
        case "3": item.ifType = Number(value); break;
        case "4": item.ifMtu = Number(value); break;
        case "5": item.ifSpeed = Number(value); break;
        case "6": item.ifPhysAddress = valueToString(value); break;
        case "7": item.ifAdminStatus = Number(value); break;
        case "8": item.ifOperStatus = Number(value); break;
      }
    } else {
      switch (column) {
        case "1": item.ifName = valueToString(value); break;
        case "15": item.highSpeed = Number(value); break;
        case "18": item.ifAlias = valueToString(value); break;
      }
    }
    interfaces.set(index, item);
  };

  try {
    await walkSubtree(session, "1.3.6.1.2.1.2.2.1", v => consume(v, false));
    try { await walkSubtree(session, "1.3.6.1.2.1.31.1.1.1", v => consume(v, true)); }
    catch (error) { console.info(`[SNMP] Optional ifXTable unavailable on ${device.hostname || device.ipAddress}: ${error.message}`); }
    const result = [...interfaces.values()]
      .filter(item => Number.isInteger(item.ifIndex) && item.ifIndex > 0)
      .sort((a, b) => a.ifIndex - b.ifIndex)
      .map(item => ({ ...item, ifSpeedMbps: speedFromValues(item.highSpeed, item.ifSpeed), displayName: item.ifName || item.ifDescr || `Interface ${item.ifIndex}` }));
    safeClose(session);
    return result;
  } catch (error) { safeClose(session); throw error; }
}

export async function getInterfaceStatus(device, ifIndex) {
  const session = createSnmpSession(device);
  const adminOid = `${IF_OIDS.adminStatus}.${ifIndex}`, operOid = `${IF_OIDS.operStatus}.${ifIndex}`;
  return new Promise((resolve, reject) => {
    session.get([adminOid, operOid], (error, varbinds) => {
      safeClose(session);
      if (error) return reject(error);
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
  const oids = Object.fromEntries(Object.entries(IF_OIDS).filter(([key]) => !["ifName", "ifAlias"].includes(key)).map(([key, oid]) => [key, `${oid}.${ifIndex}`]));
  return new Promise((resolve, reject) => {
    session.get(Object.values(oids), (error, varbinds) => {
      safeClose(session);
      if (error) return reject(error);
      const values = {};
      for (const varbind of varbinds || []) {
        if (snmp.isVarbindError(varbind)) continue;
        const key = Object.keys(oids).find(name => oids[name] === varbind.oid);
        if (key) values[key] = Number(varbind.value);
      }
      const speedMbps = speedFromValues(values.highSpeed, values.speed);
      resolve({ ifIndex, speedMbps, speedSource: Number(values.highSpeed) > 0 ? "ifHighSpeed" : "ifSpeed", duplex: decodeDuplex(values.duplex), adminStatus: values.adminStatus ?? null, operStatus: values.operStatus ?? null, inOctets: values.inOctets ?? 0, outOctets: values.outOctets ?? 0, inErrors: values.inErrors ?? 0, outErrors: values.outErrors ?? 0, inDiscards: values.inDiscards ?? 0, outDiscards: values.outDiscards ?? 0, checkedAt: new Date() });
    });
  });
}

export default { testSnmpConnection, discoverInterfaces, getInterfaceStatus, getInterfaceMetrics };
