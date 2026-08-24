import mongoose from "mongoose";

const technicianSchema = new mongoose.Schema(
  {
    technicianId: {
      type: String,
      unique: true,
      required: true
    },

    name: {
      type: String,
      required: true
    },

    phone: {
      type: String,
      required: true
    },

    level: {
      type: Number,
      required: true,
      min: 1
    },

    role: {
      type: String,
      default: "Network Technician"
    },

    active: {
      type: Boolean,
      default: true
    }
  },
  {
    timestamps: true
  }
);

export default mongoose.model(
  "Technician",
  technicianSchema
);