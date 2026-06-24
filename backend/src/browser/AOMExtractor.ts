import { CDPSession, Page } from 'playwright';
import crypto from 'crypto';

export interface InteractiveElement {
    ref: string;
    backendDOMNodeId: number;
    role: string;
    name: string;
    value?: string;
    disabled?: boolean;
    checked?: boolean | string;
}

export interface BrowserSnapshot {
    url: string;
    title: string;
    fingerprint: string;
    text: string;
    interactables: InteractiveElement[];
}

export class AOMExtractor {
    private elementMap: Map<string, InteractiveElement> = new Map();
    private nextId: number = 1;

    constructor(private page: Page, private cdp: CDPSession) {}

    private normalize(text: unknown, maxLength: number = 120): string {
        const compact = String(text ?? '').replace(/\s+/g, ' ').trim();
        if (!compact) return '';
        if (compact.length <= maxLength) return compact;
        return `${compact.slice(0, maxLength - 1)}…`;
    }

    private hashSnapshot(parts: string[]): string {
        return crypto.createHash('sha1').update(parts.join('\n')).digest('hex').slice(0, 12);
    }

    async getSnapshot(options: { maxDepth?: number; maxNodes?: number } = {}): Promise<BrowserSnapshot> {
        this.elementMap.clear();
        this.nextId = 1;
        const maxDepth = options.maxDepth ?? 6;
        const maxNodes = options.maxNodes ?? 120;

        const { nodes } = await this.cdp.send('Accessibility.getFullAXTree');
        const interactables: InteractiveElement[] = [];
        
        // Build hierarchy
        const nodeById = new Map<string, any>();
        const rootNodes: any[] = [];
        
        for (const rawNode of nodes) {
            nodeById.set(rawNode.nodeId, rawNode);
        }

        for (const rawNode of nodes) {
            if (rawNode.parentId && nodeById.has(rawNode.parentId)) {
                const parent = nodeById.get(rawNode.parentId);
                if (!parent.children) parent.children = [];
                parent.children.push(rawNode);
            } else {
                rootNodes.push(rawNode);
            }
        }

        const lines: string[] = [];
        let renderedNodes = 0;

        const traverse = (node: any, depth: number, parentName?: string) => {
            if (renderedNodes >= maxNodes || depth > maxDepth) {
                return;
            }

            const role = node.role?.value || 'unknown';
            const name = this.normalize(node.name?.value || '');
            const value = this.normalize(node.value?.value || node.description?.value || '');
            
            let isInteractive = false;
            let ref = "";

            if (node.backendDOMNodeId !== undefined && this.isInteractive(node)) {
                isInteractive = true;
                ref = `b${node.backendDOMNodeId || this.nextId++}`;
                
                const disabled = node.disabled === true || node.properties?.some((p: any) => p.name === 'disabled' && (p.value?.value === true || p.value === true));
                const checkedProp = node.properties?.find((p: any) => p.name === 'checked');
                const checked = node.checked !== undefined ? node.checked : checkedProp?.value?.value;
                
                const element: InteractiveElement = {
                    ref,
                    backendDOMNodeId: node.backendDOMNodeId,
                    role,
                    name,
                    value,
                    disabled: disabled || undefined,
                    checked: checked !== undefined ? checked : undefined
                };
                
                this.elementMap.set(ref, element);
                interactables.push(element);
            }

            const significantRoles = new Set([
                'button', 'link', 'textbox', 'searchbox', 'combobox', 'checkbox', 'radio',
                'tab', 'menuitem', 'option', 'switch', 'slider', 'spinbutton', 'heading',
                'dialog', 'alertdialog', 'list', 'listitem', 'main', 'navigation', 'region',
                'article', 'iframe', 'image', 'menu', 'menubar', 'gridcell', 'treeitem'
            ]);
            const shouldOutput = isInteractive || significantRoles.has(role) || (name !== "" && depth <= 2);

            if (shouldOutput) {
                const isDuplicateText = parentName && name === parentName && !isInteractive;

                if (!isDuplicateText) {
                    const indent = "  ".repeat(depth);
                    let line = `${indent}- ${role}`;
                    if (name) line += ` "${name}"`;
                    if (value && value !== name) line += ` | value: "${value}"`;
                    if (isInteractive) {
                        line += ` [ref=${ref}]`;
                        const el = this.elementMap.get(ref);
                        if (el?.disabled) line += ` | disabled: true`;
                        if (el?.checked !== undefined) line += ` | checked: ${el.checked}`;
                    }
                    
                    lines.push(line);
                    renderedNodes++;
                    if (node.children) {
                        for (const child of node.children) {
                            traverse(child, depth + 1, name || parentName);
                        }
                    }
                } else {
                    // Duplicate text, skip outputting this node but traverse its children
                    if (node.children) {
                        for (const child of node.children) {
                            traverse(child, depth, parentName);
                        }
                    }
                }
            } else {
                // Flatten structural container nodes and traverse children at same depth
                if (node.children) {
                    for (const child of node.children) {
                        traverse(child, depth, parentName);
                    }
                }
            }
        };

        for (const root of rootNodes) {
            traverse(root, 0);
        }

        const url = this.page.url();
        const title = this.normalize(await this.page.title(), 120);
        const header = [`URL: ${url}`, `TITLE: ${title}`, `INTERACTABLES: ${interactables.length}`];
        const text = [...header, ...lines].join('\n');
        const fingerprint = this.hashSnapshot([url, title, lines.slice(0, 80).join('\n')]);

        return { url, title, fingerprint, text, interactables };
    }
    private isInteractive(node: any): boolean {
        const interactiveRoles = [
            'link', 'button', 'textbox', 'combobox', 'searchbox', 'checkbox', 'radio',
            'tab', 'tabpanel', 'menuitem', 'menu', 'menubar', 'option', 'listbox',
            'slider', 'spinbutton', 'switch', 'treeitem', 'gridcell'
        ];
        const role = node.role?.value;
        if (role && interactiveRoles.includes(role)) return true;

        if (node.focusable === true || node.focusable?.value === true) return true;
        
        if (Array.isArray(node.properties)) {
            return node.properties.some(
                (p: any) => p.name === 'focusable' && (p.value?.value === true || p.value === true)
            );
        }
        return false;
    }

    getElementByRef(ref: string): InteractiveElement | undefined {
        return this.elementMap.get(ref);
    }
}
