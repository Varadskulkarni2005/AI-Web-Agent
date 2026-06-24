# 🤖 Autonomous AI Web Agent

An intelligent, autonomous browser agent that translates natural language (and voice) commands into sequential web interactions. Built with a ReAct (Reasoning and Acting) loop, this agent leverages large language models to "see" the web via a custom Accessibility Object Model (AOM), plan its next move, and navigate seamlessly using Playwright.

![TypeScript](https://img.shields.io/badge/TypeScript-007ACC?style=for-the-badge&logo=typescript&logoColor=white)
![Node.js](https://img.shields.io/badge/Node.js-43853D?style=for-the-badge&logo=node.js&logoColor=white)
![Next.js](https://img.shields.io/badge/Next.js-black?style=for-the-badge&logo=next.js&logoColor=white)
![Playwright](https://img.shields.io/badge/Playwright-2EAD33?style=for-the-badge&logo=playwright&logoColor=white)
![Socket.io](https://img.shields.io/badge/Socket.io-black?style=for-the-badge&logo=socket.io&logoColor=white)

*(Insert a GIF or video link here demonstrating the Live View Dashboard, Voice Commands, and Autonomous browsing)*

## 🌟 Key Features

*   **🎙️ Voice-Activated & TTS UI:** Speak your goals directly into the Next.js dashboard using the Web Speech API. The agent reads its actions back to you using text-to-speech.
*   **📺 Real-Time Live View Dashboard:** Watch the agent work in real-time. The Next.js frontend connects via Socket.io to stream base64 browser frames, execution logs, and active page states directly to your browser.
*   **🧠 ReAct Agent Architecture & Vector Memory:** Utilizes a Reason + Act loop with long-term memory. A custom Vector Store allows the agent to recall past facts (e.g., "My zip code is 10001") during its execution loop.
*   **🛡️ Human-in-the-Loop Intercepts:** An optional security mode where the agent pauses and requests your permission via a UI modal before executing critical DOM actions.
*   **🌲 Custom AOM Extraction:** Extracts the Playwright Chrome DevTools Protocol (CDP) Accessibility Tree. Empty/structural nodes are aggressively pruned and deduplicated, reducing the LLM context payload by up to 90% for lightning-fast inference.
*   **⏰ Background Autonomous Agents:** Schedule background scraping and automation tasks using standard CRON expressions. The agent spawns an invisible ghost browser and deposits findings into "Extraction Reports".

## 🏗️ System Architecture

1.  **Frontend (Next.js):** A sleek, dark-mode command center for controlling the agent, viewing live screen captures, interacting with the memory bank, and scheduling cron jobs.
2.  **Executor Loop (Backend):** The core ReAct loop. Captures the browser state, retrieves relevant context from the Vector Store, prompts the LLM, executes the returned Playwright tool call, and repeats.
3.  **AOMExtractor:** Converts complex DOM structures into lightweight, token-efficient text references (e.g., `- button "Submit" [ref=b45]`).
4.  **LLMRouter:** Handles AI generation, routing traffic seamlessly to OpenRouter's smart fallback models (`openrouter/auto`) to avoid rate-limiting issues and ensure uptime.

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
    # Install backend dependencies
    cd backend
    npm install
    
    # Install frontend dependencies
    cd ../frontend
    npm install
    ```

3.  **Set up Environment Variables:**
    Copy the example `.env` file in the root directory.
    ```bash
    cp .env.example .env
    ```
    Open `.env` and add:
    ```
    OPENROUTER_API_KEY=your_openrouter_api_key_here
    ```

4.  **Run the application:**
    Open two terminal windows.
    ```bash
    # Terminal 1: Start Backend
    cd backend
    npm start
    
    # Terminal 2: Start Frontend
    cd frontend
    npm run dev
    ```
    Open `http://localhost:3000` in your browser.

## 🧠 What I Learned

Building this agent as a 3rd-year engineering student exposed me to some of the hardest problems in modern AI engineering:
*   **Context Window Optimization:** Realizing that feeding raw HTML into an LLM causes severe latency and token-limit crashes, I engineered a custom DOM parser using Playwright's CDP to extract only the interactive, semantic nodes.
*   **Real-time Streaming:** Implementing Socket.io to stream heavy base64 image buffers from a headless browser to a Next.js client without blocking the Node.js event loop.
*   **Agentic Workflows:** Moving beyond simple LLM chat wrappers to build an autonomous system capable of long-term memory retrieval, human-in-the-loop pauses, and sequential tool-calling.

## 🤝 Contributing

Contributions, issues, and feature requests are welcome! Feel free to check the [issues page](https://github.com/yourusername/ai-web-agent/issues).

## 📄 License

This project is [MIT](LICENSE) licensed.
