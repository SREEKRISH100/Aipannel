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
    }
  },
  { timestamps: true }
);

const Project = mongoose.models?.Project || mongoose.model("Project", ProjectSchema);
export default Project;
