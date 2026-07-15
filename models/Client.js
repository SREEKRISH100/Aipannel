import mongoose from "mongoose";
import crypto from "crypto";

const ClientSchema = new mongoose.Schema(
  {
    clientId: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    name: {
      type: String,
      required: true,
    },
    apiKey: {
      type: String,
      required: true,
      unique: true,
      default: () => crypto.randomUUID().replace(/-/g, ''),
    },
    tokenLimit: {
      type: Number,
      required: true,
      default: 1000000,
    },
    tokensUsed: {
      type: Number,
      required: true,
      default: 0,
    },
    isActive: {
      type: Boolean,
      required: true,
      default: true,
    },
    resetCycle: {
      type: String,
      enum: ['monthly', 'yearly', 'none'],
      default: 'monthly',
    }
  },
  { timestamps: true }
);

const Client = mongoose.models?.Client || mongoose.model("Client", ClientSchema);
export default Client;
