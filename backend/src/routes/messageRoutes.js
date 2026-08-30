import express from "express";
import path from "node:path";
import fs from "node:fs";
import crypto from "node:crypto";
import multer from "multer";
import mongoose from "mongoose";
import Message from "../models/Message.js";
import Technician from "../models/Technician.js";
import { emitToRealm, emitToTechnician } from "../services/realtimeService.js";

const router = express.Router();

// Local-disk storage under backend/uploads/<realmId>/ - correct for this
// app's current self-hosted, single-process deployment model (no cloud
// storage SDK exists anywhere in this codebase to justify adding one). A
// horizontally-scaled deployment would need shared/object storage instead -
// not solved here.
const UPLOAD_ROOT = path.join(process.cwd(), "uploads");
const ALLOWED_MIMETYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp", "application/pdf", "text/plain", "text/csv", "application/zip"]);
const MAX_FILE_BYTES = 15 * 1024 * 1024;

const storage = multer.diskStorage({
  destination(req, file, cb) {
    const dir = path.join(UPLOAD_ROOT, String(req.realmId));
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  // The stored filename is a fresh UUID, never derived from the original
  // name - avoids any path-traversal/collision risk. The original name is
  // kept only in the Message doc's attachment.filename for display/download.
  filename(req, file, cb) {
    const ext = path.extname(file.originalname).slice(0, 10);
    cb(null, `${crypto.randomUUID()}${ext}`);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: MAX_FILE_BYTES },
  fileFilter(req, file, cb) {
    if (!ALLOWED_MIMETYPES.has(file.mimetype)) return cb(new Error("Unsupported file type."));
    cb(null, true);
  }
});

function buildAttachment(file) {
  if (!file) return null;
  return { filename: file.originalname, mimetype: file.mimetype, size: file.size, storedName: file.filename, kind: file.mimetype.startsWith("image/") ? "image" : "file" };
}

function dmKeyFor(a, b) { return [a, b].sort().join(":"); }

async function paginate(filter, { before, limit }) {
  const query = { ...filter };
  if (before) query.createdAt = { $lt: new Date(before) };
  const capped = Math.min(Math.max(Number.parseInt(limit || "50", 10) || 50, 1), 100);
  const rows = await Message.find(query).sort({ createdAt: -1 }).limit(capped).lean();
  return rows.reverse();
}

function handleUploadError(err, req, res, next) {
  if (err) return res.status(400).json({ success: false, message: err.message || "Upload failed." });
  next();
}

router.get("/team", async (req, res) => {
  try {
    const messages = await paginate({ realmId: req.realmId, channel: "team" }, req.query);
    res.json({ success: true, messages });
  } catch (error) {
    console.error("GET TEAM MESSAGES ERROR:", error);
    res.status(500).json({ success: false, message: "Failed to load team chat." });
  }
});

router.post("/team", upload.single("attachment"), handleUploadError, async (req, res) => {
  try {
    const text = String(req.body?.text || "").trim();
    if (!text && !req.file) return res.status(400).json({ success: false, message: "Message text or an attachment is required." });

    const message = await Message.create({ realmId: req.realmId, channel: "team", senderId: req.user.technicianId, senderName: req.user.name, text, attachment: buildAttachment(req.file) });
    emitToRealm(req.realmId, "chat_message", message);
    res.status(201).json({ success: true, message });
  } catch (error) {
    console.error("POST TEAM MESSAGE ERROR:", error);
    res.status(500).json({ success: false, message: "Failed to send message." });
  }
});

router.get("/conversations", async (req, res) => {
  try {
    const me = req.user.technicianId;
    const realmObjectId = new mongoose.Types.ObjectId(req.realmId);
    const rows = await Message.aggregate([
      { $match: { realmId: realmObjectId, channel: "dm", $or: [{ senderId: me }, { recipientId: me }] } },
      { $sort: { createdAt: -1 } },
      { $group: { _id: "$dmKey", lastMessage: { $first: "$text" }, lastAt: { $first: "$createdAt" }, hasAttachment: { $first: { $ne: ["$attachment", null] } } } },
      { $sort: { lastAt: -1 } }
    ]);
    const otherIds = rows.map(row => { const [a, b] = row._id.split(":"); return a === me ? b : a; });
    const techs = await Technician.find({ realmId: req.realmId, technicianId: { $in: otherIds } }).select("technicianId name").lean();
    const nameById = new Map(techs.map(t => [t.technicianId, t.name]));

    return res.json({
      success: true,
      conversations: rows.map(row => {
        const [a, b] = row._id.split(":");
        const otherId = a === me ? b : a;
        return { technicianId: otherId, name: nameById.get(otherId) || otherId, lastMessage: row.hasAttachment && !row.lastMessage ? "📎 Attachment" : row.lastMessage, lastAt: row.lastAt };
      })
    });
  } catch (error) {
    console.error("GET CONVERSATIONS ERROR:", error);
    res.status(500).json({ success: false, message: "Failed to load conversations." });
  }
});

router.get("/dm/:technicianId", async (req, res) => {
  try {
    const other = await Technician.findOne({ technicianId: req.params.technicianId, realmId: req.realmId }).select("technicianId name").lean();
    if (!other) return res.status(404).json({ success: false, message: "Technician not found." });

    const dmKey = dmKeyFor(req.user.technicianId, req.params.technicianId);
    const messages = await paginate({ realmId: req.realmId, channel: "dm", dmKey }, req.query);
    res.json({ success: true, messages, technician: other });
  } catch (error) {
    console.error("GET DM ERROR:", error);
    res.status(500).json({ success: false, message: "Failed to load conversation." });
  }
});

router.post("/dm/:technicianId", upload.single("attachment"), handleUploadError, async (req, res) => {
  try {
    const other = await Technician.findOne({ technicianId: req.params.technicianId, realmId: req.realmId });
    if (!other) return res.status(404).json({ success: false, message: "Technician not found." });

    const text = String(req.body?.text || "").trim();
    if (!text && !req.file) return res.status(400).json({ success: false, message: "Message text or an attachment is required." });

    const dmKey = dmKeyFor(req.user.technicianId, req.params.technicianId);
    const message = await Message.create({ realmId: req.realmId, channel: "dm", dmKey, senderId: req.user.technicianId, senderName: req.user.name, recipientId: req.params.technicianId, text, attachment: buildAttachment(req.file) });

    // Never emitToRealm here - that would hand this private payload to
    // every socket in the realm room. Only the two participants' personal
    // rooms receive it (the sender too, so their other open tabs/devices
    // see their own outgoing message echoed back).
    emitToTechnician(req.params.technicianId, "chat_message", message);
    emitToTechnician(req.user.technicianId, "chat_message", message);
    res.status(201).json({ success: true, message });
  } catch (error) {
    console.error("POST DM ERROR:", error);
    res.status(500).json({ success: false, message: "Failed to send message." });
  }
});

router.get("/attachments/:messageId", async (req, res) => {
  try {
    const message = await Message.findOne({ _id: req.params.messageId, realmId: req.realmId }).lean();
    if (!message || !message.attachment) return res.status(404).json({ success: false, message: "Attachment not found." });
    if (message.channel === "dm" && message.senderId !== req.user.technicianId && message.recipientId !== req.user.technicianId) {
      return res.status(403).json({ success: false, message: "Not authorized to view this attachment." });
    }

    const filePath = path.join(UPLOAD_ROOT, String(req.realmId), message.attachment.storedName);
    res.setHeader("Content-Disposition", `inline; filename="${encodeURIComponent(message.attachment.filename)}"`);
    return res.sendFile(filePath, err => { if (err) res.status(404).json({ success: false, message: "File not found." }); });
  } catch (error) {
    console.error("GET ATTACHMENT ERROR:", error);
    res.status(500).json({ success: false, message: "Failed to load attachment." });
  }
});

export default router;
