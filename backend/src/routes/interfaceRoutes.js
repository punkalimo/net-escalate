const express = require('express');
const router = express.Router();
const Device = require('../models/Device');
const { discoverInterfaces } = require('../services/snmpService');

router.post('/:deviceId/discover', async (req, res) => {
  try {
    const device = await Device.findById(req.params.deviceId);
    if (!device) return res.status(404).json({ message: 'Device not found' });

    const interfaces = await discoverInterfaces({
      host: device.ipAddress || device.host,
      community: device.snmpCommunity || device.community || 'public',
      port: device.snmpPort || 161,
      version: device.snmpVersion || '2c'
    });

    device.interfaces = interfaces;
    await device.save();
    res.json(interfaces);
  } catch (error) {
    console.error('Interface discovery failed:', error);
    res.status(500).json({ message: error.message || 'Interface discovery failed' });
  }
});

router.get('/:deviceId', async (req, res) => {
  try {
    const device = await Device.findById(req.params.deviceId).select('interfaces');
    if (!device) return res.status(404).json({ message: 'Device not found' });
    res.json(device.interfaces || []);
  } catch (error) {
    res.status(500).json({ message: error.message || 'Failed to get interfaces' });
  }
});

module.exports = router;
