import {
  useEffect,
  useState
} from "react";

import {
  io
} from "socket.io-client";

import {
  Activity,
  AlertTriangle,
  Phone,
  CheckCircle2,
  Server,
  Plus,
  RefreshCw,
  X,
  Clock,
  User,
  MapPin,
  ChevronRight,
  Check,
  PhoneCall,
  AlertCircle,
  Router,
  Monitor,
  Wifi,
  WifiOff,
  Settings,
  ExternalLink,
  Search,
  Network,
  Shield,
  CircleDot
} from "lucide-react";

import {
  getIncidents,
  createIncident,
  getTechnicians,
  resolveIncident,
  getDevices,
  createDevice,
  testDevicePort,
  testDeviceConnectivity
} from "./services/api";


const SOCKET_URL =
  import.meta.env.VITE_API_URL ||
  "http://localhost:5000";


/*
 * ========================================
 * STAT CARD
 * ========================================
 */

function StatCard({
  title,
  value,
  icon: Icon,
  description
}) {

  return (

    <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-5">

      <div className="flex items-center justify-between">

        <div>

          <p className="text-sm text-slate-400">
            {title}
          </p>

          <p className="mt-2 text-3xl font-bold text-white">
            {value}
          </p>

          <p className="mt-1 text-xs text-slate-500">
            {description}
          </p>

        </div>

        <div className="rounded-lg bg-slate-800 p-3">

          <Icon
            size={22}
            className="text-slate-300"
          />

        </div>

      </div>

    </div>

  );

}


/*
 * ========================================
 * SEVERITY BADGE
 * ========================================
 */

function SeverityBadge({
  severity
}) {

  const styles = {

    critical:
      "bg-red-500/10 text-red-400 border-red-500/30",

    high:
      "bg-orange-500/10 text-orange-400 border-orange-500/30",

    medium:
      "bg-yellow-500/10 text-yellow-400 border-yellow-500/30",

    low:
      "bg-blue-500/10 text-blue-400 border-blue-500/30"

  };


  return (

    <span
      className={`rounded-full border px-2.5 py-1 text-xs font-semibold uppercase ${
        styles[severity] ||
        styles.medium
      }`}
    >
      {severity}
    </span>

  );

}


/*
 * ========================================
 * STATUS BADGE
 * ========================================
 */

function StatusBadge({
  status
}) {

  const styles = {

    OPEN:
      "text-blue-400",

    CALLING:
      "text-purple-400",

    ACKNOWLEDGED:
      "text-green-400",

    ESCALATING:
      "text-orange-400",

    RESOLVED:
      "text-slate-400",

    FAILED:
      "text-red-400",

    UP:
      "text-green-400",

    DOWN:
      "text-red-400",

    DEGRADED:
      "text-orange-400",

    UNKNOWN:
      "text-yellow-400"

  };


  return (

    <div className="flex items-center gap-2">

      <span
        className={`h-2 w-2 rounded-full bg-current ${
          styles[status] ||
          "text-slate-400"
        }`}
      />

      <span
        className={`text-xs font-medium ${
          styles[status] ||
          "text-slate-400"
        }`}
      >
        {status}
      </span>

    </div>

  );

}


/*
 * ========================================
 * DEVICE STATUS BADGE
 * ========================================
 */

function DeviceStatusBadge({
  status
}) {

  if (status === "UP") {

    return (

      <div className="flex items-center gap-2 text-green-400">

        <Wifi size={15} />

        <span className="text-xs font-semibold">
          ONLINE
        </span>

      </div>

    );

  }


  if (status === "DOWN") {

    return (

      <div className="flex items-center gap-2 text-red-400">

        <WifiOff size={15} />

        <span className="text-xs font-semibold">
          OFFLINE
        </span>

      </div>

    );

  }


  if (status === "DEGRADED") {

    return (

      <div className="flex items-center gap-2 text-orange-400">

        <AlertTriangle size={15} />

        <span className="text-xs font-semibold">
          DEGRADED
        </span>

      </div>

    );

  }


  return (

    <div className="flex items-center gap-2 text-yellow-400">

      <CircleDot size={15} />

      <span className="text-xs font-semibold">
        UNKNOWN
      </span>

    </div>

  );

}


/*
 * ========================================
 * DEVICE ICON
 * ========================================
 */

function DeviceIcon({
  type
}) {

  if (
    type === "router"
  ) {

    return (
      <Router
        size={20}
        className="text-blue-400"
      />
    );

  }


  if (
    type === "switch"
  ) {

    return (
      <Network
        size={20}
        className="text-purple-400"
      />
    );

  }


  if (
    type === "firewall"
  ) {

    return (
      <Shield
        size={20}
        className="text-orange-400"
      />
    );

  }


  if (
    type === "server"
  ) {

    return (
      <Server
        size={20}
        className="text-green-400"
      />
    );

  }


  return (
    <Monitor
      size={20}
      className="text-slate-400"
    />
  );

}


/*
 * ========================================
 * ESCALATION HISTORY
 * ========================================
 */

function EscalationHistory({
  history = []
}) {

  if (!history.length) {

    return (

      <div className="rounded-lg border border-slate-800 bg-slate-950/50 p-5">

        <p className="text-sm text-slate-500">
          No escalation history available.
        </p>

      </div>

    );

  }


  return (

    <div className="space-y-3">

      {history.map(
        (entry, index) => {

          const successful =
            entry.status ===
            "ACKNOWLEDGED";

          const failed =
            entry.status ===
            "FAILED";

          const escalated =
            entry.status ===
            "ESCALATED";


          return (

            <div
              key={index}
              className="rounded-lg border border-slate-800 bg-slate-950/50 p-4"
            >

              <div className="flex items-start justify-between gap-4">

                <div className="flex items-start gap-3">

                  <div
                    className={`mt-0.5 rounded-full p-2 ${
                      successful
                        ? "bg-green-500/10 text-green-400"
                        : failed
                        ? "bg-red-500/10 text-red-400"
                        : escalated
                        ? "bg-orange-500/10 text-orange-400"
                        : "bg-purple-500/10 text-purple-400"
                    }`}
                  >

                    {successful ? (

                      <Check size={16} />

                    ) : failed ? (

                      <AlertCircle size={16} />

                    ) : escalated ? (

                      <ChevronRight size={16} />

                    ) : (

                      <PhoneCall size={16} />

                    )}

                  </div>


                  <div>

                    <div className="flex flex-wrap items-center gap-2">

                      <span className="font-semibold text-white">

                        Level {entry.level}

                      </span>

                      <span className="text-xs font-semibold">

                        {entry.status}

                      </span>

                    </div>


                    <p className="mt-1 text-sm text-slate-300">

                      {entry.technicianName ||
                        "Unknown technician"}

                    </p>


                    {entry.technicianPhone && (

                      <p className="mt-1 text-xs text-slate-500">

                        {entry.technicianPhone}

                      </p>

                    )}

                  </div>

                </div>


                {entry.startedAt && (

                  <div className="flex items-center gap-1 text-xs text-slate-600">

                    <Clock size={13} />

                    {new Date(
                      entry.startedAt
                    ).toLocaleTimeString()}

                  </div>

                )}

              </div>


              {entry.response && (

                <div className="mt-3 rounded-md border border-slate-800 bg-slate-900 p-3">

                  <p className="text-xs text-slate-600">
                    Technician response
                  </p>

                  <p className="mt-1 text-sm text-slate-400">

                    {entry.response}

                  </p>

                </div>

              )}

            </div>

          );

        }
      )}

    </div>

  );

}


/*
 * ========================================
 * INCIDENT DETAILS
 * ========================================
 */

function IncidentDetails({
  incident,
  onClose,
  onResolve,
  resolving
}) {

  if (!incident) {

    return null;

  }


  const canResolve =
    incident.status !==
    "RESOLVED";


  return (

    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">

      <div className="flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-xl border border-slate-800 bg-[#0d1420] shadow-2xl">

        <div className="flex items-center justify-between border-b border-slate-800 px-6 py-4">

          <div>

            <div className="flex flex-wrap items-center gap-3">

              <h3 className="font-mono text-lg font-bold text-white">

                {incident.incidentId}

              </h3>

              <SeverityBadge
                severity={
                  incident.severity
                }
              />

              <StatusBadge
                status={
                  incident.status
                }
              />

            </div>

            <p className="mt-1 text-xs text-slate-500">
              Incident details and escalation activity
            </p>

          </div>


          <button
            onClick={onClose}
            className="rounded-lg p-2 text-slate-500 hover:bg-slate-800 hover:text-white"
          >

            <X size={20} />

          </button>

        </div>


        <div className="overflow-y-auto p-6">

          <div className="grid gap-6 lg:grid-cols-3">

            <div className="lg:col-span-2">

              <h4 className="mb-4 font-semibold text-white">
                Incident Information
              </h4>


              <div className="grid gap-3 sm:grid-cols-2">

                <InfoBox
                  icon={Server}
                  title="Device"
                  value={
                    incident.device
                  }
                />

                <InfoBox
                  icon={MapPin}
                  title="Location"
                  value={
                    incident.location
                  }
                />

                <InfoBox
                  icon={User}
                  title="Current Technician"
                  value={
                    incident.technician?.name ||
                    "Unassigned"
                  }
                />

                <InfoBox
                  icon={Activity}
                  title="Escalation Level"
                  value={`Level ${
                    incident.escalationLevel
                  }`}
                />

              </div>


              <div className="mt-4 rounded-lg border border-slate-800 bg-slate-950/50 p-4">

                <p className="text-xs text-slate-600">
                  Description
                </p>

                <p className="mt-2 text-sm leading-6 text-slate-300">

                  {incident.description}

                </p>

              </div>


              {incident.acknowledgement && (

                <div className="mt-4 rounded-lg border border-green-500/20 bg-green-500/5 p-4">

                  <div className="flex items-center gap-2">

                    <CheckCircle2
                      size={16}
                      className="text-green-400"
                    />

                    <p className="text-sm font-medium text-green-400">
                      Technician Acknowledgement
                    </p>

                  </div>

                  <p className="mt-2 text-sm text-slate-400">
                    {incident.acknowledgement}
                  </p>

                </div>

              )}


              <div className="mt-6">

                <div className="mb-4 flex items-center justify-between">

                  <h4 className="font-semibold text-white">
                    Escalation History
                  </h4>

                  <span className="text-xs text-slate-600">

                    {incident.escalationHistory?.length || 0}
                    {" "}attempt(s)

                  </span>

                </div>


                <EscalationHistory
                  history={
                    incident.escalationHistory
                  }
                />

              </div>

            </div>


            <div>

              <h4 className="mb-4 font-semibold text-white">
                Incident Status
              </h4>


              <div className="space-y-3">

                <div className="rounded-lg border border-slate-800 bg-slate-950/50 p-4">

                  <p className="text-xs text-slate-600">
                    Current status
                  </p>

                  <div className="mt-2">

                    <StatusBadge
                      status={
                        incident.status
                      }
                    />

                  </div>

                </div>


                <div className="rounded-lg border border-slate-800 bg-slate-950/50 p-4">

                  <p className="text-xs text-slate-600">
                    Incident created
                  </p>

                  <p className="mt-2 text-sm text-slate-300">

                    {incident.createdAt
                      ? new Date(
                          incident.createdAt
                        ).toLocaleString()
                      : "Unknown"}

                  </p>

                </div>


                <div className="rounded-lg border border-slate-800 bg-slate-950/50 p-4">

                  <p className="text-xs text-slate-600">
                    Escalation progress
                  </p>

                  <div className="mt-3 flex items-center gap-2">

                    {[1, 2, 3].map(
                      level => (

                        <div
                          key={level}
                          className={`flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold ${
                            level <
                            incident.escalationLevel
                              ? "bg-green-500/20 text-green-400"
                              : level ===
                                incident.escalationLevel
                              ? "bg-blue-600 text-white"
                              : "bg-slate-800 text-slate-600"
                          }`}
                        >

                          {level}

                        </div>

                      )
                    )}

                  </div>

                </div>


                {canResolve && (

                  <button
                    onClick={onResolve}
                    disabled={resolving}
                    className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg bg-green-600 px-4 py-3 text-sm font-semibold text-white hover:bg-green-500 disabled:opacity-50"
                  >

                    <CheckCircle2 size={17} />

                    {resolving
                      ? "Resolving..."
                      : "Resolve Incident"}

                  </button>

                )}

              </div>

            </div>

          </div>

        </div>

      </div>

    </div>

  );

}


/*
 * ========================================
 * INFO BOX
 * ========================================
 */

function InfoBox({
  icon: Icon,
  title,
  value
}) {

  return (

    <div className="rounded-lg border border-slate-800 bg-slate-950/50 p-4">

      <div className="flex items-center gap-2 text-xs text-slate-600">

        <Icon size={14} />

        {title}

      </div>

      <p className="mt-2 text-sm font-medium text-slate-300">

        {value}

      </p>

    </div>

  );

}


/*
 * ========================================
 * CREATE DEVICE MODAL
 * ========================================
 */

function CreateDeviceModal({
  onClose,
  onCreated
}) {

  const [form, setForm] =
    useState({

      hostname: "",

      ipAddress: "",

      deviceType: "router",

      vendor: "",

      model: "",

      location: "",

      description: "",

      monitoringEnabled: true,

      pollingInterval: 30,

      snmpVersion: "2c",

      community: "public"

    });


  const [saving, setSaving] =
    useState(false);


  function update(
    field,
    value
  ) {

    setForm(
      current => ({

        ...current,

        [field]: value

      })
    );

  }


  async function submit(
    event
  ) {

    event.preventDefault();

    setSaving(true);


    try {

      const result =
        await createDevice({

          hostname:
            form.hostname,

          ipAddress:
            form.ipAddress,

          deviceType:
            form.deviceType,

          vendor:
            form.vendor,

          model:
            form.model,

          location:
            form.location,

          description:
            form.description,

          monitoringEnabled:
            form.monitoringEnabled,

          pollingInterval:
            Number(
              form.pollingInterval
            ),

          snmp: {

            version:
              form.snmpVersion,

            community:
              form.community,

            username: "",

            securityLevel:
              "noAuthNoPriv",

            authProtocol: "",

            authKey: "",

            privProtocol: "",

            privKey: ""

          }

        });


      if (
        result.success
      ) {

        onCreated(
          result.device
        );

        onClose();

      }

    } catch (error) {

      console.error(
        "Create device error:",
        error
      );


      alert(
        error.response?.data?.message ||
        "Failed to create device."
      );

    } finally {

      setSaving(false);

    }

  }


  return (

    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">

      <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-xl border border-slate-800 bg-[#0d1420] shadow-2xl">

        <div className="flex items-center justify-between border-b border-slate-800 px-6 py-4">

          <div>

            <h3 className="font-semibold text-white">
              Add Network Device
            </h3>

            <p className="mt-1 text-xs text-slate-500">
              Register a device for monitoring.
            </p>

          </div>


          <button
            onClick={onClose}
            className="rounded-lg p-2 text-slate-500 hover:bg-slate-800 hover:text-white"
          >

            <X size={20} />

          </button>

        </div>


        <form
          onSubmit={submit}
          className="space-y-5 p-6"
        >

          <div className="grid gap-4 sm:grid-cols-2">

            <FormField
              label="Hostname"
              required
            >

              <input
                required
                value={
                  form.hostname
                }
                onChange={e =>
                  update(
                    "hostname",
                    e.target.value
                  )
                }
                placeholder="CORE-RTR-01"
                className="form-input"
              />

            </FormField>


            <FormField
              label="IP Address"
              required
            >

              <input
                required
                value={
                  form.ipAddress
                }
                onChange={e =>
                  update(
                    "ipAddress",
                    e.target.value
                  )
                }
                placeholder="192.168.1.1"
                className="form-input"
              />

            </FormField>


            <FormField label="Device Type">

              <select
                value={
                  form.deviceType
                }
                onChange={e =>
                  update(
                    "deviceType",
                    e.target.value
                  )
                }
                className="form-input"
              >

                <option value="router">
                  Router
                </option>

                <option value="switch">
                  Switch
                </option>

                <option value="firewall">
                  Firewall
                </option>

                <option value="server">
                  Server
                </option>

                <option value="access-point">
                  Access Point
                </option>

                <option value="other">
                  Other
                </option>

              </select>

            </FormField>


            <FormField label="Vendor">

              <input
                value={
                  form.vendor
                }
                onChange={e =>
                  update(
                    "vendor",
                    e.target.value
                  )
                }
                placeholder="Cisco, ZTE, Huawei..."
                className="form-input"
              />

            </FormField>


            <FormField label="Model">

              <input
                value={
                  form.model
                }
                onChange={e =>
                  update(
                    "model",
                    e.target.value
                  )
                }
                placeholder="ISR 4331"
                className="form-input"
              />

            </FormField>


            <FormField label="Location">

              <input
                value={
                  form.location
                }
                onChange={e =>
                  update(
                    "location",
                    e.target.value
                  )
                }
                placeholder="Lusaka HQ"
                className="form-input"
              />

            </FormField>

          </div>


          <FormField label="Description">

            <textarea
              rows="3"
              value={
                form.description
              }
              onChange={e =>
                update(
                  "description",
                  e.target.value
                )
              }
              placeholder="Core network router..."
              className="form-input resize-none"
            />

          </FormField>


          <div className="rounded-lg border border-slate-800 bg-slate-950/50 p-4">

            <div className="mb-4 flex items-center gap-2">

              <Settings
                size={17}
                className="text-slate-400"
              />

              <h4 className="font-medium text-white">
                Monitoring
              </h4>

            </div>


            <div className="grid gap-4 sm:grid-cols-2">

              <FormField label="Polling Interval">

                <select
                  value={
                    form.pollingInterval
                  }
                  onChange={e =>
                    update(
                      "pollingInterval",
                      e.target.value
                    )
                  }
                  className="form-input"
                >

                  <option value="10">
                    10 seconds
                  </option>

                  <option value="30">
                    30 seconds
                  </option>

                  <option value="60">
                    1 minute
                  </option>

                  <option value="300">
                    5 minutes
                  </option>

                  <option value="600">
                    10 minutes
                  </option>

                </select>

              </FormField>


              <div className="flex items-end">

                <label className="flex cursor-pointer items-center gap-3">

                  <input
                    type="checkbox"
                    checked={
                      form.monitoringEnabled
                    }
                    onChange={e =>
                      update(
                        "monitoringEnabled",
                        e.target.checked
                      )
                    }
                    className="h-4 w-4"
                  />

                  <span className="text-sm text-slate-300">
                    Enable monitoring
                  </span>

                </label>

              </div>

            </div>

          </div>


          <div className="rounded-lg border border-slate-800 bg-slate-950/50 p-4">

            <div className="mb-4 flex items-center gap-2">

              <Network
                size={17}
                className="text-slate-400"
              />

              <h4 className="font-medium text-white">
                SNMP
              </h4>

            </div>


            <div className="grid gap-4 sm:grid-cols-2">

              <FormField label="SNMP Version">

                <select
                  value={
                    form.snmpVersion
                  }
                  onChange={e =>
                    update(
                      "snmpVersion",
                      e.target.value
                    )
                  }
                  className="form-input"
                >

                  <option value="2c">
                    SNMP v2c
                  </option>

                  <option value="1">
                    SNMP v1
                  </option>

                  <option value="3">
                    SNMP v3
                  </option>

                </select>

              </FormField>


              <FormField label="Community">

                <input
                  value={
                    form.community
                  }
                  onChange={e =>
                    update(
                      "community",
                      e.target.value
                    )
                  }
                  placeholder="public"
                  className="form-input"
                />

              </FormField>

            </div>


            <p className="mt-3 text-xs leading-5 text-slate-600">

              SNMP is optional. Devices that do not support SNMP,
              such as some ISP-provided routers, can still be
              monitored using connectivity and TCP port checks.

            </p>

          </div>


          <div className="flex justify-end gap-3 pt-2">

            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-slate-700 px-4 py-2 text-sm hover:bg-slate-800"
            >
              Cancel
            </button>


            <button
              type="submit"
              disabled={saving}
              className="flex items-center gap-2 rounded-lg bg-blue-600 px-5 py-2 text-sm font-semibold text-white hover:bg-blue-500 disabled:opacity-50"
            >

              <Plus size={17} />

              {saving
                ? "Adding..."
                : "Add Device"}

            </button>

          </div>

        </form>

      </div>

    </div>

  );

}


/*
 * ========================================
 * FORM FIELD
 * ========================================
 */

function FormField({
  label,
  required,
  children
}) {

  return (

    <div>

      <label className="mb-2 block text-xs font-medium text-slate-400">

        {label}

        {required && (
          <span className="ml-1 text-red-400">
            *
          </span>
        )}

      </label>

      {children}

    </div>

  );

}


/*
 * ========================================
 * DEVICE DETAILS MODAL
 * ========================================
 */

function DeviceDetails({
  device,
  onClose,
  onRefresh
}) {

  const [port, setPort] =
    useState("80");

  const [testing, setTesting] =
    useState(false);

  const [testResult, setTestResult] =
    useState(null);


  async function testPort() {

    if (!device) {
      return;
    }


    setTesting(true);

    setTestResult(null);


    try {

      const result =
        await testDevicePort(
          device.deviceId,
          Number(port)
        );


      setTestResult(
        result
      );


      if (onRefresh) {
        onRefresh();
      }

    } catch (error) {

      setTestResult({

        success: false,

        message:
          error.response?.data?.message ||
          "Port test failed."

      });

    } finally {

      setTesting(false);

    }

  }


  async function testConnectivity() {

    setTesting(true);

    setTestResult(null);


    try {

      const result =
        await testDeviceConnectivity(
          device.deviceId,
          Number(port)
        );


      setTestResult(
        result
      );


      if (onRefresh) {
        onRefresh();
      }

    } catch (error) {

      setTestResult({

        success: false,

        message:
          error.response?.data?.message ||
          "Connectivity test failed."

      });

    } finally {

      setTesting(false);

    }

  }


  return (

    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">

      <div className="max-h-[90vh] w-full max-w-4xl overflow-y-auto rounded-xl border border-slate-800 bg-[#0d1420] shadow-2xl">

        <div className="flex items-center justify-between border-b border-slate-800 px-6 py-4">

          <div className="flex items-center gap-3">

            <div className="rounded-lg bg-slate-800 p-2">

              <DeviceIcon
                type={
                  device.deviceType
                }
              />

            </div>


            <div>

              <h3 className="font-semibold text-white">

                {device.hostname}

              </h3>

              <p className="font-mono text-xs text-slate-500">

                {device.deviceId}

              </p>

            </div>

          </div>


          <button
            onClick={onClose}
            className="rounded-lg p-2 text-slate-500 hover:bg-slate-800 hover:text-white"
          >

            <X size={20} />

          </button>

        </div>


        <div className="p-6">

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">

            <InfoBox
              icon={Network}
              title="IP Address"
              value={
                device.ipAddress
              }
            />

            <InfoBox
              icon={Server}
              title="Vendor"
              value={
                device.vendor ||
                "Unknown"
              }
            />

            <InfoBox
              icon={Settings}
              title="Model"
              value={
                device.model ||
                "Unknown"
              }
            />

            <InfoBox
              icon={MapPin}
              title="Location"
              value={
                device.location ||
                "Unknown"
              }
            />

          </div>


          <div className="mt-6 grid gap-6 lg:grid-cols-2">

            <div className="rounded-xl border border-slate-800 bg-slate-950/50 p-5">

              <h4 className="font-semibold text-white">
                Device Status
              </h4>


              <div className="mt-4 flex items-center justify-between">

                <DeviceStatusBadge
                  status={
                    device.status
                  }
                />

                <span className="text-xs text-slate-600">

                  Monitoring{" "}

                  {device.monitoringEnabled
                    ? "Enabled"
                    : "Disabled"}

                </span>

              </div>


              <div className="mt-5 space-y-3">

                <div>

                  <p className="text-xs text-slate-600">
                    Last poll
                  </p>

                  <p className="mt-1 text-sm text-slate-300">

                    {device.lastPollAt
                      ? new Date(
                          device.lastPollAt
                        ).toLocaleString()
                      : "Never"}

                  </p>

                </div>


                <div>

                  <p className="text-xs text-slate-600">
                    Last seen
                  </p>

                  <p className="mt-1 text-sm text-slate-300">

                    {device.lastSeenAt
                      ? new Date(
                          device.lastSeenAt
                        ).toLocaleString()
                      : "Never"}

                  </p>

                </div>


                <div>

                  <p className="text-xs text-slate-600">
                    Polling interval
                  </p>

                  <p className="mt-1 text-sm text-slate-300">

                    {device.pollingInterval ||
                      30}
                    {" "}seconds

                  </p>

                </div>

              </div>

            </div>


            <div className="rounded-xl border border-slate-800 bg-slate-950/50 p-5">

              <h4 className="font-semibold text-white">
                Test Port
              </h4>

              <p className="mt-1 text-xs text-slate-600">
                Check whether a TCP service is available.
              </p>


              <div className="mt-4 flex gap-2">

                <input
                  type="number"
                  min="1"
                  max="65535"
                  value={port}
                  onChange={e =>
                    setPort(
                      e.target.value
                    )
                  }
                  className="form-input"
                />


                <button
                  onClick={testPort}
                  disabled={testing}
                  className="rounded-lg bg-blue-600 px-4 text-sm font-semibold text-white hover:bg-blue-500 disabled:opacity-50"
                >

                  Test

                </button>

              </div>


              <button
                onClick={
                  testConnectivity
                }
                disabled={testing}
                className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg border border-slate-700 px-4 py-2 text-sm hover:bg-slate-800 disabled:opacity-50"
              >

                <Wifi size={15} />

                Test Connectivity

              </button>


              {testResult && (

                <div className="mt-4 rounded-lg border border-slate-800 bg-slate-900 p-4">

                  <p className="text-xs text-slate-500">
                    Test Result
                  </p>

                  <p
                    className={`mt-2 text-sm font-semibold ${
                      testResult.result?.state ===
                      "OPEN"
                        ? "text-green-400"
                        : "text-red-400"
                    }`}
                  >

                    {testResult.result?.state ||
                      testResult.message ||
                      "Unknown"}

                  </p>


                  {testResult.result?.message && (

                    <p className="mt-1 text-xs text-slate-500">

                      {testResult.result.message}

                    </p>

                  )}

                </div>

              )}

            </div>

          </div>


          <div className="mt-6 rounded-xl border border-slate-800 bg-slate-950/50 p-5">

            <div className="flex items-center justify-between">

              <div>

                <h4 className="font-semibold text-white">
                  Monitored Interfaces / Ports
                </h4>

                <p className="mt-1 text-xs text-slate-600">
                  Ports currently known to NetEscalate.
                </p>

              </div>


              <Network
                size={18}
                className="text-slate-500"
              />

            </div>


            {!Array.isArray(
              device.interfaces
            ) ||
            device.interfaces.length === 0 ? (

              <div className="mt-4 rounded-lg border border-dashed border-slate-800 p-6 text-center">

                <p className="text-sm text-slate-500">
                  No ports have been tested yet.
                </p>

              </div>

            ) : (

              <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">

                {device.interfaces.map(
                  (item, index) => (

                    <div
                      key={index}
                      className="rounded-lg border border-slate-800 bg-slate-900 p-4"
                    >

                      <div className="flex items-center justify-between">

                        <span className="font-mono text-sm text-white">

                          Port {item.port}

                        </span>


                        <StatusBadge
                          status={
                            item.status
                          }
                        />

                      </div>


                      {item.lastCheckedAt && (

                        <p className="mt-2 text-xs text-slate-600">

                          Checked{" "}

                          {new Date(
                            item.lastCheckedAt
                          ).toLocaleString()}

                        </p>

                      )}

                    </div>

                  )
                )}

              </div>

            )}

          </div>

        </div>

      </div>

    </div>

  );

}


/*
 * ========================================
 * DEVICE LIST
 * ========================================
 */

function DeviceList({
  devices,
  loading,
  onSelect,
  onRefresh,
  onCreate
}) {

  const [search, setSearch] =
    useState("");


 const filtered =
  devices
    .filter(
      device => {

        const text =
          `${device.hostname || ""}
           ${device.ipAddress || ""}
           ${device.vendor || ""}
           ${device.location || ""}`
            .toLowerCase();

        return text.includes(
          search.toLowerCase()
        );

      }
    )
    .sort(
      (a, b) => {

        const statusOrder = {
          DOWN: 0,
          DEGRADED: 1,
          UNKNOWN: 2,
          UP: 3
        };

        return (
          (statusOrder[a.status] ?? 2) -
          (statusOrder[b.status] ?? 2)
        );

      }
    );


  return (

    <div className="overflow-hidden rounded-xl border border-slate-800 bg-slate-900/60">

      <div className="flex flex-col gap-4 border-b border-slate-800 px-5 py-4 md:flex-row md:items-center md:justify-between">

        <div>

          <h3 className="font-semibold text-white">
            Network Devices
          </h3>

          <p className="text-xs text-slate-500">
            Devices monitored by NetEscalate
          </p>

        </div>


        <div className="flex gap-2">

          <div className="relative">

            <Search
              size={15}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-600"
            />

            <input
              value={search}
              onChange={e =>
                setSearch(
                  e.target.value
                )
              }
              placeholder="Search devices..."
              className="rounded-lg border border-slate-700 bg-slate-950 py-2 pl-9 pr-3 text-sm outline-none focus:border-blue-500"
            />

          </div>


          <button
            onClick={onRefresh}
            className="rounded-lg border border-slate-700 bg-slate-900 px-3 hover:bg-slate-800"
          >

            <RefreshCw size={16} />

          </button>


          <button
            onClick={onCreate}
            className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-500"
          >

            <Plus size={16} />

            Add Device

          </button>

        </div>

      </div>


      {loading ? (

        <div className="p-10 text-center text-sm text-slate-500">
          Loading devices...
        </div>

      ) : filtered.length === 0 ? (

        <div className="p-10 text-center">

          <Server
            size={40}
            className="mx-auto text-slate-700"
          />

          <p className="mt-3 font-medium text-white">
            No devices found
          </p>

          <p className="mt-1 text-sm text-slate-500">
            Add a device to start monitoring your infrastructure.
          </p>

        </div>

      ) : (

        <div className="divide-y divide-slate-800">

          {filtered.map(
            device => (

              <button
                key={
                  device.deviceId
                }
                onClick={() =>
                  onSelect(device)
                }
                className="flex w-full flex-col gap-4 p-5 text-left transition hover:bg-slate-800/30 md:flex-row md:items-center md:justify-between"
              >

                <div className="flex items-start gap-4">

                  <div className="rounded-lg bg-slate-800 p-3">

                    <DeviceIcon
                      type={
                        device.deviceType
                      }
                    />

                  </div>


                  <div>

                    <div className="flex flex-wrap items-center gap-3">

                      <span className="font-semibold text-white">

                        {device.hostname}

                      </span>

                      <DeviceStatusBadge
                        status={
                          device.status
                        }
                      />

                    </div>


                    <p className="mt-1 font-mono text-xs text-slate-500">

                      {device.ipAddress}

                    </p>


                    <p className="mt-2 text-sm text-slate-400">

                      {device.vendor ||
                        "Unknown vendor"}

                      {" "}

                      {device.model &&
                        `• ${device.model}`}

                    </p>

                  </div>

                </div>


                <div className="flex items-center gap-6 md:min-w-[400px] md:justify-end">

                  <div>

                    <p className="mb-1 text-xs text-slate-600">
                      Location
                    </p>

                    <p className="text-sm text-slate-300">

                      {device.location ||
                        "Unknown"}

                    </p>

                  </div>


                  <div>

                    <p className="mb-1 text-xs text-slate-600">
                      Last Poll
                    </p>

                    <p className="text-sm text-slate-300">

                      {device.lastPollAt
                        ? new Date(
                            device.lastPollAt
                          ).toLocaleTimeString()
                        : "Never"}

                    </p>

                  </div>


                  <ChevronRight
                    size={18}
                    className="text-slate-600"
                  />

                </div>

              </button>

            )
          )}

        </div>

      )}

    </div>

  );

}


/*
 * ========================================
 * MAIN APP
 * ========================================
 */

function App() {

  const [incidents, setIncidents] =
    useState([]);

  const [technicians, setTechnicians] =
    useState([]);

  const [devices, setDevices] =
    useState([]);

  const [loading, setLoading] =
    useState(true);

  const [devicesLoading, setDevicesLoading] =
    useState(true);

  const [showCreate, setShowCreate] =
    useState(false);

  const [showCreateDevice, setShowCreateDevice] =
    useState(false);

  const [selectedIncident, setSelectedIncident] =
    useState(null);

  const [selectedDevice, setSelectedDevice] =
    useState(null);

  const [resolving, setResolving] =
    useState(false);

  const [socketConnected, setSocketConnected] =
    useState(false);

  const [activeSection, setActiveSection] =
    useState("incidents");


  const [form, setForm] =
    useState({

      device: "",

      location: "",

      severity: "medium",

      description: "",

      technicianId: ""

    });


  /*
   * ========================================
   * LOAD INCIDENTS
   * ========================================
   */

  async function loadIncidents() {

    try {

      setLoading(true);

      const data =
        await getIncidents();

      if (data.success) {

        setIncidents(
          data.incidents
        );

      }

    } catch (error) {

      console.error(
        "Failed to load incidents:",
        error
      );

    } finally {

      setLoading(false);

    }

  }


  /*
   * ========================================
   * LOAD TECHNICIANS
   * ========================================
   */

  async function loadTechnicians() {

    try {

      const data =
        await getTechnicians();

      if (data.success) {

        setTechnicians(
          data.technicians
        );

      }

    } catch (error) {

      console.error(
        "Failed to load technicians:",
        error
      );

    }

  }


  /*
   * ========================================
   * LOAD DEVICES
   * ========================================
   */

  async function loadDevices() {

    try {

      setDevicesLoading(true);

      const data =
        await getDevices();

      if (data.success) {

        setDevices(
          data.devices
        );

      }

    } catch (error) {

      console.error(
        "Failed to load devices:",
        error
      );

    } finally {

      setDevicesLoading(false);

    }

  }


  /*
   * ========================================
   * INITIAL LOAD
   * ========================================
   */

  useEffect(() => {

    loadIncidents();

    loadTechnicians();

    loadDevices();

  }, []);


  /*
   * ========================================
   * SOCKET.IO
   * ========================================
   */

  useEffect(() => {

    const socket =
      io(SOCKET_URL, {

        transports: [
          "websocket",
          "polling"
        ]

      });


    socket.on(
      "connect",
      () => {

        setSocketConnected(true);

      }
    );


    socket.on(
      "disconnect",
      () => {

        setSocketConnected(false);

      }
    );


    socket.on(
      "incident_created",
      incident => {

        setIncidents(
          current => {

            if (
              current.some(
                item =>
                  item.incidentId ===
                  incident.incidentId
              )
            ) {

              return current;

            }


            return [
              incident,
              ...current
            ];

          }
        );

      }
    );


    socket.on(
      "incident_updated",
      incident => {

        setIncidents(
          current =>
            current.some(
              item =>
                item.incidentId ===
                incident.incidentId
            )
              ? current.map(
                  item =>
                    item.incidentId ===
                    incident.incidentId
                      ? incident
                      : item
                )
              : [
                  incident,
                  ...current
                ]
        );


        setSelectedIncident(
          current =>
            current?.incidentId ===
            incident.incidentId
              ? incident
              : current
        );

      }
    );


    /*
     * Device updates.
     *
     * This will be used by the monitoring
     * engine we're adding next.
     */

    socket.on(
      "device_updated",
      device => {

        setDevices(
          current => {

            const exists =
              current.some(
                item =>
                  item.deviceId ===
                  device.deviceId
              );


            if (!exists) {

              return [
                device,
                ...current
              ];

            }


            return current.map(
              item =>
                item.deviceId ===
                device.deviceId
                  ? device
                  : item
            );

          }
        );


        setSelectedDevice(
          current =>
            current?.deviceId ===
            device.deviceId
              ? device
              : current
        );

      }
    );


    return () => {

      socket.disconnect();

    };

  }, []);


  /*
   * ========================================
   * FALLBACK POLLING
   * ========================================
   */

  useEffect(() => {

    const interval =
      setInterval(
        () => {

          if (!socketConnected) {

            loadIncidents();

            loadDevices();

          }

        },
        10000
      );


    return () => {

      clearInterval(
        interval
      );

    };

  }, [socketConnected]);


  /*
   * ========================================
   * CREATE INCIDENT
   * ========================================
   */

  async function handleCreateIncident(
    event
  ) {

    event.preventDefault();


    try {

      let technician =
        technicians.find(
          item =>
            item.technicianId ===
            form.technicianId
        );


      if (!technician) {

        technician =
          technicians.find(
            item =>
              item.level === 1 &&
              item.active
          );

      }


      if (!technician) {

        alert(
          "No active technician is available."
        );

        return;

      }


      await createIncident({

        device:
          form.device,

        location:
          form.location,

        severity:
          form.severity,

        description:
          form.description,

        technician: {

          id:
            technician.technicianId,

          name:
            technician.name,

          phone:
            technician.phone

        }

      });


      setForm({

        device: "",

        location: "",

        severity: "medium",

        description: "",

        technicianId: ""

      });


      setShowCreate(
        false
      );

    } catch (error) {

      console.error(
        "Failed to create incident:",
        error
      );


      alert(
        error.response?.data?.message ||
        "Failed to create incident."
      );

    }

  }


  /*
   * ========================================
   * RESOLVE INCIDENT
   * ========================================
   */

  async function handleResolveIncident() {

    if (!selectedIncident) {

      return;

    }


    try {

      setResolving(true);


      const data =
        await resolveIncident(
          selectedIncident.incidentId
        );


      if (data.success) {

        setIncidents(
          current =>
            current.map(
              incident =>
                incident.incidentId ===
                selectedIncident.incidentId
                  ? data.incident
                  : incident
            )
        );


        setSelectedIncident(
          data.incident
        );

      }

    } catch (error) {

      console.error(
        "Failed to resolve incident:",
        error
      );


      alert(
        error.response?.data?.message ||
        "Failed to resolve incident."
      );

    } finally {

      setResolving(false);

    }

  }


  /*
   * ========================================
   * DEVICE CREATED
   * ========================================
   */

  function handleDeviceCreated(
    device
  ) {

    setDevices(
      current => {

        if (
          current.some(
            item =>
              item.deviceId ===
              device.deviceId
          )
        ) {

          return current;

        }


        return [
          device,
          ...current
        ];

      }
    );

  }


  /*
   * ========================================
   * STATISTICS
   * ========================================
   */

  const active =
    incidents.filter(
      incident =>
        incident.status !==
        "RESOLVED"
    );


  const critical =
    incidents.filter(
      incident =>
        incident.severity ===
          "critical" &&
        incident.status !==
          "RESOLVED"
    );


  const calling =
    incidents.filter(
      incident =>
        incident.status ===
        "CALLING"
    );


  const acknowledged =
    incidents.filter(
      incident =>
        incident.status ===
        "ACKNOWLEDGED"
    );


  const onlineDevices =
    devices.filter(
      device =>
        device.status ===
        "UP"
    );


  const offlineDevices =
    devices.filter(
      device =>
        device.status ===
        "DOWN"
    );


  return (

    <div className="min-h-screen bg-[#070b12] text-slate-200">


      {/* ====================================
          HEADER
          ==================================== */}

      <header className="border-b border-slate-800 bg-[#0b111b]">

        <div className="mx-auto flex max-w-[1600px] items-center justify-between px-6 py-4">

          <div className="flex items-center gap-3">

            <div className="rounded-lg bg-blue-600 p-2">

              <Activity size={22} />

            </div>


            <div>

              <h1 className="text-lg font-bold tracking-wide">
                NetEscalate
              </h1>

              <p className="text-xs text-slate-500">
                AI Infrastructure Incident Response
              </p>

            </div>

          </div>


          <div className="flex items-center gap-4">

            <div className="flex items-center gap-2 text-sm">

              <span
                className={`h-2 w-2 rounded-full ${
                  socketConnected
                    ? "bg-green-400"
                    : "bg-yellow-400"
                }`}
              />

              <span
                className={
                  socketConnected
                    ? "text-green-400"
                    : "text-yellow-400"
                }
              >

                {socketConnected
                  ? "Live"
                  : "Reconnecting"}

              </span>

            </div>

          </div>

        </div>

      </header>


      <main className="mx-auto max-w-[1600px] p-6">


        {/* ====================================
            NAVIGATION
            ==================================== */}

        <div className="mb-6 flex gap-2 border-b border-slate-800">

          <button
            onClick={() =>
              setActiveSection(
                "incidents"
              )
            }
            className={`flex items-center gap-2 border-b-2 px-4 py-3 text-sm font-medium ${
              activeSection ===
              "incidents"
                ? "border-blue-500 text-blue-400"
                : "border-transparent text-slate-500 hover:text-white"
            }`}
          >

            <Activity size={16} />

            Incidents

          </button>


          <button
            onClick={() =>
              setActiveSection(
                "devices"
              )
            }
            className={`flex items-center gap-2 border-b-2 px-4 py-3 text-sm font-medium ${
              activeSection ===
              "devices"
                ? "border-blue-500 text-blue-400"
                : "border-transparent text-slate-500 hover:text-white"
            }`}
          >

            <Server size={16} />

            Devices

          </button>

        </div>


        {/* ====================================
            INCIDENT SECTION
            ==================================== */}

        {activeSection ===
          "incidents" && (

          <>

            <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">

              <div>

                <h2 className="text-2xl font-bold text-white">
                  Operations Dashboard
                </h2>

                <p className="mt-1 text-sm text-slate-500">
                  Monitor network incidents and AI escalation activity.
                </p>

              </div>


              <div className="flex gap-3">

                <button
                  onClick={
                    loadIncidents
                  }
                  className="flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-900 px-4 py-2 text-sm hover:bg-slate-800"
                >

                  <RefreshCw size={16} />

                  Refresh

                </button>


                <button
                  onClick={() =>
                    setShowCreate(
                      true
                    )
                  }
                  className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-500"
                >

                  <Plus size={17} />

                  Create Incident

                </button>

              </div>

            </div>


            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">

              <StatCard
                title="Active Incidents"
                value={
                  active.length
                }
                icon={Activity}
                description="Currently requiring attention"
              />


              <StatCard
                title="Critical"
                value={
                  critical.length
                }
                icon={AlertTriangle}
                description="Highest severity incidents"
              />


              <StatCard
                title="Calls / Escalation"
                value={
                  calling.length
                }
                icon={Phone}
                description="Currently being escalated"
              />


              <StatCard
                title="Acknowledged"
                value={
                  acknowledged.length
                }
                icon={CheckCircle2}
                description="Technician accepted"
              />

            </div>


            <div className="mt-8 overflow-hidden rounded-xl border border-slate-800 bg-slate-900/60">

              <div className="flex items-center justify-between border-b border-slate-800 px-5 py-4">

                <div>

                  <h3 className="font-semibold text-white">
                    Incidents
                  </h3>

                  <p className="text-xs text-slate-500">
                    Real-time escalation updates
                  </p>

                </div>


                <Server
                  size={20}
                  className="text-slate-500"
                />

              </div>


              {loading ? (

                <div className="p-10 text-center text-sm text-slate-500">
                  Loading incidents...
                </div>

              ) : incidents.length === 0 ? (

                <div className="p-10 text-center">

                  <CheckCircle2
                    size={40}
                    className="mx-auto text-green-500"
                  />

                  <p className="mt-3 font-medium text-white">
                    No incidents
                  </p>

                  <p className="mt-1 text-sm text-slate-500">
                    Your infrastructure is currently clear.
                  </p>

                </div>

              ) : (

                <div className="divide-y divide-slate-800">

                  {incidents.map(
                    incident => (

                      <button
                        key={
                          incident.incidentId
                        }
                        onClick={() =>
                          setSelectedIncident(
                            incident
                          )
                        }
                        className="flex w-full flex-col gap-4 p-5 text-left transition hover:bg-slate-800/30 md:flex-row md:items-center md:justify-between"
                      >

                        <div className="flex items-start gap-4">

                          <div className="mt-1 rounded-lg bg-slate-800 p-2">

                            <Server
                              size={18}
                              className="text-slate-400"
                            />

                          </div>


                          <div>

                            <div className="flex flex-wrap items-center gap-3">

                              <span className="font-mono text-sm font-semibold text-white">

                                {incident.incidentId}

                              </span>


                              <SeverityBadge
                                severity={
                                  incident.severity
                                }
                              />

                            </div>


                            <p className="mt-1 font-medium text-slate-300">
                              {incident.device}
                            </p>


                            <p className="mt-1 text-sm text-slate-500">
                              {incident.location}
                            </p>


                            <p className="mt-2 max-w-xl text-sm text-slate-400">
                              {incident.description}
                            </p>

                          </div>

                        </div>


                        <div className="flex items-center gap-6 md:min-w-[420px] md:justify-end">

                          <div>

                            <p className="mb-1 text-xs text-slate-600">
                              Technician
                            </p>

                            <p className="text-sm text-slate-300">
                              {incident.technician?.name ||
                                "Unassigned"}
                            </p>

                          </div>


                          <div>

                            <p className="mb-1 text-xs text-slate-600">
                              Status
                            </p>

                            <StatusBadge
                              status={
                                incident.status
                              }
                            />

                          </div>


                          <div>

                            <p className="mb-1 text-xs text-slate-600">
                              Escalation
                            </p>

                            <p className="text-sm text-slate-300">

                              Level{" "}
                              {incident.escalationLevel}

                            </p>

                          </div>


                          <ChevronRight
                            size={18}
                            className="text-slate-600"
                          />

                        </div>

                      </button>

                    )
                  )}

                </div>

              )}

            </div>

          </>

        )}


        {/* ====================================
            DEVICES SECTION
            ==================================== */}

        {activeSection ===
          "devices" && (

          <>

            <div className="mb-6">

              <h2 className="text-2xl font-bold text-white">
                Network Devices
              </h2>

              <p className="mt-1 text-sm text-slate-500">
                Monitor routers, switches, firewalls, servers and other infrastructure.
              </p>

            </div>


            <div className="mb-6 grid gap-4 md:grid-cols-3">

              <StatCard
                title="Total Devices"
                value={
                  devices.length
                }
                icon={Server}
                description="Registered infrastructure"
              />


              <StatCard
                title="Online"
                value={
                  onlineDevices.length
                }
                icon={Wifi}
                description="Currently reachable"
              />


              <StatCard
                title="Offline"
                value={
                  offlineDevices.length
                }
                icon={WifiOff}
                description="Currently unreachable"
              />

            </div>


            <DeviceList
              devices={
                devices
              }
              loading={
                devicesLoading
              }
              onSelect={
                setSelectedDevice
              }
              onRefresh={
                loadDevices
              }
              onCreate={() =>
                setShowCreateDevice(
                  true
                )
              }
            />

          </>

        )}

      </main>


      {/* ====================================
          CREATE INCIDENT MODAL
          ==================================== */}

      {showCreate && (

        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">

          <div className="w-full max-w-lg rounded-xl border border-slate-800 bg-[#0d1420] shadow-2xl">

            <div className="flex items-center justify-between border-b border-slate-800 px-6 py-4">

              <div>

                <h3 className="font-semibold text-white">
                  Create Network Incident
                </h3>

                <p className="text-xs text-slate-500">
                  This will immediately start the escalation workflow.
                </p>

              </div>


              <button
                onClick={() =>
                  setShowCreate(
                    false
                  )
                }
                className="text-slate-500 hover:text-white"
              >

                <X size={20} />

              </button>

            </div>


            <form
              onSubmit={
                handleCreateIncident
              }
              className="space-y-4 p-6"
            >

              <input
                required
                placeholder="Device e.g. CORE-RTR-01"
                value={
                  form.device
                }
                onChange={e =>
                  setForm({
                    ...form,
                    device:
                      e.target.value
                  })
                }
                className="form-input"
              />


              <input
                required
                placeholder="Location"
                value={
                  form.location
                }
                onChange={e =>
                  setForm({
                    ...form,
                    location:
                      e.target.value
                  })
                }
                className="form-input"
              />


              <select
                value={
                  form.severity
                }
                onChange={e =>
                  setForm({
                    ...form,
                    severity:
                      e.target.value
                  })
                }
                className="form-input"
              >

                <option value="low">
                  Low
                </option>

                <option value="medium">
                  Medium
                </option>

                <option value="high">
                  High
                </option>

                <option value="critical">
                  Critical
                </option>

              </select>


              <textarea
                required
                rows="4"
                placeholder="Describe the incident..."
                value={
                  form.description
                }
                onChange={e =>
                  setForm({
                    ...form,
                    description:
                      e.target.value
                  })
                }
                className="form-input resize-none"
              />


              <div>

                <label className="mb-2 block text-xs text-slate-500">
                  Initial Technician
                </label>


                <select
                  value={
                    form.technicianId
                  }
                  onChange={e =>
                    setForm({
                      ...form,
                      technicianId:
                        e.target.value
                    })
                  }
                  className="form-input"
                >

                  <option value="">
                    Automatic Level 1 Technician
                  </option>


                  {technicians
                    .filter(
                      technician =>
                        technician.active
                    )
                    .map(
                      technician => (

                        <option
                          key={
                            technician.technicianId
                          }
                          value={
                            technician.technicianId
                          }
                        >

                          Level{" "}
                          {technician.level}
                          {" - "}
                          {technician.name}

                        </option>

                      )
                    )}

                </select>

              </div>


              <div className="flex justify-end gap-3 pt-3">

                <button
                  type="button"
                  onClick={() =>
                    setShowCreate(
                      false
                    )
                  }
                  className="rounded-lg border border-slate-700 px-4 py-2 text-sm hover:bg-slate-800"
                >
                  Cancel
                </button>


                <button
                  type="submit"
                  className="rounded-lg bg-blue-600 px-5 py-2 text-sm font-semibold text-white hover:bg-blue-500"
                >
                  Create & Escalate
                </button>

              </div>

            </form>

          </div>

        </div>

      )}


      {/* ====================================
          CREATE DEVICE
          ==================================== */}

      {showCreateDevice && (

        <CreateDeviceModal
          onClose={() =>
            setShowCreateDevice(
              false
            )
          }
          onCreated={
            handleDeviceCreated
          }
        />

      )}


      {/* ====================================
          INCIDENT DETAILS
          ==================================== */}

      {selectedIncident && (

        <IncidentDetails
          incident={
            selectedIncident
          }
          onClose={() =>
            setSelectedIncident(
              null
            )
          }
          onResolve={
            handleResolveIncident
          }
          resolving={
            resolving
          }
        />

      )}


      {/* ====================================
          DEVICE DETAILS
          ==================================== */}

      {selectedDevice && (

        <DeviceDetails
          device={
            selectedDevice
          }
          onClose={() =>
            setSelectedDevice(
              null
            )
          }
          onRefresh={
            async () => {

              await loadDevices();

              const result =
                await getDevices();

              if (
                result.success
              ) {

                const updated =
                  result.devices.find(
                    device =>
                      device.deviceId ===
                      selectedDevice.deviceId
                  );


                if (updated) {

                  setSelectedDevice(
                    updated
                  );

                }

              }

            }
          }
        />

      )}

    </div>

  );

}


export default App;