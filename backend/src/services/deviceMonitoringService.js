import net from "net";
import http from "http";
import https from "https";
import { exec } from "child_process";
import { promisify } from "util";

import Device from "../models/Device.js";
import Incident from "../models/Incident.js";
import Technician from "../models/Technician.js";

import { processIncident } from "./incidentService.js";
import { computeWeightedSeverity } from "./severityService.js";

const execAsync = promisify(exec);

const monitoringTimers = new Map();

let monitoringIo = null;

export function setMonitoringSocket(io) {
    monitoringIo = io;

    console.log(
        "Device monitoring Socket.IO instance registered."
    );
}

function emitMonitoringEvent(event, data) {
    if (!monitoringIo) {
        return;
    }

    try {
        monitoringIo.emit(
            event,
            data
        );
    } catch (error) {
        console.error(
            "Socket.IO monitoring event error:",
            error
        );
    }
}

async function pingDevice(ipAddress) {
    if (!ipAddress) {
        return {
            reachable: false,
            latency: null,
            error: "No IP address configured."
        };
    }

    const validHostPattern =
        /^[a-zA-Z0-9.-]+$/;

    if (!validHostPattern.test(ipAddress)) {
        return {
            reachable: false,
            latency: null,
            error: "Invalid IP address or hostname."
        };
    }

    try {
        const start = Date.now();

        await execAsync(
            `ping -c 1 -W 2 ${ipAddress}`
        );

        const latency =
            Date.now() - start;

        return {
            reachable: true,
            latency,
            error: null
        };
    } catch (error) {
        return {
            reachable: false,
            latency: null,
            error: "Ping failed."
        };
    }
}

function checkTcpPort(
    host,
    port,
    timeout = 3000
) {
    return new Promise((resolve) => {
        const socket =
            new net.Socket();

        let finished = false;

        function finish(result) {
            if (finished) {
                return;
            }

            finished = true;

            try {
                socket.destroy();
            } catch (_) {
            }

            resolve(result);
        }

        socket.setTimeout(
            timeout
        );

        socket.once(
            "connect",
            () => {
                finish({
                    reachable: true,
                    state: "OPEN",
                    error: null,
                    message:
                        `TCP port ${port} is open.`
                });
            }
        );

        socket.once(
            "timeout",
            () => {
                finish({
                    reachable: false,
                    state: "TIMEOUT",
                    error:
                        "Connection timed out.",
                    message:
                        `TCP port ${port} timed out.`
                });
            }
        );

        socket.once(
            "error",
            (error) => {
                if (
                    error.code ===
                    "ECONNREFUSED"
                ) {
                    finish({
                        reachable: false,
                        state: "CLOSED",
                        error:
                            error.message,
                        errorCode:
                            error.code,
                        message:
                            `TCP port ${port} is closed.`
                    });

                    return;
                }

                if (
                    error.code ===
                    "EHOSTUNREACH" ||
                    error.code ===
                    "ENETUNREACH"
                ) {
                    finish({
                        reachable: false,
                        state: "UNREACHABLE",
                        error:
                            error.message,
                        errorCode:
                            error.code,
                        message:
                            "Host or network is unreachable."
                    });

                    return;
                }

                finish({
                    reachable: false,
                    state: "ERROR",
                    error:
                        error.message,
                    errorCode:
                        error.code,
                    message:
                        `TCP port ${port} could not be checked.`
                });
            }
        );

        try {
            socket.connect(
                port,
                host
            );
        } catch (error) {
            finish({
                reachable: false,
                state: "ERROR",
                error:
                    error.message,
                message:
                    `Failed to test TCP port ${port}.`
            });
        }
    });
}

function checkHttp(device) {
    return new Promise((resolve) => {
        const protocol =
            device.http?.protocol === "https"
                ? https
                : http;

        const port =
            device.http?.port ||
            (
                device.http?.protocol === "https"
                    ? 443
                    : 80
            );

        const path =
            device.http?.path ||
            "/";

        const start =
            Date.now();

        let completed =
            false;

        function finish(result) {
            if (completed) {
                return;
            }

            completed = true;

            resolve(result);
        }

        const request =
            protocol.request(
                {
                    hostname:
                        device.ipAddress,

                    port,

                    path,

                    method:
                        "GET",

                    timeout:
                        5000,

                    rejectUnauthorized:
                        false
                },
                (response) => {
                    const responseTime =
                        Date.now() -
                        start;

                    response.resume();

                    finish({
                        reachable:
                            true,

                        statusCode:
                            response.statusCode,

                        responseTime,

                        error:
                            null
                    });
                }
            );

        request.on(
            "timeout",
            () => {
                request.destroy();

                finish({
                    reachable:
                        false,

                    statusCode:
                        null,

                    responseTime:
                        Date.now() -
                        start,

                    error:
                        "HTTP request timed out."
                });
            }
        );

        request.on(
            "error",
            (error) => {
                finish({
                    reachable:
                        false,

                    statusCode:
                        null,

                    responseTime:
                        Date.now() -
                        start,

                    error:
                        error.message
                });
            }
        );

        request.end();
    });
}

async function checkSnmp(device) {
    if (!device.snmp?.enabled) {
        return {
            reachable: false,
            skipped: true,
            error:
                "SNMP monitoring is disabled."
        };
    }

    try {
        const snmp =
            await import("net-snmp");

        const community =
            device.snmp.community ||
            "public";

        const version =
            device.snmp.version === "1"
                ? snmp.Version1
                : snmp.Version2c;

        const session =
            snmp.createSession(
                device.ipAddress,
                community,
                {
                    version,
                    timeout: 3000,
                    retries: 0
                }
            );

        const result =
            await new Promise(
                (resolve, reject) => {
                    session.get(
                        [
                            "1.3.6.1.2.1.1.1.0"
                        ],
                        (
                            error,
                            varbinds
                        ) => {
                            try {
                                session.close();
                            } catch (_) {
                            }

                            if (error) {
                                reject(
                                    error
                                );

                                return;
                            }

                            resolve(
                                varbinds
                            );
                        }
                    );
                }
            );

        return {
            reachable: true,

            skipped: false,

            value:
                result?.[0]?.value ??
                null,

            error: null
        };
    } catch (error) {
        return {
            reachable: false,

            skipped: false,

            error:
                error.message
        };
    }
}

function determineStatus(result) {
    const pingReachable =
        result.ping?.reachable ===
        true;

    const snmpReachable =
        result.snmp?.reachable ===
        true;

    if (
        pingReachable ||
        snmpReachable
    ) {
        if (
            result.http?.enabled ===
            true &&
            result.http?.reachable ===
            false
        ) {
            return "DEGRADED";
        }

        const ports =
            Object.values(
                result.ports || {}
            );

        const checkedPorts =
            ports.filter(
                (port) =>
                    port.enabled !== false &&
                    port.reachable !== null &&
                    port.reachable !== undefined
            );

        const failedPorts =
            checkedPorts.filter(
                (port) =>
                    port.reachable !== true
            );

        if (
            failedPorts.length > 0
        ) {
            return "DEGRADED";
        }

        return "UP";
    }

    return "DOWN";
}

async function getInitialTechnician() {
    return await Technician
        .findOne({
            level: 1,
            active: true
        })
        .sort({
            createdAt: 1
        });
}

function generateIncidentId() {
    return `NET-${Math.floor(
        1000 +
        Math.random() *
        9000
    )}`;
}

function determineIncidentSeverity(
    device,
    result
) {
    if (
        result.status ===
        "DOWN"
    ) {
        if (
            device.deviceType ===
                "router" ||
            device.deviceType ===
                "firewall"
        ) {
            return "critical";
        }

        if (
            device.deviceType ===
            "switch"
        ) {
            return "high";
        }

        return "medium";
    }

    if (
        result.status ===
        "DEGRADED"
    ) {
        return "high";
    }

    return "medium";
}

const ACTIVE_INCIDENT_STATUSES = ["OPEN", "CALLING", "ACKNOWLEDGED", "ESCALATING", "FAILED"];
const MAX_ANCESTOR_HOPS = 10;

// Find the nearest ancestor (walking parentDeviceId all the way up, not just
// one hop) that currently has an active incident of its own. A direct parent
// can be down too without having its own top-level incident - it may itself
// be suppressed/attached under a grandparent's incident, in which case its
// activeIncidentId is null and the fault has to be attributed further up.
async function findNearestActiveAncestorIncident(
    device
) {
    const visited = new Set([
        device.deviceId
    ]);

    let parentDeviceId =
        device.parentDeviceId;

    for (
        let hops = 0;
        parentDeviceId && hops < MAX_ANCESTOR_HOPS;
        hops++
    ) {
        if (
            visited.has(
                parentDeviceId
            )
        ) {
            break;
        }

        visited.add(
            parentDeviceId
        );

        const parentDevice =
            await Device.findOne({
                deviceId:
                    parentDeviceId
            });

        if (!parentDevice) {
            break;
        }

        if (
            parentDevice.activeIncidentId
        ) {
            const parentIncident =
                await Incident.findOne({
                    incidentId:
                        parentDevice.activeIncidentId,
                    status: {
                        $in: ACTIVE_INCIDENT_STATUSES
                    }
                });

            if (parentIncident) {
                return {
                    parentDevice,
                    parentIncident
                };
            }
        }

        parentDeviceId =
            parentDevice.parentDeviceId;
    }

    return null;
}

// If an ancestor up the topology chain already has an active incident, this
// device's own failure is most likely a symptom rather than an independent
// fault - attach it to that incident instead of paging a technician for it
// separately.
async function attachToParentIncident(
    device
) {
    const found =
        await findNearestActiveAncestorIncident(
            device
        );

    if (!found) {
        return null;
    }

    const {
        parentDevice,
        parentIncident
    } = found;

    const alreadyImpacted = parentIncident.impactedDevices.some(
        (entry) => entry.deviceId === device.deviceId
    );

    if (!alreadyImpacted) {
        parentIncident.impactedDevices.push({
            deviceId: device.deviceId,
            hostname: device.hostname,
            status: device.status,
            attachedAt: new Date()
        });

        await parentIncident.save();

        console.log(
            `Device ${device.hostname} attached as impacted under parent incident ${parentIncident.incidentId} (parent ${parentDevice.hostname} is already down).`
        );

        emitMonitoringEvent(
            "incident_updated",
            parentIncident
        );
    }

    return parentIncident;
}

// Breadth-first walk down parentDeviceId (the reverse of the ancestor walk)
// to find every descendant of a device, bounded and cycle-safe the same way.
async function collectDescendantDevices(
    rootDeviceId
) {
    const descendants = [];
    const visited = new Set([
        rootDeviceId
    ]);

    let frontier = [
        rootDeviceId
    ];

    for (
        let hops = 0;
        frontier.length && hops < MAX_ANCESTOR_HOPS;
        hops++
    ) {
        const children =
            await Device.find({
                parentDeviceId: {
                    $in: frontier
                }
            });

        frontier = [];

        for (
            const child of
            children
        ) {
            if (
                visited.has(
                    child.deviceId
                )
            ) {
                continue;
            }

            visited.add(
                child.deviceId
            );

            descendants.push(
                child
            );

            frontier.push(
                child.deviceId
            );
        }
    }

    return descendants;
}

// Independent poll timers mean a descendant can detect its own failure and
// create a standalone incident before an ancestor further up the same
// outage has finished doing the same - the ancestor's activeIncidentId
// simply doesn't exist yet at the moment the descendant checks it. Once a
// device settles on the incident that represents its own failure (either
// one it just created, or one it just attached to), sweep its descendants
// for any such stray incidents and fold them into that same incident so a
// single cascading outage can't end up fragmented across separately-paged
// incidents depending on which poll happened to finish first.
async function adoptDescendantIncidents(
    device,
    incident
) {
    const descendants =
        await collectDescendantDevices(
            device.deviceId
        );

    let changed = false;

    for (
        const descendant of
        descendants
    ) {
        if (
            !descendant.activeIncidentId ||
            descendant.activeIncidentId === incident.incidentId
        ) {
            continue;
        }

        const strayIncident =
            await Incident.findOne({
                incidentId:
                    descendant.activeIncidentId,
                status: {
                    $in: ACTIVE_INCIDENT_STATUSES
                }
            });

        if (!strayIncident) {
            continue;
        }

        const alreadyImpacted = incident.impactedDevices.some(
            (entry) => entry.deviceId === descendant.deviceId
        );

        if (!alreadyImpacted) {
            incident.impactedDevices.push({
                deviceId:
                    descendant.deviceId,
                hostname:
                    descendant.hostname,
                status:
                    descendant.status,
                attachedAt:
                    new Date()
            });

            changed = true;
        }

        strayIncident.status =
            "RESOLVED";

        strayIncident.resolvedAt =
            new Date();

        strayIncident.description += ` Merged into ${incident.incidentId}: part of the same upstream outage.`;

        await strayIncident.save();

        console.log(
            `Folded stray incident ${strayIncident.incidentId} (${descendant.hostname}) into ${incident.incidentId} (${device.hostname}) - same cascading outage, detected out of order.`
        );

        emitMonitoringEvent(
            "incident_updated",
            strayIncident
        );

        descendant.activeIncidentId =
            null;

        await descendant.save();
    }

    if (changed) {
        await incident.save();

        emitMonitoringEvent(
            "incident_updated",
            incident
        );
    }
}

// Once a device recovers, drop it from any parent incident's impacted list
// so the impacted count only reflects devices that are currently affected.
// Looked up by membership rather than via parentDevice.activeIncidentId: if
// the parent itself recovered first (a real race - a child's own recovery
// poll can land after the parent's), that field is already cleared by the
// time this runs, and the child would otherwise have no way back to the
// incident it needs to detach from. Scoped to still-active incidents only,
// so a resolved incident's impacted list is left as-is - a historical
// record of who was affected, not a live status.
async function detachFromParentIncident(
    device
) {
    const parentIncident = await Incident.findOne({
        "impactedDevices.deviceId": device.deviceId,
        status: { $in: ACTIVE_INCIDENT_STATUSES }
    });

    if (!parentIncident) {
        return;
    }

    const before = parentIncident.impactedDevices.length;

    parentIncident.impactedDevices = parentIncident.impactedDevices.filter(
        (entry) => entry.deviceId !== device.deviceId
    );

    if (parentIncident.impactedDevices.length !== before) {
        await parentIncident.save();
        emitMonitoringEvent(
            "incident_updated",
            parentIncident
        );
    }
}

async function createDeviceIncident(
    device,
    result
) {
    if (
        device.activeIncidentId
    ) {
        console.log(
            `Device ${device.hostname} already has active incident ${device.activeIncidentId}`
        );

        return null;
    }

    const suppressedByParent =
        await attachToParentIncident(
            device
        );

    if (suppressedByParent) {
        await adoptDescendantIncidents(
            device,
            suppressedByParent
        );

        return null;
    }

    const technician =
        await getInitialTechnician();

    const technicianData =
        technician
            ? {
                id:
                    technician.technicianId,

                name:
                    technician.name,

                phone:
                    technician.phone
            }
            : {
                id: null,
                name: null,
                phone: null
            };

    const incidentId =
        generateIncidentId();

    const severity =
        computeWeightedSeverity({
            baseSeverity: determineIncidentSeverity(
                device,
                result
            ),
            deviceRole: device.role,
            impactedDeviceCount: 0,
            activeMinutes: 0
        });

    let description =
        "";

    if (
        result.status ===
        "DOWN"
    ) {
        description =
            `Automated monitoring detected that device ${device.hostname} (${device.ipAddress}) is unreachable.`;
    } else if (
        result.status ===
        "DEGRADED"
    ) {
        description =
            `Automated monitoring detected degraded service on device ${device.hostname} (${device.ipAddress}).`;
    } else {
        description =
            `Automated monitoring generated an incident for device ${device.hostname} (${device.ipAddress}).`;
    }

    if (result.ping) {
        if (
            result.ping.reachable
        ) {
            description +=
                ` ICMP ping is responding with approximately ${result.ping.latency}ms latency.`;
        } else {
            description +=
                " ICMP ping is not responding.";
        }
    }

    if (
        result.snmp?.skipped
    ) {
        description +=
            " SNMP monitoring is disabled.";
    } else if (
        result.snmp &&
        !result.snmp.reachable
    ) {
        description +=
            ` SNMP is unavailable: ${result.snmp.error || "No response"}.`;
    }

    if (
        result.http &&
        result.http.enabled &&
        !result.http.reachable
    ) {
        description +=
            ` HTTP service is unavailable: ${result.http.error || "No response"}.`;
    }

    const failedPorts =
        Object.entries(
            result.ports || {}
        ).filter(
            ([, port]) =>
                port.enabled !== false &&
                port.reachable === false
        );

    if (
        failedPorts.length > 0
    ) {
        description +=
            ` Failed monitored ports: ${failedPorts
                .map(
                    ([portNumber, port]) =>
                        `${port.name || "Port"}:${portNumber}`
                )
                .join(", ")}.`;
    }

    const incident =
        await Incident.create({
            incidentId,

            deviceId:
                device.deviceId,

            device:
                device.hostname,

            location:
                device.location,

            severity,

            description,

            technician:
                technicianData,

            escalationLevel:
                1,

            status:
                "OPEN"
        });

    device.activeIncidentId =
        incident.incidentId;

    await device.save();

    console.log(
        `AUTOMATIC INCIDENT CREATED: ${incident.incidentId}`
    );

    emitMonitoringEvent(
        "incident_created",
        incident
    );

    if (technician) {
        processIncident(
            incident,
            monitoringIo
        ).catch(
            (error) => {
                console.error(
                    "Automatic incident escalation failed:",
                    error
                );
            }
        );
    }

    await adoptDescendantIncidents(
        device,
        incident
    );

    return incident;
}

async function resolveDeviceIncident(
    device
) {
    await detachFromParentIncident(
        device
    );

    if (
        !device.activeIncidentId
    ) {
        return null;
    }

    const incident =
        await Incident.findOne({
            incidentId:
                device.activeIncidentId
        });

    if (
        incident &&
        incident.status !==
            "RESOLVED"
    ) {
        incident.status =
            "RESOLVED";

        incident.resolvedAt =
            new Date();

        await incident.save();

        console.log(
            `Automatic recovery resolved incident ${incident.incidentId}`
        );

        emitMonitoringEvent(
            "incident_updated",
            incident
        );
    }

    device.activeIncidentId =
        null;

    await device.save();

    return incident;
}

function updateMonitoredPortStatuses(
    device,
    result
) {
    if (
        !Array.isArray(
            device.monitoredPorts
        )
    ) {
        return;
    }

    device.monitoredPorts =
        device.monitoredPorts.map(
            (monitoredPort) => {
                const portNumber =
                    Number(
                        monitoredPort.port
                    );

                const portResult =
                    result.ports[
                        portNumber
                    ];

                if (!portResult) {
                    return monitoredPort;
                }

                if (
                    portResult.reachable ===
                    true
                ) {
                    monitoredPort.status =
                        "UP";
                } else if (
                    portResult.reachable ===
                    false
                ) {
                    monitoredPort.status =
                        "DOWN";
                } else {
                    monitoredPort.status =
                        "UNKNOWN";
                }

                monitoredPort.lastCheckedAt =
                    new Date();

                return monitoredPort;
            }
        );
}

export async function pollDevice(
    deviceId
) {
    const device =
        await Device.findOne({
            deviceId
        });

    if (!device) {
        throw new Error(
            "Device not found."
        );
    }

    const result = {
        ping: null,
        snmp: null,
        http: null,
        ports: {},
        status: "UNKNOWN"
    };

    if (
        device.monitoringMethods?.includes(
            "icmp"
        )
    ) {
        result.ping =
            await pingDevice(
                device.ipAddress
            );
    }

    if (
        device.monitoringMethods?.includes(
            "snmp"
        )
    ) {
        result.snmp =
            await checkSnmp(
                device
            );
    } else {
        result.snmp = {
            reachable: false,
            skipped: true,
            error:
                "SNMP monitoring is not configured."
        };
    }

    if (
        device.monitoringMethods?.includes(
            "http"
        ) ||
        device.monitoringMethods?.includes(
            "https"
        )
    ) {
        result.http = {
            enabled: true,

            ...await checkHttp(
                device
            )
        };
    }

    for (
        const monitoredPort of
        device.monitoredPorts || []
    ) {
        if (
            !monitoredPort.enabled
        ) {
            continue;
        }

        const port =
            Number(
                monitoredPort.port
            );

        if (
            monitoredPort.protocol ===
            "udp"
        ) {
            result.ports[port] = {
                ...(
                    typeof monitoredPort.toObject ===
                    "function"
                        ? monitoredPort.toObject()
                        : monitoredPort
                ),

                reachable:
                    null,

                state:
                    "UNKNOWN",

                error:
                    "UDP port monitoring requires an active UDP probe."
            };

            continue;
        }

        const portResult =
            await checkTcpPort(
                device.ipAddress,
                port
            );

        result.ports[port] = {
            ...(
                typeof monitoredPort.toObject ===
                "function"
                    ? monitoredPort.toObject()
                    : monitoredPort
            ),

            ...portResult
        };
    }

    result.status =
        determineStatus(
            result
        );

    const previousStatus =
        device.status;

    device.status =
        result.status;

    device.lastPollAt =
        new Date();

    if (
        result.status ===
        "UP"
    ) {
        device.lastError =
            null;
    } else if (
        result.status ===
        "DOWN"
    ) {
        device.lastError =
            "Device unreachable.";
    } else {
        device.lastError =
            "One or more monitored services are degraded.";
    }

    if (
        result.ping?.reachable ===
            true ||
        result.snmp?.reachable ===
            true
    ) {
        device.lastSeenAt =
            new Date();
    }

    if (
        previousStatus !==
        result.status
    ) {
        device.lastStatusChangeAt =
            new Date();
    }

    device.monitoringResult = {
        ping:
            result.ping || {},

        snmp:
            result.snmp || {},

        http:
            result.http || {},

        ports:
            result.ports || {}
    };

    updateMonitoredPortStatuses(
        device,
        result
    );

    await device.save();

    console.log(
        `[MONITOR] ${device.hostname} -> ${result.status}`
    );

    /*
     * Send the COMPLETE device document.
     */

    emitMonitoringEvent(
        "device_updated",
        device.toObject()
    );

    if (
        result.status ===
            "DOWN" ||
        result.status ===
            "DEGRADED"
    ) {
        await createDeviceIncident(
            device,
            result
        );
    }

    if (
        result.status ===
        "UP"
    ) {
        await resolveDeviceIncident(
            device
        );
    }

    return {
        success: true,
        device,
        result
    };
}

export async function startDeviceMonitoring(
    device
) {
    stopDeviceMonitoring(
        device.deviceId
    );

    if (
        !device.monitoringEnabled
    ) {
        console.log(
            `Monitoring disabled for ${device.hostname}`
        );

        return;
    }

    const interval =
        Math.max(
            5,
            Number(
                device.pollingInterval ||
                30
            )
        );

    console.log(
        `Starting monitoring for ${device.hostname} every ${interval}s`
    );

    pollDevice(
        device.deviceId
    ).catch(
        (error) => {
            console.error(
                `Initial poll failed for ${device.hostname}:`,
                error
            );
        }
    );

    const timer =
        setInterval(
            async () => {
                try {
                    await pollDevice(
                        device.deviceId
                    );
                } catch (error) {
                    console.error(
                        `Monitoring failed for ${device.hostname}:`,
                        error
                    );
                }
            },
            interval * 1000
        );

    monitoringTimers.set(
        device.deviceId,
        timer
    );
}

export function stopDeviceMonitoring(
    deviceId
) {
    const timer =
        monitoringTimers.get(
            deviceId
        );

    if (!timer) {
        return;
    }

    clearInterval(timer);

    monitoringTimers.delete(
        deviceId
    );

    console.log(
        `Stopped monitoring for device ${deviceId}`
    );
}

export async function restartDeviceMonitoring(
    deviceId
) {
    const device =
        await Device.findOne({
            deviceId
        });

    if (!device) {
        throw new Error(
            "Device not found."
        );
    }

    stopDeviceMonitoring(
        deviceId
    );

    await startDeviceMonitoring(
        device
    );

    return device;
}

export async function startAllDeviceMonitoring() {
    const devices =
        await Device.find({
            monitoringEnabled:
                true
        });

    console.log(
        `Starting monitoring for ${devices.length} device(s).`
    );

    for (
        const device of
        devices
    ) {
        await startDeviceMonitoring(
            device
        );
    }

    return devices.length;
}

export function stopAllDeviceMonitoring() {
    for (
        const deviceId of
        monitoringTimers.keys()
    ) {
        stopDeviceMonitoring(
            deviceId
        );
    }

    console.log(
        "All device monitoring stopped."
    );
}

export function getMonitoringState() {
    return {
        activeDevices:
            monitoringTimers.size,

        deviceIds:
            Array.from(
                monitoringTimers.keys()
            )
    };
}