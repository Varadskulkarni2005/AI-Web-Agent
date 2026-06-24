# 🤖 Autonomous AI Web Agent

An intelligent, autonomous browser agent that translates natural language commands into sequential web interactions. Built with a ReAct (Reasoning and Acting) loop, this agent leverages large language models to "see" the web, plan its next move, and navigate seamlessly using Puppeteer.

![TypeScript](https://img.shields.io/badge/TypeScript-007ACC?style=for-the-badge&logo=typescript&logoColor=white)
![Node.js](https://img.shields.io/badge/Node.js-43853D?style=for-the-badge&logo=node.js&logoColor=white)
![Puppeteer](https://img.shields.io/badge/Puppeteer-40B5A4?style=for-the-badge&logo=puppeteer&logoColor=white)
![OpenRouter](https://img.shields.io/badge/OpenRouter-API-black?style=for-the-badge)

*(Insert a GIF or video link here demonstrating the bot running a search on YouTube)*

## 🌟 Key Features

*   **Autonomous Navigation:** Supply a high-level goal (e.g., "Search for a tech video on YouTube and play it"), and the agent takes over.
*   **Accessibility Object Model (AOM) Extraction:** Parses the browser's DOM into an optimized Accessibility Tree. Empty and structural nodes are aggressively pruned to reduce the LLM context payload by up to 90%, maximizing inference speed and reliability.
*   **ReAct Agent Architecture:** Utilizes the Reason + Act methodology to iteratively observe the webpage, reason about the goal, and invoke specific browser tools (click, type, navigate).
*   **Dynamic LLM Routing:** Built-in multi-model routing (`LLMRouter`) with failovers. Supports local models (Ollama), direct API integrations (Gemini), and aggregate providers (OpenRouter).

## 🏗️ Architecture

1.  **AOMExtractor:** Converts complex DOM structures into a lightweight, token-efficient text representation.
2.  **LLMRouter:** Handles AI generation, routing traffic seamlessly to OpenRouter's smart fallback models (`openrouter/auto`) to avoid rate-limiting issues.
3.  **Executor:** The core loop. It captures the browser state, prompts the LLM, executes the returned tool call, and repeats until the goal is met.
4.  **Live View Frontend:** A Socket.io-powered frontend that streams logs and browser snapshots to the user in real-time.

## 🚀 Getting Started

### Prerequisites

*   [Node.js](https://nodejs.org/en/) (v18+ recommended)
*   An [OpenRouter API Key](https://openrouter.ai/) 

### Installation

1.  **Clone the repository:**
    ```bash
    git clone https://github.com/yourusername/ai-web-agent.git
    cd ai-web-agent
    ```

2.  **Install dependencies:**
    ```bash
    npm install
    # or if using yarn: yarn install
    ```

3.  **Set up Environment Variables:**
    Copy the example `.env` file and add your OpenRouter API key.
    ```bash
    cp .env.example .env
    ```
    Open `.env` and add:
    ```
    OPENROUTER_API_KEY=your_openrouter_api_key_here
    ```

4.  **Run the application:**
    ```bash
    npm run dev
    ```

## 🧠 What I Learned

Building this agent as a 3rd-year engineering student exposed me to some of the hardest problems in modern AI engineering:
*   **Context Window Optimization:** Realizing that feeding raw HTML into an LLM causes severe latency and token-limit crashes, I engineered a custom DOM parser to extract only the interactive, semantic nodes.
*   **Prompt Engineering & Tool Calling:** Mastering strict JSON-schema tool calling so the LLM reliably outputs valid `click(id)` or `type(id, text)` commands without hallucinating.

## 🤝 Contributing

Contributions, issues, and feature requests are welcome! Feel free to check the [issues page](https://github.com/yourusername/ai-web-agent/issues).

## 📄 License

This project is [MIT](LICENSE) licensed.
