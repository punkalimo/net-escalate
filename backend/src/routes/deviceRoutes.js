import express from "express";
import net from "net";

import Device from "../models/Device.js";
import DeviceSystemSample from "../models/DeviceSystemSample.js";

import {
    startDeviceMonitoring,
    stopDeviceMonitoring,
    restartDeviceMonitoring
} from "../services/deviceMonitoringService.js";

import { startInterfaceMonitoring } from "../services/interfaceMonitoringService.js";

const router = express.Router();

function generateDeviceId() {
    return `DEV-${Math.floor(
        1000 + Math.random() * 9000
    )}`;
}

function testTcpPort(
    host,
    port,
    timeout = 5000
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
                    message:
                        `Connection to TCP port ${port} timed out.`
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
                        reachable: true,
                        state: "CLOSED",
                        message:
                            `TCP port ${port} is closed.`,
                        errorCode:
                            error.code
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
                        message:
                            "Host or network is unreachable.",
                        errorCode:
                            error.code
                    });

                    return;
                }

                finish({
                    reachable: false,
                    state: "ERROR",
                    message:
                        error.message,
                    errorCode:
                        error.code
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
                message:
                    error.message
            });
        }
    });
}

router.get(
    "/",
    async (req, res) => {
        try {
            const devices =
                await Device
                    .find({ realmId: req.realmId })
                    .sort({
                        createdAt: -1
                    })
                    .lean()
                    .exec();

            return res.json({
                success: true,
                devices
            });
        } catch (error) {
            console.error(
                "GET DEVICES ERROR:",
                error
            );

            return res.status(500).json({
                success: false,
                message:
                    "Failed to retrieve devices.",
                error:
                    error.message
            });
        }
    }
);

router.get(
    "/:deviceId",
    async (req, res) => {
        try {
            const device =
                await Device.findOne({
                    deviceId:
                        req.params.deviceId,
                    realmId: req.realmId
                }).lean();

            if (!device) {
                return res.status(404).json({
                    success: false,
                    message:
                        "Device not found."
                });
            }

            return res.json({
                success: true,
                device
            });
        } catch (error) {
            console.error(
                "GET DEVICE ERROR:",
                error
            );

            return res.status(500).json({
                success: false,
                message:
                    "Failed to retrieve device.",
                error:
                    error.message
            });
        }
    }
);

router.get(
    "/:deviceId/system-health/history",
    async (req, res) => {
        try {
            const device = await Device.findOne({ deviceId: req.params.deviceId, realmId: req.realmId }).select("deviceId").lean();
            if (!device) {
                return res.status(404).json({ success: false, message: "Device not found." });
            }

            const hours = Math.min(168, Math.max(1, Number(req.query.hours || 24)));
            const metric = ["cpu", "memory"].includes(req.query.metric) ? req.query.metric : null;
            const since = new Date(Date.now() - hours * 60 * 60 * 1000);
            const query = { realmId: req.realmId, deviceId: device.deviceId, sampledAt: { $gte: since } };
            if (metric) query.metric = metric;

            const samples = await DeviceSystemSample.find(query).sort({ sampledAt: 1 }).lean();
            return res.json({ success: true, deviceId: device.deviceId, hours, samples });
        } catch (error) {
            console.error("DEVICE SYSTEM HEALTH HISTORY ERROR:", error);
            return res.status(500).json({ success: false, message: "Failed to retrieve system health history.", error: error.message });
        }
    }
);

router.post(
    "/",
    async (req, res) => {
        try {
            console.log(
                "========================================"
            );

            console.log(
                "CREATE DEVICE REQUEST"
            );

            console.log(
                "BODY:",
                req.body
            );

            const {
                deviceId,
                hostname,
                ipAddress,
                deviceType,
                vendor,
                model,
                location,
                description,
                monitoringEnabled,
                pollingInterval,
                monitoringMethods,
                snmp,
                http,
                alertThresholds,
                parentDeviceId,
                monitoredPorts
            } = req.body;

            if (
                !hostname ||
                !String(hostname).trim()
            ) {
                return res.status(400).json({
                    success: false,
                    message:
                        "Hostname is required."
                });
            }

            if (
                !ipAddress ||
                !String(ipAddress).trim()
            ) {
                return res.status(400).json({
                    success: false,
                    message:
                        "IP address is required."
                });
            }

            const existingIp =
                await Device.findOne({
                    ipAddress:
                        String(
                            ipAddress
                        ).trim(),
                    realmId: req.realmId
                });

            if (existingIp) {
                return res.status(409).json({
                    success: false,
                    message:
                        "A device with this IP address already exists.",
                    device:
                        existingIp
                });
            }

            let finalDeviceId =
                deviceId &&
                String(
                    deviceId
                ).trim()
                    ? String(
                        deviceId
                    ).trim()
                    : generateDeviceId();

            let existingDeviceId =
                await Device.findOne({
                    deviceId:
                        finalDeviceId
                });

            while (
                existingDeviceId
            ) {
                finalDeviceId =
                    generateDeviceId();

                existingDeviceId =
                    await Device.findOne({
                        deviceId:
                            finalDeviceId
                    });
            }

            const deviceData = {
                deviceId:
                    finalDeviceId,

                realmId:
                    req.realmId,

                hostname:
                    String(
                        hostname
                    ).trim(),

                ipAddress:
                    String(
                        ipAddress
                    ).trim(),

                deviceType:
                    deviceType || "other",

                vendor:
                    vendor || "",

                model:
                    model || "",

                location:
                    location || "",

                description:
                    description || "",

                monitoringEnabled:
                    monitoringEnabled !== false,

                pollingInterval:
                    Number(
                        pollingInterval
                    ) || 30,

                monitoringMethods:
                    Array.isArray(
                        monitoringMethods
                    ) &&
                    monitoringMethods.length > 0
                        ? monitoringMethods
                        : ["icmp"],

                snmp:
                    snmp || {
                        enabled: false,
                        version: "2c",
                        community:
                            "public"
                    },

                http:
                    http || {
                        enabled: false,
                        protocol: "http",
                        port: 80,
                        path: "/"
                    },

                alertThresholds:
                    alertThresholds || {},

                parentDeviceId:
                    parentDeviceId
                        ? String(parentDeviceId).trim()
                        : null,

                monitoredPorts:
                    Array.isArray(
                        monitoredPorts
                    )
                        ? monitoredPorts
                        : [],

                status:
                    "UNKNOWN",

                lastSeenAt:
                    null,

                lastPollAt:
                    null,

                lastStatusChangeAt:
                    null,

                activeIncidentId:
                    null,

                lastError:
                    null,

                monitoringResult: {
                    ping: {
                        reachable:
                            false,
                        latency:
                            null
                    },

                    snmp: {
                        reachable:
                            false,
                        error:
                            null
                    },

                    http: {
                        reachable:
                            false,
                        statusCode:
                            null,
                        responseTime:
                            null,
                        error:
                            null
                    },

                    ports: {}
                }
            };

            console.log(
                "DEVICE DATA:",
                deviceData
            );

            const device =
                await Device.create(
                    deviceData
                );

            console.log(
                "DEVICE CREATED:",
                device.deviceId
            );

            if (
                device.monitoringEnabled
            ) {
                try {
                    await startDeviceMonitoring(
                        device
                    );

                    console.log(
                        `Monitoring started for ${device.hostname}`
                    );
                } catch (monitoringError) {
                    console.error(
                        "MONITORING START ERROR:",
                        monitoringError
                    );
                }

                startInterfaceMonitoring(
                    device
                ).catch((interfaceMonitoringError) => {
                    console.error(
                        "INTERFACE MONITORING START ERROR:",
                        interfaceMonitoringError
                    );
                });
            }

            return res.status(201).json({
                success: true,

                message:
                    "Device created successfully.",

                device
            });

        } catch (error) {
            console.error(
                "========================================"
            );

            console.error(
                "CREATE DEVICE ERROR:"
            );

            console.error(
                error
            );

            console.error(
                "MESSAGE:",
                error.message
            );

            if (
                error.name ===
                "ValidationError"
            ) {
                return res.status(400).json({
                    success: false,
                    message:
                        "Device validation failed.",
                    errors:
                        Object.fromEntries(
                            Object.entries(
                                error.errors
                            ).map(
                                ([
                                    field,
                                    value
                                ]) => [
                                    field,
                                    value.message
                                ]
                            )
                        )
                });
            }

            if (
                error.code ===
                11000
            ) {
                return res.status(409).json({
                    success: false,
                    message:
                        "A device with the same device ID or IP address already exists.",
                    error:
                        error.message
                });
            }

            return res.status(500).json({
                success: false,
                message:
                    "Failed to create device.",
                error:
                    error.message
            });
        }
    }
);

router.post(
    "/:deviceId/test-port",
    async (req, res) => {
        try {
            console.log(
                "========================================"
            );

            console.log(
                "PORT TEST"
            );

            console.log(
                "Device:",
                req.params.deviceId
            );

            console.log(
                "Body:",
                req.body
            );

            const device =
                await Device.findOne({
                    deviceId:
                        req.params.deviceId,
                    realmId: req.realmId
                });

            if (!device) {
                return res.status(404).json({
                    success: false,
                    message:
                        "Device not found."
                });
            }

            const port =
                Number(
                    req.body?.port
                );

            if (
                !Number.isInteger(
                    port
                ) ||
                port < 1 ||
                port > 65535
            ) {
                return res.status(400).json({
                    success: false,
                    message:
                        "Port must be an integer between 1 and 65535."
                });
            }

            const result =
                await testTcpPort(
                    device.ipAddress,
                    port
                );

            return res.json({
                success: true,

                deviceId:
                    device.deviceId,

                hostname:
                    device.hostname,

                ipAddress:
                    device.ipAddress,

                port,

                result
            });

        } catch (error) {
            console.error(
                "TEST PORT ERROR:",
                error
            );

            return res.status(500).json({
                success: false,
                message:
                    "Failed to test port.",
                error:
                    error.message
            });
        }
    }
);

router.post(
    "/:deviceId/test-connectivity",
    async (req, res) => {
        try {
            const device =
                await Device.findOne({
                    deviceId:
                        req.params.deviceId,
                    realmId: req.realmId
                });

            if (!device) {
                return res.status(404).json({
                    success: false,
                    message:
                        "Device not found."
                });
            }

            const port =
                Number(
                    req.body?.port ||
                    80
                );

            if (
                !Number.isInteger(
                    port
                ) ||
                port < 1 ||
                port > 65535
            ) {
                return res.status(400).json({
                    success: false,
                    message:
                        "Invalid TCP port."
                });
            }

            const result =
                await testTcpPort(
                    device.ipAddress,
                    port
                );

            return res.json({
                success: true,

                deviceId:
                    device.deviceId,

                hostname:
                    device.hostname,

                ipAddress:
                    device.ipAddress,

                port,

                result
            });

        } catch (error) {
            console.error(
                "CONNECTIVITY TEST ERROR:",
                error
            );

            return res.status(500).json({
                success: false,
                message:
                    "Connectivity test failed.",
                error:
                    error.message
            });
        }
    }
);

router.patch(
    "/:deviceId",
    async (req, res) => {
        try {
            const device =
                await Device.findOne({
                    deviceId:
                        req.params.deviceId,
                    realmId: req.realmId
                });

            if (!device) {
                return res.status(404).json({
                    success: false,
                    message:
                        "Device not found."
                });
            }

            const allowedFields = [
                "hostname",
                "ipAddress",
                "deviceType",
                "vendor",
                "model",
                "location",
                "description",
                "monitoringEnabled",
                "pollingInterval",
                "monitoringMethods",
                "snmp",
                "http",
                "alertThresholds",
                "monitoredPorts",
                "parentDeviceId"
            ];

            for (
                const field of
                allowedFields
            ) {
                if (
                    Object.prototype.hasOwnProperty.call(
                        req.body,
                        field
                    )
                ) {
                    device[field] =
                        req.body[field];
                }
            }

            await device.save();

            await restartDeviceMonitoring(
                device.deviceId
            );

            startInterfaceMonitoring(
                device
            ).catch((interfaceMonitoringError) => {
                console.error(
                    "INTERFACE MONITORING START ERROR:",
                    interfaceMonitoringError
                );
            });

            return res.json({
                success: true,
                message:
                    "Device updated successfully.",
                device
            });

        } catch (error) {
            console.error(
                "UPDATE DEVICE ERROR:",
                error
            );

            return res.status(500).json({
                success: false,
                message:
                    "Failed to update device.",
                error:
                    error.message
            });
        }
    }
);

router.delete(
    "/:deviceId",
    async (req, res) => {
        try {
            const device =
                await Device.findOne({
                    deviceId:
                        req.params.deviceId,
                    realmId: req.realmId
                });

            if (!device) {
                return res.status(404).json({
                    success: false,
                    message:
                        "Device not found."
                });
            }

            stopDeviceMonitoring(
                device.deviceId
            );

            await Device.deleteOne({
                deviceId:
                    device.deviceId,
                realmId: req.realmId
            });

            return res.json({
                success: true,
                message:
                    "Device deleted successfully."
            });

        } catch (error) {
            console.error(
                "DELETE DEVICE ERROR:",
                error
            );

            return res.status(500).json({
                success: false,
                message:
                    "Failed to delete device.",
                error:
                    error.message
            });
        }
    }
);

export default router;