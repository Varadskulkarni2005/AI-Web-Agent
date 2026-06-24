import fs from 'fs';
import path from 'path';
import { GoogleGenerativeAI } from '@google/generative-ai';

export interface Memory {
    id: string;
    text: string;
    embedding: number[] | null;
    timestamp: number;
}

export class VectorStore {
    private ai: GoogleGenerativeAI;
    private dbPath: string;
    private memories: Memory[] = [];

    constructor(apiKey: string) {
        this.ai = new GoogleGenerativeAI(apiKey);
        // Ensure data directory exists
        const dataDir = path.join(process.cwd(), 'data');
        if (!fs.existsSync(dataDir)) {
            fs.mkdirSync(dataDir, { recursive: true });
        }
        this.dbPath = path.join(dataDir, 'memory.json');
        this.loadDb();
    }

    private loadDb() {
        if (fs.existsSync(this.dbPath)) {
            try {
                const data = fs.readFileSync(this.dbPath, 'utf8');
                this.memories = JSON.parse(data);
            } catch (e) {
                console.error("Failed to parse memory.json", e);
                this.memories = [];
            }
        } else {
            this.memories = [];
            this.saveDb();
        }
    }

    private saveDb() {
        fs.writeFileSync(this.dbPath, JSON.stringify(this.memories, null, 2));
    }

    private async getEmbedding(text: string): Promise<number[] | null> {
        try {
            const model = this.ai.getGenerativeModel({ model: "gemini-embedding-001" });
            const result = await model.embedContent(text);
            return result.embedding.values;
        } catch (e: any) {
            console.log(`[VectorStore] Failed to generate embedding (Quota/Network error). Falling back to keyword memory. Error: ${e.message}`);
            return null;
        }
    }

    private cosineSimilarity(vecA: number[], vecB: number[]): number {
        let dotProduct = 0.0;
        let normA = 0.0;
        let normB = 0.0;
        for (let i = 0; i < vecA.length; i++) {
            dotProduct += vecA[i] * vecB[i];
            normA += vecA[i] * vecA[i];
            normB += vecB[i] * vecB[i];
        }
        if (normA === 0 || normB === 0) return 0;
        return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
    }

    public async addMemory(text: string): Promise<void> {
        // Prevent exact duplicates
        if (this.memories.some(m => m.text.toLowerCase() === text.toLowerCase())) return;

        console.log(`[VectorStore] Adding memory: "${text}"`);
        const embedding = await this.getEmbedding(text);
        
        const memory: Memory = {
            id: crypto.randomUUID(),
            text,
            embedding,
            timestamp: Date.now()
        };
        
        this.memories.push(memory);
        this.saveDb();
    }

    public async searchMemories(query: string, limit: number = 3): Promise<string[]> {
        if (this.memories.length === 0) return [];

        const queryEmbedding = await this.getEmbedding(query);

        if (!queryEmbedding) {
            // Fallback: Simple keyword search if embeddings fail due to 429 quota limit
            const words = query.toLowerCase().split(/\s+/);
            const matches = this.memories.map(m => {
                let score = 0;
                const memText = m.text.toLowerCase();
                for (const w of words) {
                    if (w.length > 3 && memText.includes(w)) score++;
                }
                return { text: m.text, score };
            }).filter(m => m.score > 0).sort((a, b) => b.score - a.score).slice(0, limit);
            
            return matches.map(m => m.text);
        }

        // Semantic Vector Search
        const scoredMemories = this.memories.map(m => {
            if (!m.embedding) return { text: m.text, score: 0 };
            const score = this.cosineSimilarity(queryEmbedding, m.embedding);
            return { text: m.text, score };
        });

        // Filter by relevance threshold (e.g. > 0.6) and sort
        return scoredMemories
            .filter(m => m.score > 0.6)
            .sort((a, b) => b.score - a.score)
            .slice(0, limit)
            .map(m => m.text);
    }
}
