import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import { BrowserManager } from './browser/BrowserManager';
import { Executor } from './agent/Executor';
import { LLMRouter } from './agent/LLMRouter';
import { VectorStore } from './memory/VectorStore';
import * as dotenv from 'dotenv';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { EventEmitter } from 'events';
import cron from 'node-cron';
import fs from 'fs';
dotenv.config();

export const approvalEvent = new EventEmitter();

// Fast-Fail Boot Sequence
const apiKey = process.env.GEMINI_API_KEY?.trim();
if (!apiKey || apiKey.trim() === '') {
    console.error("\n[CRITICAL ERROR] GEMINI_API_KEY is missing from .env! This project needs it for model routing and memory.\n");
    process.exit(1);
}

const openRouterKey = process.env.OPENROUTER_API_KEY?.trim();

const ai = new GoogleGenerativeAI(apiKey);

const memoryStore = new VectorStore(apiKey!);

const app = express();

// Security: Restrict CORS to only the Next.js frontend origin in production (defaulting to localhost:3000)
const ALLOWED_ORIGIN = process.env.FRONTEND_URL || 'http://localhost:3000';
app.use(cors({ origin: ALLOWED_ORIGIN }));
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: ALLOWED_ORIGIN }
});

let browser: BrowserManager | null = null;
let isRunning = false;

// Setup Reports DB
const reportsPath = './reports.json';
if (!fs.existsSync(reportsPath)) {
    fs.writeFileSync(reportsPath, '[]');
}

app.get('/api/reports', (req, res) => {
    try {
        const data = fs.readFileSync(reportsPath, 'utf-8');
        res.json(JSON.parse(data));
    } catch(e) { res.json([]); }
});

function emitLog(msg: string) {
    const timestamp = new Date().toLocaleTimeString();
    const formatted = `[${timestamp}] ${msg}`;
    console.log(formatted);
    io.emit('log', formatted);
}

app.post('/api/schedule', (req, res) => {
    const { goal, cronExpression } = req.body;
    if (!goal || !cronExpression) return res.status(400).json({error: "goal and cronExpression required"});
    
    emitLog(`[System] Automation Scheduled: "${goal}" on schedule "${cronExpression}"`);
    
    cron.schedule(cronExpression, () => {
        executeGhostTask(goal, cronExpression);
    });
    res.json({ success: true, message: "Automation scheduled" });
});

async function executeGhostTask(goal: string, cronExpression: string) {
    emitLog(`[System] Ghost Agent woke up! Executing scheduled task: "${goal}"`);
    const ghostBrowser = new BrowserManager();
    const findings: string[] = [];
    
    try {
        await ghostBrowser.init(true); // Headless for ghost tasks
        await ghostBrowser.navigate('https://www.google.com/');
        
        const llmRouter = new LLMRouter(apiKey!, io, openRouterKey || undefined);
        const executor = new Executor(ghostBrowser, llmRouter, memoryStore, io, false, (ans) => {
            findings.push(ans);
        });
        
        await executor.planAndExecute(goal, 5);
        
        // Save report
        const reports = JSON.parse(fs.readFileSync(reportsPath, 'utf-8'));
        reports.unshift({
            id: Date.now().toString(),
            timestamp: new Date().toLocaleString(),
            goal,
            cronExpression,
            findings: findings.length > 0 ? findings : ["No explicit answers extracted."]
        });
        fs.writeFileSync(reportsPath, JSON.stringify(reports, null, 2));
        emitLog(`[System] Ghost Agent finished. Report saved to dashboard.`);
        
    } catch (e: unknown) {
        const errorMsg = e instanceof Error ? e.message : String(e);
        emitLog(`[Ghost Agent ERROR]: ${errorMsg}`);
    } finally {
        await ghostBrowser.close();
    }
}

// Helper to initialize persistent browser
async function getOrInitBrowser() {
    if (!browser) {
        emitLog(`[System] Booting Persistent Browser Session...`);
        browser = new BrowserManager();
        
        // Setup persistent live screencast streaming, re-establishing on session switch
        browser.onCdpSessionCreated = async (session) => {
            emitLog(`[System] Re-establishing live view screencast stream...`);
            try {
                await session.send('Page.startScreencast', { format: 'jpeg', quality: 50 });
                session.on('Page.screencastFrame', async (event) => {
                    io.emit('frame', event.data);
                    try {
                        await session.send('Page.screencastFrameAck', { sessionId: event.sessionId });
                    } catch (e) {}
                });
            } catch (e) {
                console.error("Failed to start screencast on new session: ", e);
            }
        };

        await browser.init(false);
        await browser.navigate('https://www.google.com/'); // Default start page
    }
    return browser;
}

app.post('/api/reset', async (req, res) => {
    if (isRunning) {
        return res.status(409).json({ error: 'Cannot reset while agent is running.' });
    }
    if (browser) {
        emitLog(`[System] Resetting browser session. Wiping cookies and cache...`);
        await browser.close();
        browser = null;
        io.emit('frame', null); // Clear frontend frame
        emitLog(`[System] Browser destroyed. Ready for a fresh session.`);
    } else {
        emitLog(`[System] No active browser session to reset.`);
    }
    res.json({ success: true });
});

app.post('/api/approval', (req, res) => {
    const { granted } = req.body;
    approvalEvent.emit('response', granted);
    res.json({ success: true });
});

app.post('/api/memory', async (req, res) => {
    try {
        const { text } = req.body;
        if (!text || typeof text !== 'string' || text.length > 1000) {
            return res.status(400).json({ error: 'Valid text (max 1000 chars) required' });
        }
        await memoryStore.addMemory(text);
        emitLog(`[Memory] Saved new memory: "${text}"`);
        res.json({ success: true });
    } catch (e: unknown) {
        res.status(500).json({ error: 'Internal memory error' });
    }
});

app.post('/api/start', async (req, res) => {
    try {
        const { goal, requireApproval } = req.body;
        if (!goal || typeof goal !== 'string' || goal.length > 2000) {
            return res.status(400).json({ error: 'Valid goal (max 2000 chars) is required' });
        }
        if (isRunning) {
            return res.status(409).json({ error: 'Agent is already executing a task. Please wait.' });
        }

        isRunning = true;
        res.json({ message: 'Agent started' });

        emitLog(`[System] Starting Web Partner Bot V2...`);
        emitLog(`[System] Goal: ${goal}`);
        
        // Use the persistent browser (will only boot if it's null)
        const activeBrowser = await getOrInitBrowser();

        // Pass dependencies to Executor
        const llmRouter = new LLMRouter(apiKey!, io, openRouterKey || undefined);
        const executor = new Executor(activeBrowser, llmRouter, memoryStore, io, requireApproval);
        await executor.planAndExecute(goal);

    } catch (e: unknown) {
        const errorMsg = e instanceof Error ? e.message : String(e);
        emitLog(`[System ERROR]: ${errorMsg}`);
    } finally {
        isRunning = false;
        emitLog(`[System] Task finished. Standing by for next command...`);
        io.emit('task_complete');
        // Browser is intentionally NOT closed here!
    }
});

const PORT = 3001;
server.listen(PORT, () => {
    console.log(`Web Partner Bot Backend listening on http://localhost:${PORT}`);
});

// Graceful shutdown to prevent zombie Chromium processes
const cleanupAndExit = async () => {
    if (browser) {
        console.log(`\n[System] Graceful shutdown initiated. Destroying Chromium browser session...`);
        try {
            await browser.close();
        } catch(e) {}
    }
    process.exit(0);
};

process.on('SIGINT', cleanupAndExit);
process.on('SIGTERM', cleanupAndExit);
process.on('uncaughtException', async (err) => {
    console.error(`\n[CRITICAL ERROR] Uncaught Exception:`, err);
    await cleanupAndExit();
});
