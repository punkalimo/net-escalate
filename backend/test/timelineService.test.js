import test from "node:test";
import assert from "node:assert/strict";

import { buildTimelineEvent, pushTimelineEvent, TIMELINE_EVENT_TYPES } from "../src/services/timelineService.js";

test("buildTimelineEvent stamps type, message, actor, metadata and a timestamp", () => {
  const event = buildTimelineEvent("INCIDENT_CREATED", "Incident created.", { actor: "system", metadata: { foo: "bar" } });
  assert.equal(event.type, "INCIDENT_CREATED");
  assert.equal(event.message, "Incident created.");
  assert.equal(event.actor, "system");
  assert.deepEqual(event.metadata, { foo: "bar" });
  assert.ok(event.at instanceof Date);
});

test("buildTimelineEvent defaults actor to system and metadata to null", () => {
  const event = buildTimelineEvent("SEVERITY_CHANGED", "Severity escalated.");
  assert.equal(event.actor, "system");
  assert.equal(event.metadata, null);
});

test("every event type used across the codebase is in TIMELINE_EVENT_TYPES", () => {
  for (const type of ["ALERT_RECEIVED", "ALERT_CORRELATED", "INCIDENT_CREATED", "SEVERITY_CHANGED", "NOTIFICATION_SENT", "INCIDENT_ACKNOWLEDGED", "ENGINEER_COMMENT", "ESCALATION_TRIGGERED", "DEVICE_RECOVERY_DETECTED", "INCIDENT_RESOLVED", "MERGED", "UNMERGED"]) {
    assert.ok(TIMELINE_EVENT_TYPES.includes(type), `${type} must be a recognized timeline event type`);
  }
});

test("pushTimelineEvent appends to an existing timeline array in chronological (append) order", () => {
  const incident = { timeline: [buildTimelineEvent("INCIDENT_CREATED", "Created.")] };
  pushTimelineEvent(incident, "INCIDENT_ACKNOWLEDGED", "Acknowledged.", { actor: "Jane" });
  assert.equal(incident.timeline.length, 2);
  assert.equal(incident.timeline[1].type, "INCIDENT_ACKNOWLEDGED");
  assert.equal(incident.timeline[1].actor, "Jane");
});

test("pushTimelineEvent initializes a missing timeline array rather than throwing", () => {
  const incident = {};
  pushTimelineEvent(incident, "INCIDENT_CREATED", "Created.");
  assert.equal(incident.timeline.length, 1);
});
