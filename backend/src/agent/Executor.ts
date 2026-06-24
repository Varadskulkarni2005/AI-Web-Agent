import { LLMRouter, ToolCall } from './LLMRouter';
import { BrowserManager } from '../browser/BrowserManager';
import { AOMExtractor, BrowserSnapshot, InteractiveElement } from '../browser/AOMExtractor';
import { Server } from 'socket.io';
import { VectorStore } from '../memory/VectorStore';
import { buildSystemPrompt } from './prompts/plannerPrompt';
import { browserTools } from './Tools';
import { approvalEvent } from '../server';
import * as dotenv from 'dotenv';
dotenv.config();

type CompactMessage = {
    role: 'system' | 'user' | 'assistant' | 'tool';
    content?: string;
    tool_calls?: Array<{
        id: string;
        type: 'function';
        function: { name: string; arguments: string };
    }>;
    tool_call_id?: string;
    name?: string;
};

type ToolExecutionResult = {
    content: string;
    snapshot?: BrowserSnapshot;
};

const MAX_OBSERVATION_CHARS = 4500;
const MAX_REPEAT_ACTIONS = 2;

function delay(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function truncate(text: string, limit: number = MAX_OBSERVATION_CHARS) {
    if (text.length <= limit) return text;
    return `${text.slice(0, limit - 1)}…`;
}

function stableStringify(value: any): string {
    if (value === null || typeof value !== 'object') return JSON.stringify(value);
    if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
}

function extractYouTubeQuery(goal: string): string | null {
    const match = goal.match(/search\s+for\s+(?:an?\s+)?['"]?(.+?)['"]?\s+on\s+youtube/i);
    if (match?.[1]) return match[1].trim();
    const alt = goal.match(/youtube.*?['"](.+?)['"]/i);
    return alt?.[1]?.trim() || null;
}

export class Executor {
    constructor(
        private browser: BrowserManager,
        private llmRouter: LLMRouter,
        private memory: VectorStore,
        private io?: Server,
        private requireApproval: boolean = false,
        public onAnswer?: (text: string) => void
    ) {}

    private log(...args: any[]) {
        console.log(...args);
        if (this.io) {
            const msg = args.map(a => typeof a === 'object' ? JSON.stringify(a) : a).join(' ');
            this.io.emit('log', msg);
        }
    }

    private snapshotSummary(snapshot: BrowserSnapshot) {
        return truncate(snapshot.text, MAX_OBSERVATION_CHARS);
    }

    private buildStateMessage(goal: string, snapshot: BrowserSnapshot, memoryContext: string, lastAction: string, repeatHint: string) {
        return truncate(
            [
                `GOAL: ${goal}`,
                `PAGE: ${snapshot.url}`,
                `TITLE: ${snapshot.title}`,
                `FINGERPRINT: ${snapshot.fingerprint}`,
                `LAST_ACTION: ${lastAction || 'none'}`,
                repeatHint ? `RECENT_FAILURE_HINT: ${repeatHint}` : '',
                memoryContext ? memoryContext : '',
                'OBSERVATION:',
                this.snapshotSummary(snapshot)
            ].filter(Boolean).join('\n\n')
        );
    }

    private async waitForSettled() {
        if (!this.browser.page) return;
        try {
            await this.browser.page.waitForLoadState('networkidle', { timeout: 2500 });
        } catch {}
        await delay(250);
    }

    private normalizeUrl(url: string) {
        const trimmed = url.trim();
        if (/^https?:\/\//i.test(trimmed)) return trimmed;
        return `https://${trimmed}`;
    }

    private isSearchLikeElement(el: InteractiveElement) {
        const haystack = `${el.role} ${el.name || ''} ${el.value || ''}`.toLowerCase();
        return (
            el.role === 'searchbox' ||
            /(search|query|find|lookup|go to)/i.test(haystack) ||
            /textbox|combobox/.test(el.role) && /(search|query|find|lookup)/i.test(haystack)
        );
    }

    private shouldSubmitAfterTyping(el: InteractiveElement, typedText: string) {
        const text = typedText.trim();
        if (!text) return false;
        if (this.isSearchLikeElement(el)) return true;
        const haystack = `${el.role} ${el.name || ''} ${el.value || ''}`.toLowerCase();
        return (
            /(textbox|combobox)/i.test(el.role) &&
            /(search|query|find|go|search this site|web search)/i.test(haystack)
        );
    }

    private isYouTubePage() {
        const url = this.browser.page?.url() || '';
        return /(^|\/\/)(www\.)?youtube\.com/i.test(url) || /(^|\/\/)(m\.)?youtube\.com/i.test(url);
    }

    private getSemanticLocator(el: InteractiveElement) {
        const page = this.browser.page;
        if (!page) return null;

        const name = el.name?.trim();
        switch (el.role) {
            case 'button':
            case 'link':
            case 'checkbox':
            case 'radio':
            case 'tab':
            case 'menuitem':
            case 'option':
            case 'switch':
            case 'slider':
            case 'spinbutton':
            case 'textbox':
            case 'searchbox':
            case 'combobox':
            case 'gridcell':
            case 'treeitem':
                return name ? page.getByRole(el.role as any, { name }).first() : page.getByRole(el.role as any).first();
            default:
                return name ? page.getByText(name, { exact: true }).first() : null;
        }
    }

    private async captureSnapshot(extractor: AOMExtractor) {
        const snapshot = await extractor.getSnapshot({ maxDepth: 6, maxNodes: 120 });
        this.io?.emit('state', {
            url: snapshot.url,
            title: snapshot.title,
            fingerprint: snapshot.fingerprint,
            interactables: snapshot.interactables.length
        });
        return snapshot;
    }

    private async executeTool(toolCall: ToolCall, extractor: AOMExtractor, currentSnapshot: BrowserSnapshot): Promise<ToolExecutionResult> {
        const page = this.browser.page;
        if (!page) throw new Error('Browser page not connected');
        const { name, arguments: args } = toolCall;

        if (name === 'browser_snapshot') {
            const snapshot = await this.captureSnapshot(extractor);
            return { content: JSON.stringify({
                status: 'ok',
                snapshot: snapshot.text,
                url: snapshot.url,
                title: snapshot.title,
                fingerprint: snapshot.fingerprint
            }), snapshot };
        }

        if (name === 'browser_navigate') {
            const url = this.normalizeUrl(args.url || '');
            await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
            await this.waitForSettled();
            const snapshot = await this.captureSnapshot(extractor);
            return {
                content: JSON.stringify({
                    status: 'ok',
                    action: 'navigate',
                    url: snapshot.url,
                    title: snapshot.title,
                    fingerprint: snapshot.fingerprint
                }),
                snapshot
            };
        }

        if (name === 'browser_open_tab') {
            const url = typeof args.url === 'string' && args.url.trim() ? this.normalizeUrl(args.url) : undefined;
            await this.browser.openTab(url);
            await this.waitForSettled();
            const snapshot = await this.captureSnapshot(extractor);
            return {
                content: JSON.stringify({
                    status: 'ok',
                    action: 'open_tab',
                    url: snapshot.url,
                    title: snapshot.title,
                    fingerprint: snapshot.fingerprint
                }),
                snapshot
            };
        }

        if (name === 'browser_scroll') {
            const sign = args.direction === 'up' ? -1 : 1;
            await page.mouse.wheel(0, 900 * sign);
            await this.waitForSettled();
            const snapshot = await this.captureSnapshot(extractor);
            return {
                content: JSON.stringify({
                    status: 'ok',
                    action: 'scroll',
                    direction: args.direction,
                    url: snapshot.url,
                    fingerprint: snapshot.fingerprint
                }),
                snapshot
            };
        }

        if (name === 'browser_press_key') {
            await page.keyboard.press(String(args.key));
            await this.waitForSettled();
            const snapshot = await this.captureSnapshot(extractor);
            return {
                content: JSON.stringify({
                    status: 'ok',
                    action: 'press_key',
                    key: args.key,
                    url: snapshot.url,
                    fingerprint: snapshot.fingerprint
                }),
                snapshot
            };
        }

        if (name === 'browser_wait') {
            const ms = Math.max(250, Math.min(Number(args.ms || 1000), 10000));
            await delay(ms);
            const snapshot = await this.captureSnapshot(extractor);
            return {
                content: JSON.stringify({
                    status: 'ok',
                    action: 'wait',
                    waitedMs: ms,
                    url: snapshot.url,
                    fingerprint: snapshot.fingerprint
                }),
                snapshot
            };
        }

        if (name === 'browser_back') {
            await page.goBack({ waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => null);
            await this.waitForSettled();
            const snapshot = await this.captureSnapshot(extractor);
            return {
                content: JSON.stringify({
                    status: 'ok',
                    action: 'back',
                    url: snapshot.url,
                    fingerprint: snapshot.fingerprint
                }),
                snapshot
            };
        }

        if (name === 'browser_extract_text') {
            const scope = typeof args.scope === 'string' && args.scope.trim() ? args.scope.trim() : 'body';
            let text = '';
            try {
                if (scope === 'page' || scope === 'body') {
                    text = await page.locator('body').innerText({ timeout: 5000 });
                } else {
                    text = await page.locator(scope).first().innerText({ timeout: 5000 });
                }
            } catch {
                try {
                    text = await page.locator('body').textContent({ timeout: 5000 }) || '';
                } catch {
                    text = '';
                }
            }
            return {
                content: JSON.stringify({
                    status: 'ok',
                    action: 'extract_text',
                    scope,
                    text: truncate(text.replace(/\s+\n/g, '\n').trim(), 3500)
                })
            };
        }

        if (name === 'browser_find_text') {
            const query = String(args.text || '').trim().toLowerCase();
            const matches = currentSnapshot.interactables.filter(el =>
                el.name.toLowerCase().includes(query) ||
                el.value?.toLowerCase().includes(query) ||
                el.role.toLowerCase().includes(query)
            ).slice(0, 10).map(el => ({
                ref: el.ref,
                role: el.role,
                name: el.name,
                value: el.value
            }));

            return {
                content: JSON.stringify({
                    status: matches.length > 0 ? 'ok' : 'not_found',
                    action: 'find_text',
                    query: args.text,
                    matches
                })
            };
        }

        if (name === 'browser_close_modal') {
            const dismissButtons = [
                /accept all/i,
                /accept/i,
                /agree/i,
                /allow/i,
                /close/i,
                /dismiss/i,
                /got it/i,
                /not now/i,
                /no thanks/i,
                /skip/i
            ];

            for (const pattern of dismissButtons) {
                try {
                    const button = page.getByRole('button', { name: pattern }).first();
                    if (await button.isVisible({ timeout: 300 })) {
                        await button.click({ timeout: 1500 });
                        await this.waitForSettled();
                        const snapshot = await this.captureSnapshot(extractor);
                        return {
                            content: JSON.stringify({
                                status: 'ok',
                                action: 'close_modal',
                                method: `button:${pattern.toString()}`,
                                url: snapshot.url,
                                fingerprint: snapshot.fingerprint
                            }),
                            snapshot
                        };
                    }
                } catch {}
            }

            try {
                await page.keyboard.press('Escape');
                await this.waitForSettled();
                const snapshot = await this.captureSnapshot(extractor);
                return {
                    content: JSON.stringify({
                        status: 'ok',
                        action: 'close_modal',
                        method: 'escape',
                        url: snapshot.url,
                        fingerprint: snapshot.fingerprint
                    }),
                    snapshot
                };
            } catch {
                return {
                    content: JSON.stringify({
                        status: 'failed',
                        action: 'close_modal'
                    })
                };
            }
        }

        if (name === 'browser_click' || name === 'browser_type') {
            const el = extractor.getElementByRef(args.ref);
            if (!el) {
                return {
                    content: JSON.stringify({
                        status: 'failed',
                        error: `Element ref ${args.ref} was not found in the last snapshot.`,
                        hint: 'Take a new browser_snapshot because the page likely changed.'
                    })
                };
            }

            const locator = this.getSemanticLocator(el);
            if (name === 'browser_click') {
                try {
                    if (locator) {
                        await locator.click({ timeout: 5000 });
                    } else {
                        await page.mouse.wheel(0, 0);
                        const cdp = this.browser.cdpSession!;
                        const { object } = await cdp.send('DOM.resolveNode', { backendNodeId: el.backendDOMNodeId });
                        const objectId = object?.objectId;
                        if (!objectId) throw new Error('Could not resolve DOM node');
                        await cdp.send('Runtime.callFunctionOn', { objectId, functionDeclaration: 'function() { this.click(); }' });
                    }
                    await this.waitForSettled();
                    const snapshot = await this.captureSnapshot(extractor);
                    return {
                        content: JSON.stringify({
                            status: 'ok',
                            action: 'click',
                            ref: args.ref,
                            role: el.role,
                            name: el.name,
                            url: snapshot.url,
                            fingerprint: snapshot.fingerprint,
                            changed: snapshot.fingerprint !== currentSnapshot.fingerprint
                        }),
                        snapshot
                    };
                } catch (error: any) {
                    return {
                        content: JSON.stringify({
                            status: 'failed',
                            action: 'click',
                            ref: args.ref,
                            role: el.role,
                            name: el.name,
                            error: error?.message || 'Failed to click element.'
                        })
                    };
                }
            }

            if (name === 'browser_type') {
                try {
                    const text = String(args.text ?? '');
                    if (locator) {
                        await locator.fill(text, { timeout: 5000 });
                    } else {
                        const cdp = this.browser.cdpSession!;
                        const { object } = await cdp.send('DOM.resolveNode', { backendNodeId: el.backendDOMNodeId });
                        const objectId = object?.objectId;
                        if (!objectId) throw new Error('Could not resolve DOM node');
                        await cdp.send('Runtime.callFunctionOn', { objectId, functionDeclaration: 'function() { this.focus(); }' });
                        await page.keyboard.type(text, { delay: 10 });
                    }

                    if (this.shouldSubmitAfterTyping(el, text)) {
                        await page.keyboard.press('Enter');
                    }

                    await this.waitForSettled();
                    const snapshot = await this.captureSnapshot(extractor);
                    return {
                        content: JSON.stringify({
                            status: 'ok',
                            action: 'type',
                            ref: args.ref,
                            role: el.role,
                            name: el.name,
                            textLength: String(args.text || '').length,
                            url: snapshot.url,
                            fingerprint: snapshot.fingerprint,
                            changed: snapshot.fingerprint !== currentSnapshot.fingerprint
                        }),
                        snapshot
                    };
                } catch (error: any) {
                    return {
                        content: JSON.stringify({
                            status: 'failed',
                            action: 'type',
                            ref: args.ref,
                            role: el.role,
                            name: el.name,
                            error: error?.message || 'Failed to type into element.'
                        })
                    };
                }
            }
        }

        return {
            content: JSON.stringify({
                status: 'failed',
                error: `Unknown tool called: ${name}`
            })
        };
    }

    async planAndExecute(goal: string, maxLoops: number = 10) {
        if (!this.browser.cdpSession || !this.browser.page) {
            throw new Error('Browser CDP or Page not connected');
        }

        const relevantMemories = await this.memory.searchMemories(goal);
        const memoryContext = relevantMemories.length > 0
            ? `Relevant memory:\n${relevantMemories.map(m => `- ${m}`).join('\n')}`
            : '';

        const systemPrompt = buildSystemPrompt(goal, memoryContext);
        const extractor = new AOMExtractor(this.browser.page, this.browser.cdpSession);

        let currentSnapshot = await this.captureSnapshot(extractor);
        let lastActionSummary = 'none';
        let repeatHint = '';
        let isDone = false;
        let loopCount = 0;
        const repeatCounts = new Map<string, number>();

        while (loopCount < maxLoops && !isDone) {
            this.log(`\n=== Step ${loopCount + 1}/${maxLoops} ===`);

            const messages: CompactMessage[] = [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: this.buildStateMessage(goal, currentSnapshot, memoryContext, lastActionSummary, repeatHint) }
            ];

            let toolCall: ToolCall;
            try {
                this.log('[Executor] Requesting next browser action...');
                toolCall = await this.llmRouter.generateToolCall(messages, browserTools);
            } catch (e: any) {
                this.log(`[Executor] Failed to generate tool call: ${e.message}`);
                break;
            }

            const actionKey = stableStringify({ name: toolCall.name, arguments: toolCall.arguments, fingerprint: currentSnapshot.fingerprint });
            const repeatCount = (repeatCounts.get(actionKey) || 0) + 1;
            repeatCounts.set(actionKey, repeatCount);

            if (repeatCount >= MAX_REPEAT_ACTIONS) {
                repeatHint = `The last action repeated without progress: ${toolCall.name} ${stableStringify(toolCall.arguments)}. Choose a different strategy, use browser_find_text, browser_close_modal, browser_back, browser_wait, or take a new snapshot.`;
                lastActionSummary = repeatHint;
                loopCount++;
                continue;
            }

            this.log(`[Executor] Agent called: ${toolCall.name}(${JSON.stringify(toolCall.arguments)})`);

            if (this.requireApproval) {
                this.log('[Executor] Pausing for human approval...');
                this.io?.emit('approval_required', { action: toolCall });

                const approved = await new Promise<boolean>((resolve) => {
                    let timeout: NodeJS.Timeout;
                    const onResponse = (granted: boolean) => {
                        clearTimeout(timeout);
                        resolve(granted);
                    };
                    approvalEvent.once('response', onResponse);
                    timeout = setTimeout(() => {
                        approvalEvent.off('response', onResponse);
                        resolve(false);
                    }, 60000);
                });

                if (!approved) {
                    this.log('[Executor] Action rejected by user.');
                    this.io?.emit('approval_required', { action: null });
                    break;
                }
            }

            let execution: ToolExecutionResult;
            try {
                execution = await this.executeTool(toolCall, extractor, currentSnapshot);
            } catch (e: any) {
                execution = {
                    content: JSON.stringify({
                        status: 'failed',
                        error: e?.message || 'Tool execution failed'
                    })
                };
            }

            lastActionSummary = `${toolCall.name} -> ${truncate(execution.content, 600)}`;
            repeatHint = '';

            if (toolCall.name === 'task_complete') {
                this.log(`[Executor] Goal achieved: ${toolCall.arguments.summary}`);
                if (this.onAnswer) this.onAnswer(toolCall.arguments.summary);
                isDone = true;
                break;
            }

            if (execution.snapshot) {
                currentSnapshot = execution.snapshot;
            } else {
                currentSnapshot = await this.captureSnapshot(extractor);
            }

            loopCount++;
        }

        if (!isDone) {
            this.log(`[Executor] Stopped after ${loopCount} steps without task_complete.`);
        }
    }
}
