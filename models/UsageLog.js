import mongoose from "mongoose";

const UsageLogSchema = new mongoose.Schema(
  {
    projectId: {
      type: String,
      required: true,
      index: true,
    },
    promptTokens: {
      type: Number,
      required: true,
    },
    completionTokens: {
      type: Number,
      required: true,
    },
    totalTokens: {
      type: Number,
      required: true,
    },
    modelName: {
      type: String,
      required: true,
    },
    // Whether this response was served from cache (0 tokens consumed)
    servedFromCache: {
      type: Boolean,
      default: false,
    },
    // How many messages were trimmed from history before this request
    trimmedMessages: {
      type: Number,
      default: 0,
    },
  },
  { timestamps: true }
);

// ─── TTL Index: auto-delete logs older than 90 days ─────────────────────────
UsageLogSchema.index({ createdAt: 1 }, { expireAfterSeconds: 7776000 });

const UsageLog = mongoose.models?.UsageLog || mongoose.model("UsageLog", UsageLogSchema);
export default UsageLog;
