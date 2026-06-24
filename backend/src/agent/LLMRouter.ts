import { Server } from 'socket.io';
import { GoogleGenerativeAI, FunctionCallingMode } from '@google/generative-ai';

export interface ToolCall {
    id: string;
    name: string;
    arguments: any;
}

type MessageLike = {
    role: string;
    content?: string;
    tool_calls?: Array<{
        id?: string;
        type?: string;
        function?: { name: string; arguments?: string };
    }>;
    tool_call_id?: string;
    name?: string;
};

export class LLMRouter {
    private geminiAi: GoogleGenerativeAI | null = null;
    private geminiModel: string;
    private openRouterApiKey: string;
    private geminiCooldownUntil = 0;
    private openRouterCooldownUntil = 0;
    private openRouterDisabled = false;

    constructor(geminiApiKey: string, private io?: Server, openRouterApiKey?: string, modelName?: string) {
        const gKey = (geminiApiKey || process.env.GEMINI_API_KEY || '').trim();
        if (gKey) this.geminiAi = new GoogleGenerativeAI(gKey);
        this.geminiModel = (modelName || process.env.GEMINI_MODEL || 'gemini-2.5-flash').trim();
        this.openRouterApiKey = (openRouterApiKey || process.env.OPENROUTER_API_KEY || '').replace(/['"\r\n\s]+/g, '');
    }

    private log(msg: string) {
        console.log(msg);
        if (this.io) this.io.emit('log', msg);
    }

    private async sleep(ms: number) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    private safeParseArgs(rawArgs: unknown): any {
        if (rawArgs && typeof rawArgs === 'object') return rawArgs;
        if (typeof rawArgs !== 'string') return {};
        try {
            return JSON.parse(rawArgs);
        } catch {
            const match = rawArgs.match(/\{[\s\S]*\}/);
            if (match) {
                try {
                    return JSON.parse(match[0]);
                } catch {
                    return {};
                }
            }
            return {};
        }
    }

    private normalizeToolCall(raw: any): ToolCall | null {
        const tc = raw?.tool_calls?.[0];
        if (!tc) return null;
        const name = tc.function?.name || tc.name;
        if (!name) return null;
        return {
            id: tc.id || `call_${Date.now()}`,
            name,
            arguments: this.safeParseArgs(tc.function?.arguments ?? tc.arguments ?? {})
        };
    }

    private convertToGeminiContents(messages: MessageLike[]) {
        const contents: any[] = [];
        let systemInstruction = '';

        for (const m of messages) {
            if (m.role === 'system') {
                systemInstruction = [systemInstruction, m.content || ''].filter(Boolean).join('\n');
                continue;
            }

            if (m.role === 'user') {
                contents.push({ role: 'user', parts: [{ text: m.content || '' }] });
                continue;
            }

            if (m.role === 'assistant' && m.tool_calls?.length) {
                const tc = m.tool_calls[0].function!;
                contents.push({
                    role: 'model',
                    parts: [{
                        functionCall: {
                            name: tc.name,
                            args: this.safeParseArgs(tc.arguments)
                        }
                    }]
                });
                continue;
            }

            if (m.role === 'tool') {
                contents.push({
                    role: 'user',
                    parts: [{
                        functionResponse: {
                            name: m.name,
                            response: { content: m.content || '' }
                        }
                    }]
                });
                continue;
            }

            if (m.role === 'assistant' && m.content) {
                contents.push({ role: 'model', parts: [{ text: m.content }] });
            }
        }

        return { contents, systemInstruction };
    }

    private async tryGemini(messages: MessageLike[], tools: any[]): Promise<ToolCall | null> {
        if (!this.geminiAi) return null;
        if (Date.now() < this.geminiCooldownUntil) {
            const waitMs = this.geminiCooldownUntil - Date.now();
            this.log(`[LLM Router] Gemini cooling down for ${Math.ceil(waitMs / 1000)}s due to quota.`);
            await this.sleep(Math.min(waitMs, 3000));
            return null;
        }

        try {
            const toolNames = tools.map(t => t.function.name);
            const geminiPayload = this.convertToGeminiContents(messages);
            this.log(`[LLM Router] Using Gemini ${this.geminiModel}...`);
            const model = this.geminiAi.getGenerativeModel({
                model: this.geminiModel,
                tools: [{
                    functionDeclarations: tools.map(t => ({
                        name: t.function.name,
                        description: t.function.description,
                        parameters: t.function.parameters
                    }))
                }],
                toolConfig: {
                    functionCallingConfig: {
                        mode: FunctionCallingMode.ANY,
                        allowedFunctionNames: toolNames
                    }
                },
                systemInstruction: geminiPayload.systemInstruction
            });

            const { contents } = geminiPayload;
            const result = await model.generateContent({
                contents,
                generationConfig: {
                    temperature: 0.05,
                    maxOutputTokens: 128
                }
            });

            const response = result.response;
            const functionCall = response.functionCalls()?.[0];
            if (functionCall) {
                return {
                    id: `call_${Date.now()}`,
                    name: functionCall.name,
                    arguments: this.safeParseArgs(functionCall.args)
                };
            }

            const text = response.text();
            if (text && text.trim()) {
                return {
                    id: `call_${Date.now()}`,
                    name: 'task_complete',
                    arguments: { summary: text.trim() }
                };
            }

            this.log('[LLM Router] Gemini returned no function call.');
            return null;
        } catch (e: any) {
            this.log(`[LLM Router] Gemini error: ${e.message}`);
            const retryAfterMatch = String(e?.message || '').match(/retry in ([0-9.]+)s/i);
            if (retryAfterMatch) {
                const retryAfterSeconds = Math.ceil(parseFloat(retryAfterMatch[1]));
                this.geminiCooldownUntil = Date.now() + Math.max(1000, retryAfterSeconds * 1000);
                this.log(`[LLM Router] Gemini quota cooldown set for ${retryAfterSeconds}s.`);
            }
            return null;
        }
    }

    private async tryOpenRouter(messages: MessageLike[], tools: any[]): Promise<ToolCall | null> {
        if (!this.openRouterApiKey || this.openRouterDisabled) return null;
        if (Date.now() < this.openRouterCooldownUntil) {
            const waitMs = this.openRouterCooldownUntil - Date.now();
            this.log(`[LLM Router] OpenRouter cooling down for ${Math.ceil(waitMs / 1000)}s.`);
            await this.sleep(Math.min(waitMs, 3000));
            return null;
        }

        const modelsToTry = [
            process.env.OPENROUTER_MODEL?.trim(),
            'openai/gpt-4.1-mini',
            'google/gemini-2.5-flash',
            'openrouter/auto'
        ].filter(Boolean) as string[];

        for (const modelName of modelsToTry) {
            try {
                this.log(`[LLM Router] Trying ${modelName} via OpenRouter...`);
                const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
                    method: 'POST',
                    headers: {
                        Authorization: `Bearer ${this.openRouterApiKey}`,
                        'Content-Type': 'application/json',
                        'HTTP-Referer': 'http://localhost:3001',
                        'X-Title': 'AI Web Partner Bot'
                    },
                    body: JSON.stringify({
                        model: modelName,
                        messages,
                        tools,
                        tool_choice: 'auto',
                        temperature: 0.05,
                        max_tokens: 256
                    })
                });

                if (!response.ok) {
                    const err = await response.text();
                    this.log(`[LLM Router] OpenRouter error for ${modelName}: ${response.status} ${err}`);
                    if (response.status === 402) {
                        this.openRouterDisabled = true;
                        this.log('[LLM Router] OpenRouter disabled for the rest of this run due to insufficient credits.');
                        return null;
                    }
                    if (response.status === 429) {
                        const retryAfterMatch = err.match(/"retry_after_seconds":(\d+)/);
                        const retryAfterSeconds = retryAfterMatch ? parseInt(retryAfterMatch[1], 10) : 10;
                        this.openRouterCooldownUntil = Date.now() + Math.max(1000, (retryAfterSeconds + 1) * 1000);
                        this.log(`[LLM Router] OpenRouter quota cooldown set for ${retryAfterSeconds}s.`);
                    }
                    continue;
                }

                const data = await response.json();
                const msg = data.choices?.[0]?.message;
                const normalized = this.normalizeToolCall(msg);
                if (normalized) return normalized;

                const content = typeof msg?.content === 'string' ? msg.content.trim() : '';
                if (content) {
                    return {
                        id: `call_${Date.now()}`,
                        name: 'task_complete',
                        arguments: { summary: content }
                    };
                }
            } catch (e: any) {
                this.log(`[LLM Router] OpenRouter exception for ${modelName}: ${e.message}`);
            }
        }

        return null;
    }

    async generateToolCall(messages: MessageLike[], tools: any[]): Promise<ToolCall> {
        const geminiCall = await this.tryGemini(messages, tools);
        if (geminiCall) return geminiCall;

        const openRouterCall = await this.tryOpenRouter(messages, tools);
        if (openRouterCall) return openRouterCall;

        throw new Error('All models failed to generate a tool call.');
    }
}
