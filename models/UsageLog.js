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
    }
  },
  { timestamps: true }
);

const UsageLog = mongoose.models?.UsageLog || mongoose.model("UsageLog", UsageLogSchema);
export default UsageLog;
