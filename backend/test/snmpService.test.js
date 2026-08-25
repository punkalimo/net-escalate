import test from "node:test";
import assert from "node:assert/strict";

import {
  decodeDuplex,
  decodeSnmpBinary,
  decodeSnmpText,
  normaliseSnmpVersion,
  speedFromValues
} from "../src/services/snmpService.js";

test("decodes textual SNMP buffers as UTF-8", () => {
  assert.equal(decodeSnmpText(Buffer.from("FastEthernet1/0")), "FastEthernet1/0");
  assert.equal(decodeSnmpText(Buffer.from("R1\0\0")), "R1");
});

test("keeps non-printable SNMP buffers as hexadecimal", () => {
  assert.equal(decodeSnmpText(Buffer.from([0x00, 0xff, 0x10])), "00ff10");
});

test("keeps binary SNMP values suitable for MAC addresses as hex", () => {
  assert.equal(decodeSnmpBinary(Buffer.from([0x00, 0x11, 0x22, 0xaa, 0xbb, 0xcc])), "001122aabbcc");
});

test("normalises supported SNMP versions", () => {
  assert.equal(normaliseSnmpVersion("v1"), "1");
  assert.equal(normaliseSnmpVersion(" 2c "), "2c");
  assert.equal(normaliseSnmpVersion("V3"), "3");
  assert.throws(() => normaliseSnmpVersion("v9"), /Unsupported SNMP version/);
});

test("prefers ifHighSpeed and converts legacy ifSpeed to Mbps", () => {
  assert.equal(speedFromValues(100, 100000000), 100);
  assert.equal(speedFromValues(0, 100000000), 100);
  assert.equal(speedFromValues(null, null), null);
});

test("maps SNMP duplex enum values", () => {
  assert.equal(decodeDuplex(1), "UNKNOWN");
  assert.equal(decodeDuplex(2), "HALF");
  assert.equal(decodeDuplex(3), "FULL");
  assert.equal(decodeDuplex(99), "UNKNOWN");
});
