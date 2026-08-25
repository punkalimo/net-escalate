import snmp from "net-snmp";

function createSnmpSession(device) {
  if (!device) throw new Error("Device information is required.");
  if (!device.ipAddress) throw new Error("Device IP address is required.");

  const version = device.snmp?.version || "2c";
  const community = device.snmp?.community || "public";

  let session;

  if (version === "1" || version === 1) {
    session = snmp.createSession(device.ipAddress, community, {
      version: snmp.Version1, timeout: 5000, retries: 1
    });
  } else if (version === "2c" || version === 2 || version === "2") {
    session = snmp.createSession(device.ipAddress, community, {
      version: snmp.Version2c, timeout: 5000, retries: 1
    });
  } else {
    throw new Error(`Unsupported SNMP version: ${version}`);
  }

  return session;
}

export async function testSnmpConnection(device) {
  const session = createSnmpSession(device);
  const oids = [
    "1.3.6.1.2.1.1.1.0", "1.3.6.1.2.1.1.3.0", "1.3.6.1.2.1.1.4.0",
    "1.3.6.1.2.1.1.5.0", "1.3.6.1.2.1.1.6.0"
  ];

  return new Promise((resolve, reject) => {
    session.get(oids, (error, varbinds) => {
      session.close();
      if (error) return reject(error);
      const information = {};
      for (const varbind of varbinds) {
        if (snmp.isVarbindError(varbind)) continue;
        switch (varbind.oid) {
          case "1.3.6.1.2.1.1.1.0": information.sysDescr = String(varbind.value); break;
          case "1.3.6.1.2.1.1.3.0": information.sysUpTime = String(varbind.value); break;
          case "1.3.6.1.2.1.1.4.0": information.sysContact = String(varbind.value); break;
          case "1.3.6.1.2.1.1.5.0": information.sysName = String(varbind.value); break;
          case "1.3.6.1.2.1.1.6.0": information.sysLocation = String(varbind.value); break;
        }
      }
      resolve(information);
    });
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
  const hs = Number(highSpeed);
  const legacy = Number(speed);
  if (Number.isFinite(hs) && hs > 0) return hs;
  if (Number.isFinite(legacy) && legacy > 0 && legacy < 4294967295) return legacy / 1000000;
  return null;
}

export async function discoverInterfaces(device) {
  const session = createSnmpSession(device);
  const tableOid = "1.3.6.1.2.1.2.2.1";

  return new Promise((resolve, reject) => {
    session.subtree(tableOid, 20, varbinds => {
      const interfaces = {};
      for (const varbind of varbinds) {
        if (snmp.isVarbindError(varbind)) continue;
        const parts = varbind.oid.split(".");
        const column = parts[parts.length - 2];
        const index = parts[parts.length - 1];
        if (!interfaces[index]) {
          interfaces[index] = {
            ifIndex: Number(index), ifDescr: null, ifType: null, ifMtu: null,
            ifSpeed: null, ifPhysAddress: null, ifAdminStatus: null, ifOperStatus: null
          };
        }
        const value = varbind.value;
        switch (column) {
          case "1": interfaces[index].ifIndex = Number(value); break;
          case "2": interfaces[index].ifDescr = String(value); break;
          case "3": interfaces[index].ifType = Number(value); break;
          case "4": interfaces[index].ifMtu = Number(value); break;
          case "5": interfaces[index].ifSpeed = Number(value); break;
          case "6": interfaces[index].ifPhysAddress = Buffer.isBuffer(value) ? value.toString("hex") : String(value); break;
          case "7": interfaces[index].ifAdminStatus = Number(value); break;
          case "8": interfaces[index].ifOperStatus = Number(value); break;
        }
      }
      resolve(Object.values(interfaces));
    }, error => reject(error));
  });
}

export async function getInterfaceStatus(device, ifIndex) {
  const session = createSnmpSession(device);
  const adminOid = `${IF_OIDS.adminStatus}.${ifIndex}`;
  const operOid = `${IF_OIDS.operStatus}.${ifIndex}`;

  return new Promise((resolve, reject) => {
    session.get([adminOid, operOid], (error, varbinds) => {
      session.close();
      if (error) return reject(error);
      let adminStatus = null;
      let operStatus = null;
      for (const varbind of varbinds) {
        if (snmp.isVarbindError(varbind)) continue;
        if (varbind.oid === adminOid) adminStatus = Number(varbind.value);
        if (varbind.oid === operOid) operStatus = Number(varbind.value);
      }
      resolve({
        ifIndex, adminStatus, operStatus,
        adminState: adminStatus === 1 ? "UP" : adminStatus === 2 ? "DOWN" : "UNKNOWN",
        operState: operStatus === 1 ? "UP" : operStatus === 2 ? "DOWN" : "UNKNOWN"
      });
    });
  });
}

export async function getInterfaceMetrics(device, ifIndex) {
  const session = createSnmpSession(device);
  const oids = Object.fromEntries(
    Object.entries(IF_OIDS).map(([key, oid]) => [key, `${oid}.${ifIndex}`])
  );

  return new Promise((resolve, reject) => {
    session.get(Object.values(oids), (error, varbinds) => {
      session.close();
      if (error) return reject(error);

      const values = {};
      for (const varbind of varbinds) {
        if (snmp.isVarbindError(varbind)) continue;
        const key = Object.keys(oids).find(name => oids[name] === varbind.oid);
        if (key) values[key] = Number(varbind.value);
      }

      const speedMbps = speedFromValues(values.highSpeed, values.speed);
      resolve({
        ifIndex,
        speedMbps,
        speedSource: Number(values.highSpeed) > 0 ? "ifHighSpeed" : "ifSpeed",
        duplex: decodeDuplex(values.duplex),
        adminStatus: values.adminStatus ?? null,
        operStatus: values.operStatus ?? null,
        inOctets: values.inOctets ?? 0,
        outOctets: values.outOctets ?? 0,
        inErrors: values.inErrors ?? 0,
        outErrors: values.outErrors ?? 0,
        inDiscards: values.inDiscards ?? 0,
        outDiscards: values.outDiscards ?? 0,
        checkedAt: new Date()
      });
    });
  });
}

export default { testSnmpConnection, discoverInterfaces, getInterfaceStatus, getInterfaceMetrics };
