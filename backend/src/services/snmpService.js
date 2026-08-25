import snmp from "net-snmp";

function createSnmpSession(device) {
  if (!device) throw new Error("Device information is required.");
  if (!device.ipAddress) throw new Error("Device IP address is required.");

  const version = device.snmp?.version || "2c";
  const community = device.snmp?.community || "public";

  console.log("========================================");
  console.log("Creating SNMP session");
  console.log("Host:", device.ipAddress);
  console.log("Version:", version);
  console.log("Community:", community);
  console.log("========================================");

  let session;

  if (version === "1" || version === 1) {
    session = snmp.createSession(device.ipAddress, community, {
      version: snmp.Version1,
      timeout: 5000,
      retries: 1
    });
  } else if (version === "2c" || version === 2 || version === "2") {
    session = snmp.createSession(device.ipAddress, community, {
      version: snmp.Version2c,
      timeout: 5000,
      retries: 1
    });
  } else {
    throw new Error(`Unsupported SNMP version: ${version}`);
  }

  return session;
}

export async function testSnmpConnection(device) {
  const session = createSnmpSession(device);
  const oids = [
    "1.3.6.1.2.1.1.1.0",
    "1.3.6.1.2.1.1.3.0",
    "1.3.6.1.2.1.1.4.0",
    "1.3.6.1.2.1.1.5.0",
    "1.3.6.1.2.1.1.6.0"
  ];

  return new Promise((resolve, reject) => {
    session.get(oids, (error, varbinds) => {
      session.close();

      if (error) return reject(error);

      const information = {};
      for (const varbind of varbinds) {
        if (snmp.isVarbindError(varbind)) continue;

        switch (varbind.oid) {
          case "1.3.6.1.2.1.1.1.0":
            information.sysDescr = String(varbind.value);
            break;
          case "1.3.6.1.2.1.1.3.0":
            information.sysUpTime = String(varbind.value);
            break;
          case "1.3.6.1.2.1.1.4.0":
            information.sysContact = String(varbind.value);
            break;
          case "1.3.6.1.2.1.1.5.0":
            information.sysName = String(varbind.value);
            break;
          case "1.3.6.1.2.1.1.6.0":
            information.sysLocation = String(varbind.value);
            break;
        }
      }

      resolve(information);
    });
  });
}

const IF_OIDS = {
  index: "1.3.6.1.2.1.2.2.1.1",
  description: "1.3.6.1.2.1.2.2.1.2",
  type: "1.3.6.1.2.1.2.2.1.3",
  mtu: "1.3.6.1.2.1.2.2.1.4",
  speed: "1.3.6.1.2.1.2.2.1.5",
  mac: "1.3.6.1.2.1.2.2.1.6",
  adminStatus: "1.3.6.1.2.1.2.2.1.7",
  operStatus: "1.3.6.1.2.1.2.2.1.8"
};

export async function discoverInterfaces(device) {
  const session = createSnmpSession(device);
  const tableOid = "1.3.6.1.2.1.2.2.1";

  return new Promise((resolve, reject) => {
    session.subtree(
      tableOid,
      20,
      varbinds => {
        const interfaces = {};

        for (const varbind of varbinds) {
          if (snmp.isVarbindError(varbind)) continue;

          const parts = varbind.oid.split(".");
          const column = parts[parts.length - 2];
          const index = parts[parts.length - 1];

          if (!interfaces[index]) {
            interfaces[index] = {
              ifIndex: Number(index),
              ifDescr: null,
              ifType: null,
              ifMtu: null,
              ifSpeed: null,
              ifPhysAddress: null,
              ifAdminStatus: null,
              ifOperStatus: null
            };
          }

          const value = varbind.value;

          switch (column) {
            case "1":
              interfaces[index].ifIndex = Number(value);
              break;
            case "2":
              interfaces[index].ifDescr = String(value);
              break;
            case "3":
              interfaces[index].ifType = Number(value);
              break;
            case "4":
              interfaces[index].ifMtu = Number(value);
              break;
            case "5":
              interfaces[index].ifSpeed = Number(value);
              break;
            case "6":
              interfaces[index].ifPhysAddress = Buffer.isBuffer(value)
                ? value.toString("hex")
                : String(value);
              break;
            case "7":
              interfaces[index].ifAdminStatus = Number(value);
              break;
            case "8":
              interfaces[index].ifOperStatus = Number(value);
              break;
          }
        }

        // net-snmp completes the subtree walk itself. Do not call
        // session.close() here: the socket may already be closed,
        // which causes ERR_SOCKET_DGRAM_NOT_RUNNING on Node.js 22.
        resolve(Object.values(interfaces));
      },
      error => {
        // The walk owns the session lifecycle; simply propagate errors.
        reject(error);
      }
    );
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
        ifIndex,
        adminStatus,
        operStatus,
        adminState: adminStatus === 1 ? "UP" : adminStatus === 2 ? "DOWN" : "UNKNOWN",
        operState: operStatus === 1 ? "UP" : operStatus === 2 ? "DOWN" : "UNKNOWN"
      });
    });
  });
}

export default {
  testSnmpConnection,
  discoverInterfaces,
  getInterfaceStatus
};
