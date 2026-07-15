import express from 'express';
import mongoose from 'mongoose';
import cors from 'cors';
import dotenv from 'dotenv';
import OpenAI from 'openai';
import Project from './models/Project.js';
import crypto from 'crypto';
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
      { $set: { name, tokenLimit, isActive }, $setOnInsert: { apiKey: crypto.randomUUID().replace(/-/g, '') } },
      { new: true, upsert: true }
    );
    res.json({ success: true, project });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Generate or retrieve API key for a project
app.post('/api/projects/:projectId/key', async (req, res) => {
  const { projectId } = req.params;
  try {
    const project = await Project.findOne({ projectId });
    if (!project) {
      return res.status(404).json({ success: false, error: 'Project not found' });
    }
    if (!project.apiKey) {
      project.apiKey = crypto.randomUUID().replace(/-/g, '');
      await project.save();
    }
    res.json({ success: true, apiKey: project.apiKey });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
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

// Delete a project and its usage logs
app.delete('/api/projects/:projectId', async (req, res) => {
  const { projectId } = req.params;
  try {
    const project = await Project.findOneAndDelete({ projectId });
    if (!project) {
      return res.status(404).json({ success: false, error: 'Project not found' });
    }
    await UsageLog.deleteMany({ projectId });
    res.json({ success: true, message: 'Project deleted successfully' });
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

const completionsHandler = async (req, res) => {
  const authHeader = req.headers['authorization'] || '';
  const token = authHeader.replace('Bearer ', '').trim();

  // 1. Resolve Project ID (from route param, header, or looking up token)
  let projectId = req.params.projectId || req.headers['x-project-id'];
  let project = null;

  if (projectId) {
    project = await Project.findOne({ projectId });
  } else if (token) {
    // If no explicit project ID was provided, try looking it up by its API Key
    project = await Project.findOne({ apiKey: token });
    if (project) {
      projectId = project.projectId;
    }
  }

  console.log(`[Proxy Gateway] Incoming request for project ID: "${projectId || 'unknown'}"`);
  console.log(`[Proxy Gateway] Authorization:`, authHeader ? 'Present (Bearer [hidden])' : 'Missing');

  if (!project) {
    return res.status(404).json({ error: "Project not found or not registered. Please check your project ID or API Key." });
  }

  try {
    // Auto-generate apiKey if missing for older projects
    if (!project.apiKey) {
      project.apiKey = crypto.randomUUID().replace(/-/g, '');
      await project.save();
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

    // 3. Authenticate and resolve OpenAI API Key
    let clientApiKey = '';

    if (project.apiKey) {
      if (token === project.apiKey) {
        // Authenticated via Project Proxy API Key -> use server's master OpenAI Key
        clientApiKey = process.env.OPENAI_API_KEY;
      } else if (token.startsWith('sk-')) {
        // Fallback: Authenticated directly with a raw OpenAI API key
        clientApiKey = token;
      } else {
        return res.status(401).json({ error: "Unauthorized: Invalid API Key for this project." });
      }
    } else {
      // For projects without an apiKey, allow using the header or default to master key
      clientApiKey = token || process.env.OPENAI_API_KEY;
    }

    if (!clientApiKey) {
      return res.status(401).json({ error: "Unauthorized: Missing API Key." });
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
};

app.post('/api/v1/chat/completions', completionsHandler);
app.post('/api/v1/projects/:projectId/chat/completions', completionsHandler);
export default app;

if (!process.env.VERCEL) {
  app.listen(PORT, () => {
    console.log(`Token tracking proxy running on http://localhost:${PORT}`);
  });
}
