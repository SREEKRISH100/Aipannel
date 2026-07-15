import express from 'express';
import mongoose from 'mongoose';
import cors from 'cors';
import dotenv from 'dotenv';
import OpenAI from 'openai';
import Client from './models/Client.js';
import crypto from 'crypto';
import UsageLog from './models/UsageLog.js';
import dns from 'dns';
import cron from 'node-cron';

// Force Node to use Google and Cloudflare DNS to resolve MongoDB Atlas SRV records
try {
  dns.setServers(['8.8.8.8', '1.1.1.1']);
} catch (e) {
  console.warn('Failed to set custom DNS servers:', e.message);
}

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
  .catch((err) => console.error('MongoDB initial connection error:', err));

// Prevent server crash on database connection dropouts or DNS errors
mongoose.connection.on('error', (err) => {
  console.error('MongoDB connection runtime error:', err);
});

mongoose.connection.on('disconnected', () => {
  console.warn('MongoDB disconnected. Mongoose will attempt to reconnect...');
});

// ─── MONTHLY TOKEN RESET SCHEDULER ──────────────────────────────────────────
cron.schedule('0 0 1 * *', async () => {
  console.log('[Cron Job] Executing monthly token usage reset...');
  try {
    const result = await Client.updateMany(
      { resetCycle: 'monthly' },
      { $set: { tokensUsed: 0 } }
    );
    console.log(`[Cron Job] Successfully reset token counters for ${result.modifiedCount} clients.`);
  } catch (error) {
    console.error('[Cron Job] Error resetting monthly token usage:', error);
  }
});

// ─── SUPER ADMIN & DASHBOARD ENDPOINTS ──────────────────────────────────────

// GET /api/admin/clients: List all registered clients
app.get('/api/admin/clients', async (req, res) => {
  try {
    const clients = await Client.find({}).sort({ createdAt: -1 });
    res.json({ success: true, clients });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /api/admin/clients: Add a new client
app.post('/api/admin/clients', async (req, res) => {
  const { clientId, name, tokenLimit, isActive, resetCycle } = req.body;
  if (!clientId || !name) {
    return res.status(400).json({ success: false, error: "clientId and name are required." });
  }
  try {
    const existingClient = await Client.findOne({ clientId });
    if (existingClient) {
      return res.status(400).json({ success: false, error: `Client with ID "${clientId}" already exists.` });
    }

    const client = await Client.create({
      clientId,
      name,
      tokenLimit: tokenLimit !== undefined ? tokenLimit : 1000000,
      isActive: isActive !== undefined ? isActive : true,
      resetCycle: resetCycle || 'monthly',
      apiKey: crypto.randomUUID().replace(/-/g, '')
    });
    res.json({ success: true, client });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// PATCH /api/admin/clients/:clientId: Edit a client
app.patch('/api/admin/clients/:clientId', async (req, res) => {
  const { clientId } = req.params;
  const { name, tokenLimit, isActive, resetCycle, resetTokens } = req.body;
  try {
    const updateObj = {};
    if (name !== undefined) updateObj.name = name;
    if (tokenLimit !== undefined) updateObj.tokenLimit = tokenLimit;
    if (isActive !== undefined) updateObj.isActive = isActive;
    if (resetCycle !== undefined) updateObj.resetCycle = resetCycle;
    if (resetTokens === true) updateObj.tokensUsed = 0;

    const client = await Client.findOneAndUpdate(
      { clientId },
      { $set: updateObj },
      { new: true }
    );
    if (!client) {
      return res.status(404).json({ success: false, error: "Client not found." });
    }
    res.json({ success: true, client });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /api/admin/clients/:clientId/rotate-key: Rotate API Key
app.post('/api/admin/clients/:clientId/rotate-key', async (req, res) => {
  const { clientId } = req.params;
  try {
    const newApiKey = crypto.randomUUID().replace(/-/g, '');
    const client = await Client.findOneAndUpdate(
      { clientId },
      { $set: { apiKey: newApiKey } },
      { new: true }
    );
    if (!client) {
      return res.status(404).json({ success: false, error: "Client not found." });
    }
    res.json({ success: true, apiKey: client.apiKey, client });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// DELETE /api/admin/clients/:clientId: Delete a client and their logs (for dashboard sync)
app.delete('/api/admin/clients/:clientId', async (req, res) => {
  const { clientId } = req.params;
  try {
    const client = await Client.findOneAndDelete({ clientId });
    if (!client) {
      return res.status(404).json({ success: false, error: "Client not found." });
    }
    await UsageLog.deleteMany({ clientId });
    res.json({ success: true, message: "Client deleted successfully." });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /api/admin/logs/:clientId: Retrieve granular usage logs for a client
app.get('/api/admin/logs/:clientId', async (req, res) => {
  const { clientId } = req.params;
  try {
    const logs = await UsageLog.find({ clientId }).sort({ createdAt: -1 }).limit(100);
    res.json({ success: true, logs });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /api/admin/logs: List all logs (for audit dashboard global view)
app.get('/api/admin/logs', async (req, res) => {
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

  if (!token) {
    return res.status(401).json({ error: "Missing API Key. Please provide your Bearer API Key." });
  }

  try {
    // 1. Authenticate the Client
    const client = await Client.findOne({ apiKey: token });
    if (!client) {
      return res.status(401).json({ error: "Invalid API Key" });
    }

    // 2. Validate Quota and Status
    if (client.isActive === false) {
      return res.status(403).json({ error: "This client account is currently suspended." });
    }

    if (client.tokensUsed >= client.tokenLimit) {
      return res.status(429).json({ error: "Monthly token quota exceeded. Please contact the administrator." });
    }

    // 3. Forward Request to OpenAI
    const clientApiKey = process.env.OPENAI_API_KEY;
    if (!clientApiKey) {
      return res.status(500).json({ error: "Server error: Master OpenAI API Key not configured." });
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

    // 4. Track & Update Usage
    if (response.usage) {
      const prompt = response.usage.prompt_tokens || 0;
      const completion = response.usage.completion_tokens || 0;
      const total = response.usage.total_tokens || 0;

      if (total > 0) {
        await Client.updateOne(
          { _id: client._id },
          { $inc: { tokensUsed: total } }
        );

        await UsageLog.create({
          clientId: client.clientId,
          promptTokens: prompt,
          completionTokens: completion,
          totalTokens: total,
          modelName: model || process.env.OPENAI_MODEL || 'gpt-4o-mini'
        });

        console.log(`[Proxy] Tracked ${total} tokens for client '${client.clientId}'`);
      }
    }

    // Send the OpenAI response back to the client
    res.json(response);

  } catch (error) {
    console.error("Proxy gateway error:", error);
    res.status(error.status || 500).json({ error: error.message });
  }
};

app.post('/api/v1/chat/completions', completionsHandler);
app.post('/api/v1/clients/:clientId/chat/completions', completionsHandler);
app.post('/api/v1/projects/:projectId/chat/completions', completionsHandler); // Legacy backward compatibility
export default app;

if (!process.env.VERCEL) {
  app.listen(PORT, () => {
    console.log(`Token tracking proxy running on http://localhost:${PORT}`);
  });
}
