# Web Partner Bot V2: Final Implementation Plan

## Goal Description
Build an elite, production-ready AI browser assistant that serves as both a high-utility personal agent and an incredibly impressive portfolio piece. This plan synthesizes the low-latency, token-efficient 2026 architecture blueprint with high-impact, visible features (dashboards, live execution views, human-in-the-loop modes) designed to showcase advanced engineering during technical interviews.

## User Review Required
> [!IMPORTANT]
> Please review this synthesized implementation plan. Once you approve, we can begin setting up the repository and laying down the code for Phase 1. 

## Open Questions
> [!TIP]
> 1. **Frontend Stack:** The plan calls for an advanced UI (Live View, Dashboards). Should we use Next.js + Tailwind for this frontend?
> 2. **Local vs Cloud:** Do you want the MVP to run the headless browser locally on your machine for easy development, or immediately set up Docker containers for it?

---

## Part 1: Core Agent Architecture

### 1. Asymmetric Planner + Executor (Feature 1)
Instead of a single, slow LLM loop, we split the brain:
*   **The Planner (e.g., Claude 3.5 Sonnet / Gemini Pro):** Takes the user's prompt (e.g., "Find ML internships in Pune") and generates a high-level JSON graph of task steps (1. Search LinkedIn, 2. Filter, 3. Extract).
*   **The Executor (e.g., Gemini Flash / Haiku):** A fast, cheap model that loops through the current step, reading the DOM and streaming direct browser actions (clicks, types) at sub-second latency.

### 2. Hybrid Observation & Self-Healing Selectors (Feature 4)
*   **Observation:** Extract the Accessibility Object Model (AOM), filter invisible elements, and map interactive nodes to integer IDs (e.g., `[12] Button "Submit"`). This is 90% cheaper than sending full screenshots.
*   **Self-Healing:** Instead of brittle `page.locator("#submit")`, we store semantic properties (Name, Role, Text). If an element is missing, the Executor pauses, searches the AOM for the closest semantic match, and dynamically fixes the selector without failing the run.

### 3. Agent Memory System (Feature 2)
*   **Session Memory:** Current DOM state and active task steps.
*   **User Preferences:** Stored explicitly. If the user asks "Find internships again", the agent retrieves past constraints (Location=Pune, Role=ML Intern) and bypasses redundant questions.
*   **Workflow Cache:** Saves successful element trajectories for common sites to bypass LLM planning entirely on repeated runs.

---

## Part 2: Execution Modes & Capabilities

### 4. Multi-Step Workflows (Feature 5)
The agent is designed to handle extended interactions that require context retention across multiple pages.
*   *Example:* Search laptops under ₹60,000 -> Scrape top 5 -> Compare ratings -> Generate CSV report.

### 5. Research Agent Mode (Feature 9)
A dedicated, high-ROI mode specifically for information synthesis.
*   The agent autonomously opens multiple tabs, searches the web, extracts relevant data into an internal vector/context store, and outputs a formatted markdown or PDF report (e.g., "Compare Claude, Gemini, and GPT architectures").

### 6. Human Approval Mode (Feature 8)
Security and human-in-the-loop (HITL) capability.
*   Before destructive or critical actions (submitting a payment form, sending an email, deleting a record), the Executor pauses execution and pushes a notification to the frontend: `[Agent wants to click 'Pay Now'. Approve? Y/N]`.

### 7. Voice Commands (Feature 6)
Integrate speech-to-text to make the bot feel alive and futuristic.
*   Use Deepgram (for ultra-low latency streaming) or Whisper to translate spoken queries directly into the Planner's input queue.

---

## Part 3: The Showcase Frontend (UI/UX)

To make this project stand out in interviews, the backend logic must be visualized beautifully.

### 8. Visual Browser View (Feature 3)
A live monitoring component in the frontend UI.
*   **Live Stream:** A WebRTC or frame-by-frame stream of the headless browser.
*   **Step Tracker:** A sidebar showing the Planner's steps.
    *   [x] Opened LinkedIn
    *   [x] Searched internships
    *   [/] Applying filters (Current)
    *   [ ] Extracting data

### 9. Execution History Timeline (Feature 7)
A professional, timestamped audit log of every action the bot took during a task.
*   *10:01:12* - Navigated to google.com
*   *10:01:15* - Typed "AI internships" into [Search Box]
*   *10:01:18* - Handled unexpected cookie consent modal (Self-healed)

### 10. Agent Dashboard (Feature 10)
Transforms the app from a script into a full engineering platform.
*   **Metrics Shown:** Task Success Rate (%), Tokens Consumed (Session/All-Time), Average TTFA (Time To First Action), and Top Websites Visited.
*   **Value:** Proves an understanding of production observability, cost-tracking, and system reliability.

---

## Part 4: Implementation Roadmap

### Phase 1: Core Engine MVP (The Foundation)
*   **Tech Stack:** Node.js/TypeScript backend, Playwright, Gemini/Claude APIs.
*   **Deliverables:** AOM extraction pipeline, Planner-Executor split, basic CLI execution of multi-step tasks.

### Phase 2: Self-Healing & Memory (The Brain)
*   **Tech Stack:** Vector DB (pgvector or local SQLite/Chroma), Semantic search logic.
*   **Deliverables:** Self-healing selector fallback, User preference memory, Research Agent Mode logic.

### Phase 3: The Showcase Dashboard (The UI)
*   **Tech Stack:** Next.js, Tailwind CSS, WebSocket streaming.
*   **Deliverables:** Visual Browser View, Execution History logs, Agent Dashboard, Human Approval modal.

### Phase 4: Polish & Voice (The Finish)
*   **Tech Stack:** Deepgram API, WebRTC.
*   **Deliverables:** Voice commands, latency optimizations, final deployment configuration.

## Verification Plan
1. **Automated Tests:** Unit tests for AOM extraction and DOM compression functions.
2. **End-to-End Tests:** Playwright tests running the agent against static, known mock websites to verify the Planner/Executor loop.
3. **Manual Verification:** Human testing of the UI Dashboard, Visual Browser View, and Human Approval Mode interruptions on real sites (e.g., Google, LinkedIn).
