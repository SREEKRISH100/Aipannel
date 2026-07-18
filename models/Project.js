import mongoose from "mongoose";

const ProjectSchema = new mongoose.Schema(
  {
    projectId: {
      type: String,
      required: true,
      unique: true, // e.g. "nextjs-project", "react-node-project"
    },
    name: {
      type: String,
      required: true,
    },
    tokenLimit: {
      type: Number,
      required: true,
      default: 500000,
    },
    tokensUsed: {
      type: Number,
      required: true,
      default: 0,
    },
    apiKey: {
      type: String,
      unique: true,
      sparse: true,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    // ─── Token Reduction Config ───────────────────────────────────────────
    // Max response tokens OpenAI can return per request (null = no cap)
    maxTokensPerRequest: {
      type: Number,
      default: null,
    },
    // Sliding window: how many past messages to keep in context
    maxHistoryMessages: {
      type: Number,
      default: 10,
    },
    // Warning threshold % — sends X-Token-Warning header when exceeded (0–100)
    warningThreshold: {
      type: Number,
      default: 80,
    },
  },
  { timestamps: true }
);

const Project = mongoose.models?.Project || mongoose.model("Project", ProjectSchema);
export default Project;
