import mongoose from "mongoose";


/*
 * ============================================================
 * DEVICE INTERFACE SCHEMA
 * ============================================================
 *
 * Represents an actual network interface on the device.
 *
 * Examples:
 *
 * GigabitEthernet0/0
 * GigabitEthernet0/1
 * VLAN10
 * Loopback0
 *
 * This is NOT used for TCP/UDP port monitoring.
 *
 * ============================================================
 */

const interfaceSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true
    },

    description: {
      type: String,
      default: ""
    },

    ipAddress: {
      type: String,
      default: ""
    },

    status: {
      type: String,
      enum: [
        "UP",
        "DOWN",
        "UNKNOWN"
      ],
      default: "UNKNOWN"
    },

    lastCheckedAt: {
      type: Date,
      default: null
    }
  },
  {
    _id: false
  }
);


/*
 * ============================================================
 * MONITORED PORT SCHEMA
 * ============================================================
 *
 * This is the single source of truth for TCP/UDP monitoring.
 *
 * ============================================================
 */

const monitoredPortSchema = new mongoose.Schema(
  {
    port: {
      type: Number,
      required: true,
      min: 1,
      max: 65535
    },

    protocol: {
      type: String,
      enum: [
        "tcp",
        "udp"
      ],
      default: "tcp"
    },

    name: {
      type: String,
      default: ""
    },

    enabled: {
      type: Boolean,
      default: true
    },

    status: {
      type: String,
      enum: [
        "UP",
        "DOWN",
        "UNKNOWN"
      ],
      default: "UNKNOWN"
    },

    lastCheckedAt: {
      type: Date,
      default: null
    }
  },
  {
    _id: false
  }
);


/*
 * ============================================================
 * SNMP CONFIGURATION
 * ============================================================
 */

const snmpSchema = new mongoose.Schema(
  {
    enabled: {
      type: Boolean,
      default: false
    },

    version: {
      type: String,
      enum: [
        "1",
        "2c",
        "3"
      ],
      default: "2c"
    },

    community: {
      type: String,
      default: "public"
    },

    username: {
      type: String,
      default: ""
    },

    securityLevel: {
      type: String,
      enum: [
        "noAuthNoPriv",
        "authNoPriv",
        "authPriv"
      ],
      default: "noAuthNoPriv"
    },

    authProtocol: {
      type: String,
      default: ""
    },

    authKey: {
      type: String,
      default: ""
    },

    privProtocol: {
      type: String,
      default: ""
    },

    privKey: {
      type: String,
      default: ""
    }
  },
  {
    _id: false
  }
);


/*
 * ============================================================
 * DEVICE SCHEMA
 * ============================================================
 */

const deviceSchema = new mongoose.Schema(
  {
    /*
     * ========================================================
     * IDENTITY
     * ========================================================
     */

    deviceId: {
      type: String,
      unique: true,
      required: true,
      trim: true
    },

    hostname: {
      type: String,
      required: true,
      trim: true
    },

    ipAddress: {
      type: String,
      unique: true,
      required: true,
      trim: true
    },

    deviceType: {
      type: String,
      enum: [
        "router",
        "switch",
        "firewall",
        "server",
        "access-point",
        "printer",
        "other"
      ],
      default: "other"
    },

    vendor: {
      type: String,
      default: ""
    },

    model: {
      type: String,
      default: ""
    },

    location: {
      type: String,
      default: ""
    },

    description: {
      type: String,
      default: ""
    },


    /*
     * ========================================================
     * NETWORK INTERFACES
     * ========================================================
     */

    interfaces: {
      type: [
        interfaceSchema
      ],
      default: []
    },


    /*
     * ========================================================
     * MONITORING
     * ========================================================
     */

    monitoringEnabled: {
      type: Boolean,
      default: true
    },

    pollingInterval: {
      type: Number,
      default: 30,
      min: 5
    },

    monitoringMethods: {
      type: [
        {
          type: String,
          enum: [
            "icmp",
            "snmp",
            "http",
            "https"
          ]
        }
      ],
      default: [
        "icmp"
      ]
    },


    /*
     * ========================================================
     * SNMP
     * ========================================================
     */

    snmp: {
      type: snmpSchema,
      default: () => ({})
    },


    /*
     * ========================================================
     * HTTP / HTTPS
     * ========================================================
     */

    http: {
      enabled: {
        type: Boolean,
        default: false
      },

      protocol: {
        type: String,
        enum: [
          "http",
          "https"
        ],
        default: "http"
      },

      port: {
        type: Number,
        default: 80,
        min: 1,
        max: 65535
      },

      path: {
        type: String,
        default: "/"
      }
    },


    /*
     * ========================================================
     * MONITORED PORTS
     * ========================================================
     *
     * SINGLE SOURCE OF TRUTH FOR PORT MONITORING.
     *
     * ========================================================
     */

    monitoredPorts: {
      type: [
        monitoredPortSchema
      ],
      default: []
    },


    /*
     * ========================================================
     * CURRENT STATUS
     * ========================================================
     */

    status: {
      type: String,
      enum: [
        "UP",
        "DOWN",
        "DEGRADED",
        "UNKNOWN"
      ],
      default: "UNKNOWN"
    },

    lastSeenAt: {
      type: Date,
      default: null
    },

    lastPollAt: {
      type: Date,
      default: null
    },

    lastStatusChangeAt: {
      type: Date,
      default: null
    },


    /*
     * ========================================================
     * INCIDENT TRACKING
     * ========================================================
     */

    activeIncidentId: {
      type: String,
      default: null
    },

    lastError: {
      type: String,
      default: null
    },


    /*
     * ========================================================
     * LAST MONITORING RESULT
     * ========================================================
     */

    monitoringResult: {
      ping: {
        reachable: {
          type: Boolean,
          default: false
        },

        latency: {
          type: Number,
          default: null
        },

        error: {
          type: String,
          default: null
        }
      },

      snmp: {
        reachable: {
          type: Boolean,
          default: false
        },

        skipped: {
          type: Boolean,
          default: false
        },

        value: {
          type: mongoose.Schema.Types.Mixed,
          default: null
        },

        error: {
          type: String,
          default: null
        }
      },

      http: {
        enabled: {
          type: Boolean,
          default: false
        },

        reachable: {
          type: Boolean,
          default: false
        },

        statusCode: {
          type: Number,
          default: null
        },

        responseTime: {
          type: Number,
          default: null
        },

        error: {
          type: String,
          default: null
        }
      },

      /*
       * Example:
       *
       * ports: {
       *   "22": {
       *      reachable: true,
       *      state: "OPEN"
       *   }
       * }
       */

      ports: {
        type: mongoose.Schema.Types.Mixed,
        default: {}
      }
    }
  },
  {
    timestamps: true
  }
);


const Device =
mongoose.models.Device ||
mongoose.model("Device", deviceSchema);

export default Device;