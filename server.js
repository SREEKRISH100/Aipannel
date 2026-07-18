import express from 'express';
import mongoose from 'mongoose';
import cors from 'cors';
import dotenv from 'dotenv';
import OpenAI from 'openai';
import cron from 'node-cron';
import rateLimit from 'express-rate-limit';
import Project from './models/Project.js';
import crypto from 'crypto';
import UsageLog from './models/UsageLog.js';
import dns from 'dns';

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

// ─── OPENAI CLIENT CACHE ─────────────────────────────────────────────────────
// Reuses HTTP connections instead of creating a new client per request.
// This eliminates ~50–150ms of TCP handshake overhead on every call.
const openaiClientCache = new Map();
function getOpenAIClient(apiKey) {
  if (!openaiClientCache.has(apiKey)) {
    openaiClientCache.set(apiKey, new OpenAI({ apiKey }));
  }
  return openaiClientCache.get(apiKey);
}

// ─── RESPONSE CACHE ──────────────────────────────────────────────────────────
// Caches identical questions so repeated queries cost 0 tokens.
// Max 500 entries, each entry expires after 10 minutes.
const RESPONSE_CACHE_MAX_SIZE = 500;
const RESPONSE_CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes
const responseCache = new Map();

function buildCacheKey(messages, model) {
  // Key = model + the last user message (lowercased, trimmed)
  const lastUserMsg = [...messages].reverse().find(m => m.role === 'user');
  if (!lastUserMsg || typeof lastUserMsg.content !== 'string') return null;
  return `${model}::${lastUserMsg.content.toLowerCase().trim()}`;
}

function getFromCache(key) {
  if (!key || !responseCache.has(key)) return null;
  const entry = responseCache.get(key);
  if (Date.now() - entry.ts > RESPONSE_CACHE_TTL_MS) {
    responseCache.delete(key);
    return null;
  }
  return entry.value;
}

function setInCache(key, value) {
  if (!key) return;
  // Evict oldest entry when cache is full (LRU-like)
  if (responseCache.size >= RESPONSE_CACHE_MAX_SIZE) {
    responseCache.delete(responseCache.keys().next().value);
  }
  responseCache.set(key, { value, ts: Date.now() });
}

// ─── MESSAGE OPTIMIZATION HELPERS ────────────────────────────────────────────

/**
 * Sliding Window: Keeps system prompts intact but trims non-system messages
 * to the last `maxHistory` messages. Prevents unbounded token growth.
 *
 * Example: 50-message history with maxHistory=10 → sends only 10 messages
 * Typical saving: 60–80% of prompt tokens on long conversations.
 */
function trimHistory(messages, maxHistory = 10) {
  if (!Array.isArray(messages)) return messages;
  const systemMessages = messages.filter(m => m.role === 'system');
  const nonSystemMessages = messages.filter(m => m.role !== 'system');
  if (nonSystemMessages.length <= maxHistory) return messages; // nothing to trim
  const trimmed = nonSystemMessages.slice(-maxHistory);
  return [...systemMessages, ...trimmed];
}

/**
 * Compresses messages by stripping extra whitespace, consecutive spaces,
 * and leading/trailing padding from content strings.
 * Typical saving: 2–8% of prompt tokens.
 */
function compressMessages(messages) {
  if (!Array.isArray(messages)) return messages;
  return messages.map(msg => {
    if (typeof msg.content !== 'string') return msg;
    return { ...msg, content: msg.content.trim().replace(/\s+/g, ' ') };
  });
}

// ─── RATE LIMITER ────────────────────────────────────────────────────────────
// Prevents a single client from flooding the proxy and burning through tokens.
const completionsRateLimiter = rateLimit({
  windowMs: 60 * 1000,      // 1-minute window
  max: 60,                   // max 60 requests per minute per IP
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please slow down and try again in a minute.' }
});

// ─── SCHEDULED JOBS ──────────────────────────────────────────────────────────
// Auto-reset all project token counters on the 1st of every month at midnight.
cron.schedule('0 0 1 * *', async () => {
  try {
    const result = await Project.updateMany({}, { tokensUsed: 0 });
    console.log(`[Cron] Monthly token reset complete. ${result.modifiedCount} projects reset.`);
  } catch (err) {
    console.error('[Cron] Monthly reset failed:', err.message);
  }
});

// ─── ADMIN & DASHBOARD ENDPOINTS ─────────────────────────────────────────────

// Fetch stats of all projects (token limits, usage)
app.get('/api/projects', async (req, res) => {
  try {
    const projects = await Project.find({}).lean();
    res.json({ success: true, projects });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Fetch stats of a single project by ID
app.get('/api/projects/:projectId', async (req, res) => {
  const { projectId } = req.params;
  try {
    const project = await Project.findOne({ projectId }).lean();
    if (!project) {
      return res.status(404).json({ success: false, error: 'Project not found' });
    }
    res.json({ success: true, project });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Configure or create project token limits
app.post('/api/projects', async (req, res) => {
  const { projectId, name, tokenLimit, isActive, maxTokensPerRequest, maxHistoryMessages, warningThreshold } = req.body;
  if (!projectId || !name) {
    return res.status(400).json({ success: false, error: "projectId and name are required." });
  }
  try {
    const updateFields = { name, tokenLimit, isActive };
    if (maxTokensPerRequest !== undefined) updateFields.maxTokensPerRequest = maxTokensPerRequest;
    if (maxHistoryMessages !== undefined) updateFields.maxHistoryMessages = maxHistoryMessages;
    if (warningThreshold !== undefined) updateFields.warningThreshold = warningThreshold;

    const project = await Project.findOneAndUpdate(
      { projectId },
      { $set: updateFields, $setOnInsert: { apiKey: crypto.randomUUID().replace(/-/g, '') } },
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

// Reset project token consumption — PUT /api/projects/:projectId/reset
app.put('/api/projects/:projectId/reset', async (req, res) => {
  const { projectId } = req.params;
  try {
    const project = await Project.findOneAndUpdate(
      { projectId },
      { tokensUsed: 0 },
      { new: true }
    );
    if (!project) {
      return res.status(404).json({ success: false, error: 'Project not found' });
    }
    res.json({ success: true, project });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Legacy reset route (kept for backward compatibility)
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

// Fetch token usage logs with pagination + filters
// GET /api/logs?projectId=X&page=1&limit=50&startDate=2024-01-01&endDate=2024-12-31
app.get('/api/logs', async (req, res) => {
  try {
    const { projectId, page = 1, limit = 50, startDate, endDate } = req.query;
    const filter = {};
    if (projectId) filter.projectId = projectId;
    if (startDate || endDate) {
      filter.createdAt = {};
      if (startDate) filter.createdAt.$gte = new Date(startDate);
      if (endDate) filter.createdAt.$lte = new Date(endDate);
    }
    const parsedPage = Math.max(1, parseInt(page));
    const parsedLimit = Math.min(200, Math.max(1, parseInt(limit)));
    const skip = (parsedPage - 1) * parsedLimit;

    const [logs, total] = await Promise.all([
      UsageLog.find(filter).sort({ createdAt: -1 }).skip(skip).limit(parsedLimit).lean(),
      UsageLog.countDocuments(filter)
    ]);

    res.json({
      success: true,
      logs,
      pagination: {
        total,
        page: parsedPage,
        limit: parsedLimit,
        totalPages: Math.ceil(total / parsedLimit)
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ─── TOKEN-TRACKING COMPLETIONS PROXY GATEWAY ────────────────────────────────

const completionsHandler = async (req, res) => {
  const authHeader = req.headers['authorization'] || '';
  const token = authHeader.replace('Bearer ', '').trim();

  // 1. Resolve Project ID (from route param, header, or looking up token)
  let projectId = req.params.projectId || req.headers['x-project-id'];
  let project = null;

  if (projectId) {
    project = await Project.findOne({ projectId })
      .select('projectId name apiKey isActive tokensUsed tokenLimit maxTokensPerRequest maxHistoryMessages warningThreshold');
  } else if (token) {
    // If no explicit project ID was provided, try looking it up by its API Key
    project = await Project.findOne({ apiKey: token })
      .select('projectId name apiKey isActive tokensUsed tokenLimit maxTokensPerRequest maxHistoryMessages warningThreshold');
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

    const usagePercent = (project.tokensUsed / project.tokenLimit) * 100;

    if (usagePercent >= 100) {
      return res.status(429).json({
        error: `Token limit exceeded for project '${project.name}' (${project.tokensUsed.toLocaleString()} / ${project.tokenLimit.toLocaleString()} tokens used).`
      });
    }

    // Warn clients when approaching the limit (default: 80%)
    const threshold = project.warningThreshold ?? 80;
    if (usagePercent >= threshold) {
      res.setHeader('X-Token-Warning', `${usagePercent.toFixed(1)}% of token limit used for project '${project.name}'`);
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

    // 4. Extract and OPTIMIZE messages before sending to OpenAI
    const { messages: rawMessages, model, tools, tool_choice, temperature } = req.body;
    const resolvedModel = model || process.env.OPENAI_MODEL || 'gpt-4o-mini';

    // Step A — Sliding Window: trim history to last N messages (keeps system prompts)
    const maxHistory = project.maxHistoryMessages ?? 10;
    const originalCount = rawMessages?.filter(m => m.role !== 'system').length || 0;
    const windowedMessages = trimHistory(rawMessages, maxHistory);
    const trimmedCount = Math.max(0, originalCount - windowedMessages.filter(m => m.role !== 'system').length);

    // Step B — Compress: strip extra whitespace from all messages
    const optimizedMessages = compressMessages(windowedMessages);

    // Step C — Response Cache: serve repeated questions for free (0 tokens)
    const cacheKey = buildCacheKey(optimizedMessages, resolvedModel);
    const cachedResponse = getFromCache(cacheKey);
    if (cachedResponse) {
      console.log(`[Cache] HIT for project '${projectId}' — 0 tokens consumed`);
      res.setHeader('X-Cache', 'HIT');
      await UsageLog.create({
        projectId,
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
        modelName: resolvedModel,
        servedFromCache: true,
        trimmedMessages: trimmedCount,
      });
      return res.json(cachedResponse);
    }
    res.setHeader('X-Cache', 'MISS');

    // 5. Call OpenAI via cached client (reuses TCP connections)
    const localOpenai = getOpenAIClient(clientApiKey);

    const openaiParams = {
      model: resolvedModel,
      messages: optimizedMessages,
      tools,
      tool_choice,
      temperature,
    };

    // Enforce per-project max_tokens cap if configured
    if (project.maxTokensPerRequest) {
      openaiParams.max_tokens = project.maxTokensPerRequest;
    }

    const response = await localOpenai.chat.completions.create(openaiParams);

    // 6. Atomically track token usage — prevents overshooting the limit
    if (response.usage) {
      const prompt = response.usage.prompt_tokens || 0;
      const completion = response.usage.completion_tokens || 0;
      const total = response.usage.total_tokens || 0;

      if (total > 0) {
        // Atomic increment — only proceeds if still under limit
        const updated = await Project.findOneAndUpdate(
          {
            projectId,
            $expr: { $lt: ['$tokensUsed', '$tokenLimit'] }
          },
          { $inc: { tokensUsed: total } },
          { new: true }
        );

        if (!updated) {
          // Limit was hit concurrently between the pre-check and now
          console.warn(`[Proxy] Concurrent limit hit for project '${projectId}'. Tokens not counted.`);
        }

        await UsageLog.create({
          projectId,
          promptTokens: prompt,
          completionTokens: completion,
          totalTokens: total,
          modelName: resolvedModel,
          servedFromCache: false,
          trimmedMessages: trimmedCount,
        });

        console.log(`[Proxy] Tracked ${total} tokens for project '${projectId}' (trimmed ${trimmedCount} msgs, ${prompt} prompt + ${completion} completion)`);
      }
    }

    // Store in response cache for future identical queries
    setInCache(cacheKey, response);

    // 7. Pass response payload back to the client application
    res.json(response);

  } catch (error) {
    console.error("Proxy gateway error:", error);
    res.status(error.status || 500).json({ error: error.message });
  }
};

// Apply rate limiter only to completions endpoints
app.post('/api/v1/chat/completions', completionsRateLimiter, completionsHandler);
app.post('/api/v1/projects/:projectId/chat/completions', completionsRateLimiter, completionsHandler);

export default app;

if (!process.env.VERCEL) {
  app.listen(PORT, () => {
    console.log(`Token tracking proxy running on http://localhost:${PORT}`);
  });
}
