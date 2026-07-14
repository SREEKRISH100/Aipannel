import express from 'express';
import mongoose from 'mongoose';
import cors from 'cors';
import dotenv from 'dotenv';
import OpenAI from 'openai';
import Project from './models/Project.js';
import UsageLog from './models/UsageLog.js';

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

const PORT = process.env.PORT || 5000;
const MONGO_URL = process.env.MONGO_URL;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

// Connect to MongoDB
mongoose.connect(MONGO_URL)
  .then(() => console.log('MongoDB connection established successfully.'))
  .catch((err) => console.error('MongoDB connection error:', err));

// ─── ADMIN & DASHBOARD ENDPOINTS ───────────────────────────────────────────

// Fetch stats of all projects (token limits, usage)
app.get('/api/projects', async (req, res) => {
  try {
    const projects = await Project.find({});
    res.json({ success: true, projects });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Configure or create project token limits
app.post('/api/projects', async (req, res) => {
  const { projectId, name, tokenLimit, isActive } = req.body;
  if (!projectId || !name) {
    return res.status(400).json({ success: false, error: "projectId and name are required." });
  }
  try {
    const project = await Project.findOneAndUpdate(
      { projectId },
      { name, tokenLimit, isActive },
      { new: true, upsert: true }
    );
    res.json({ success: true, project });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Reset project token consumption
app.post('/api/projects/reset', async (req, res) => {
  const { projectId } = req.body;
  if (!projectId) {
    return res.status(400).json({ success: false, error: "projectId is required." });
  }
  try {
    const project = await Project.findOneAndUpdate(
      { projectId },
      { tokensUsed: 0 },
      { new: true }
    );
    res.json({ success: true, project });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Fetch detailed token usage logs
app.get('/api/logs', async (req, res) => {
  try {
    const logs = await UsageLog.find({}).sort({ createdAt: -1 }).limit(100);
    res.json({ success: true, logs });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ─── TOKEN-TRACKING COMPLETIONS PROXY GATEWAY ──────────────────────────────

app.post('/api/v1/chat/completions', async (req, res) => {
  const projectId = req.headers['x-project-id'];

  console.log(`[Proxy Gateway] Incoming request from project: "${projectId}"`);
  console.log(`[Proxy Gateway] Authorization:`, req.headers['authorization'] ? 'Present (Bearer [hidden])' : 'Missing');

  if (!projectId) {
    console.warn(`[Proxy Gateway] Request blocked: Missing x-project-id header.`);
    return res.status(400).json({ error: "Missing required header: 'x-project-id'" });
  }

  try {
    // 1. Retrieve project settings or auto-generate defaults
    let project = await Project.findOne({ projectId });
    if (!project) {
      const defaultName = projectId === "nextjs-project" ? "Next.js Admin Panel" : "React Node Chatbot";
      project = await Project.create({
        projectId,
        name: defaultName,
        tokenLimit: 500000,
        tokensUsed: 0,
        isActive: true
      });
    }

    // 2. Validate limit criteria
    if (!project.isActive) {
      return res.status(403).json({ error: `Project '${project.name}' is deactivated.` });
    }

    if (project.tokensUsed >= project.tokenLimit) {
      return res.status(429).json({
        error: `Token limit exceeded for project '${project.name}' (${project.tokensUsed.toLocaleString()} / ${project.tokenLimit.toLocaleString()} tokens used).`
      });
    }

    // 3. Forward message parameters to OpenAI API
    const authHeader = req.headers['authorization'];
    const clientApiKey = authHeader ? authHeader.replace('Bearer ', '') : process.env.OPENAI_API_KEY;

    if (!clientApiKey) {
      return res.status(401).json({ error: "Unauthorized: Missing OpenAI API Key." });
    }

    const localOpenai = new OpenAI({ apiKey: clientApiKey });
    const { messages, model, tools, tool_choice, temperature } = req.body;

    const response = await localOpenai.chat.completions.create({
      model: model || process.env.OPENAI_MODEL || 'gpt-4o-mini',
      messages,
      tools,
      tool_choice,
      temperature
    });

    // 4. Log the usage statistics dynamically
    if (response.usage) {
      const prompt = response.usage.prompt_tokens || 0;
      const completion = response.usage.completion_tokens || 0;
      const total = response.usage.total_tokens || 0;

      if (total > 0) {
        await Project.updateOne(
          { projectId },
          { $inc: { tokensUsed: total } }
        );

        await UsageLog.create({
          projectId,
          promptTokens: prompt,
          completionTokens: completion,
          totalTokens: total,
          modelName: model || process.env.OPENAI_MODEL || 'gpt-4o-mini'
        });

        console.log(`[Proxy] Tracked ${total} tokens for project '${projectId}'`);
      }
    }

    // 5. Pass response payload back to the client application
    res.json(response);

  } catch (error) {
    console.error("Proxy gateway error:", error);
    res.status(error.status || 500).json({ error: error.message });
  }
});
export default app;

if (!process.env.VERCEL) {
  app.listen(PORT, () => {
    console.log(`Token tracking proxy running on port ${PORT}`);
  });
}
