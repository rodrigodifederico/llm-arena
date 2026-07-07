# ⚔️ LLM Arena

A single-page React application where two Large Language Models (LLMs) compete head-to-head in deterministic, turn-based strategy games. 

Unlike typical LLM benchmarks that rely on static question-answering, **LLM Arena** evaluates models on real-time decision-making, spatial awareness, long-horizon planning, adversarial reasoning, and resource management. All game rules are strictly coded and enforced by deterministic engines—the models only select actions, and their responses are parsed, validated, and logged in real-time.

---

## 🎯 Project Objective

The goal of LLM Arena is to provide a highly interactive, visual, and measurable platform to benchmark and analyze how LLMs perform in complex, adversarial environments. 

By running games locally, the project allows developers and researchers to:
- **Measure Cognitive Strengths:** Assess models across different domains (e.g., spatial reasoning in *Hex Dominion*, probabilistic search in *Salvo*, tactical RPG combat in *Arena Clash*, or game-theory bluffing in *Standoff*).
- **Evaluate JSON Adherence & Instruction Following:** Check how reliably models can output structured data under changing constraints, and how effectively they correct themselves during retry loops when they commit illegal moves.
- **Perform Deep Diagnostics:** Every decision—including the system prompts, raw text outputs, reasoning chains (thinking tokens), parsed JSON, API latency, token consumption, and dollar cost—is captured.
- **Ensure 100% Reproducibility:** Match records can be exported as standalone `.json` replay files and loaded back into the interactive timeline player with zero API costs.

---

## 🎮 The Games

LLM Arena features four distinct games, each designed to test specific cognitive and reasoning capabilities:

### 1. ⚔️ Arena Clash
* **Style:** 3v3 turn-based tactical RPG.
* **Core Competencies:** Combat tactics, target priority, mana management, status-effect planning.
* **Dynamics:** 
  * At the start of the match, 3 combatants are randomly drafted for each team from 10 distinct archetypes (based on a shared seed).
  * Characters act in order of their speed (`SPD`) stat.
  * Models must manage standard RPG mechanics: physical vs. magical damage formulas, action costs, mana pools, and complex status effects (such as heals, damage-over-time (DoTs), taunts, counters, and shields).
  * The board visualizes combat with rich animations, pose states (idle, windup, strike, hit, fall, etc.), floating combat text, visual status indicators, and sound effects.
  * **Win Condition:** Defeat all three opposing characters. If the 20-round cap is reached, the winner is determined by the highest remaining total team HP percentage.

### 2. ⬢ Hex Dominion
* **Style:** 7×7 hex-grid conquest and resource management.
* **Core Competencies:** Spatial planning, expansion logic, economic optimization, long-term strategic positioning.
* **Dynamics:**
  * Played on a 7×7 hexagonal grid featuring symmetrically positioned Headquarters (HQs) and resource mines.
  * Both players manage an energy economy. Energy is gained from holding territory and controlling mines, and it can be saved up (capped at 6 carry-over energy).
  * On their turn, models spend energy to spawn units, move units, or attack neighboring tiles.
  * Moving and attacking expand the player's territory, while HQs serve as their primary base.
  * **Win Condition:** Destroy the opponent's HQ (30 HP) or control the most territory when the 30-turn cap is reached.

### 3. 🚢 Salvo
* **Style:** Battleship-style hidden-grid duel.
* **Core Competencies:** Asymmetric information processing, memory retention, probabilistic search, systematic grid traversal.
* **Dynamics:**
  * **Asymmetric Information:** Neither model can see the other's board. The orchestrator feeds each model only its own history of shots (hits, misses, or ship sinkings) and its own fleet status.
  * **Setup Phase:** Models place a fleet of 5 ships (lengths: 5, 4, 3, 3, 2) onto an 8×8 grid. The engine validates that placement adheres to boundaries and prevents overlaps.
  * **Combat Phase:** Players take turns firing salvos. The game tracks which coordinates are targeted.
  * **Win Condition:** Sink the opponent's entire fleet.

### 4. 🤠 Standoff
* **Style:** Simultaneous-reveal gunfight duel.
* **Core Competencies:** Game theory, opponent modeling, bluffing, risk mitigation.
* **Dynamics:**
  * A fast-paced, simultaneous-move game where both players submit their action at the same time.
  * Each player starts with 3 lives and 0 bullets in their chamber.
  * Every turn, models choose one of four actions:
    * `RELOAD`: Load 1 bullet into the chamber (vulnerable to `SHOOT`).
    * `SHIELD`: Defend against a standard shot (harmless if the opponent reloads or shields).
    * `SHOOT`: Fire a bullet (requires a bullet, deals 1 damage, beats `RELOAD`, blocked by `SHIELD`).
    * `MEGA`: Spend 2 bullets to fire an unblockable shot (deals 1 damage, bypasses `SHIELD`).
  * **Win Condition:** Reduce the opponent to 0 lives. Cap is set to 40 rounds, followed by a 5-round sudden death period.

---

## ⚙️ Decision Dynamics & Error Handling

To ensure a fair, rigorous, and automated competitive environment, the match controller orchestrates decisions using the following workflow:

```
[Game Engine] ──> Generate State Prompt ──> [LLM Client]
                                                  │
                                          Wait for Response
                                                  │
[Game Engine] <──   Parse & Validate   <──   Raw JSON
     │                     │
  (Valid)              (Invalid)
     │                     │
Execute Action       Retry Loop (Up to X retries with error feedback)
                           │
                 If all retries fail:
                 - Apply safe Default Action
                 - Flag as FORFEIT (3 consecutive forfeits = Match Loss)
```

1. **State Serialization:** At the start of a turn, the engine builds a prompt. This prompt contains the general game rules, the current game state, the history of previous rounds (including private notes written by the model to itself), and a strict list of current **legal moves**.
2. **Structured Response Format:** The model is instructed to respond with a single, valid JSON object matching this schema:
   ```json
   {
     "reasoning": "A step-by-step breakdown of the current situation and strategy.",
     "action": {
       // Game-specific command object
     },
     "notes": "Private thoughts or plans to be echoed back to this model next turn."
   }
   ```
3. **Tolerant Extraction:** The client parses the model's text response, tolerating markdown code blocks (e.g. ` ```json ` fences) and stripping leading/trailing prose.
4. **Validation & Retries:** The parsed action is validated against the game rules. If it is malformed or represents an illegal move, the engine initiates a **retry loop** (up to a user-configured limit, defaulting to 2 retries). The engine appends the specific validation error message to the conversation history and prompts the model to correct its choice.
5. **Forfeits:** If the model exhausts its retries or times out (defaulting to 30 seconds), the engine executes a safe, low-impact **default action** (e.g. Pass, Shield, or random fire) and marks the turn as a **FORFEIT**. If a model forfeits three times in a row, it loses the match.

---

## 🔎 Observability & Replay System

LLM Arena is built with deep observability features:
* **Live HUD Metrics:** Displays accumulated token usage (Input/Output), average API latency, running financial cost (configured via customizable rates per 1M tokens), and active thinking spinners.
* **Reasoning Model Support:** Automatically accommodates reasoning models (such as DeepSeek Reasoner or OpenAI's o-series). The client detects and extracts thoughts from `reasoning_content` (or equivalent fields), prevents empty content errors, and logs the thinking process alongside the final action.
* **Turn Inspector:** The sidebar lists all turns. Clicking any turn reveals the exact system/user prompts sent to the model, its raw response, the extracted reasoning, the validated action, latency, and token statistics.
* **Persistent Replays:** Completed matches are automatically saved locally using a combination of `localStorage` (for indexing) and `IndexedDB` (for large replay blobs).
* **Key-Safe Export/Import:** Replays can be exported as `.json` files. For security, all API keys and credentials are stripped from the file during export. Replay files can be loaded by anyone to review the entire match frame-by-frame with interactive controls (play, pause, step forward/backward, speed slider, timeline scrubber) without making any external API calls.

---

## 🌐 API Endpoint Reference

To help testers run matches between different providers, use the following OpenAI-compatible endpoint configurations:

| Provider | Base URL (Endpoint) | Notes |
| :--- | :--- | :--- |
| **OpenAI** | `https://api.openai.com/v1` | Official OpenAI API. |
| **Gemini (Google)** | `https://generativelanguage.googleapis.com/v1beta/openai` | Google Gemini API (OpenAI-compatible mode). |
| **DeepSeek** | `https://api.deepseek.com/v1` | Official DeepSeek API. |
| **OpenRouter** | `https://openrouter.ai/api/v1` | Unified access proxy to hundreds of LLMs. |
| **Groq** | `https://api.groq.com/openai/v1` | High-speed inference for Llama, Mistral, Gemma, etc. |
| **Mistral AI** | `https://api.mistral.ai/v1` | Official Mistral AI endpoint. |
| **Together AI** | `https://api.together.xyz/v1` | Together open-source model endpoint. |
| **Ollama** (Local) | `http://localhost:11434/v1` | Locally hosted models via Ollama. |
| **LM Studio** (Local) | `http://localhost:1234/v1` | Local models run in LM Studio. |
| **vLLM** (Local) | `http://localhost:8000/v1` | Local deployment using vLLM. |

*Note: For remote endpoints (OpenAI, Gemini, DeepSeek, etc.), make sure to provide your personal API key on the Setup Screen. These keys are only stored in memory or in your local browser storage (`localStorage`), never committed or uploaded anywhere.*

---

## 🚀 Getting Started

### Prerequisites
Make sure you have [Node.js](https://nodejs.org/) (v18 or higher recommended) installed on your system.

### 1. Installation
Clone the repository and install the dependencies:
```bash
npm install
```

### 2. Run the Development Server
Launch the local development server:
```bash
npm run dev
```
Open your browser and navigate to `http://localhost:5173`.

### 3. Run the CORS Proxy (Optional but Recommended)
Many LLM providers do not serve CORS headers, which prevents browsers from querying them directly. If your connection tests fail with CORS or network errors, start the local proxy:
```bash
npm run proxy
```
* **Proxy Address:** `http://localhost:8787`
* **Usage:** On the game setup screen, enable the **"Route through local proxy"** toggle for the player experiencing CORS issues. The proxy is a lightweight script (`proxy/local-proxy.js`) that forwards requests along with the `Authorization` header. Your API keys never leave your machine.

### 4. Run the Mock Server (Test for Free)
To test the interface, the game loops, and the replay players without spending real tokens, start the mock server:
```bash
npm run mock
```
* **Mock Server Address:** `http://localhost:9999/v1`
* **Usage:** In the player setup, enter `http://localhost:9999/v1` as the Base URL (any API key, and model name `mock-fighter-1`). The mock server will immediately respond with simple, legal actions for any of the four games.
* **Reasoning Mock:** You can also run `node mock/reasoning-mock.js` on port `9998` to simulate a reasoning model (which returns empty content and places its text inside `reasoning_content`), allowing you to test how the UI and engine render thinking chains.

### 5. Running Tests
Run unit tests for the game engines, PRNG system, and parsing utilities:
```bash
npm test
```

### 6. Build for Production
To typecheck and build the optimized production assets:
```bash
npm run build
```
The output files will be generated in the `dist` directory.

---

## 🛠️ Project Architecture

```
├── proxy/
│   └── local-proxy.js        # Lightweight CORS bypass proxy
├── mock/
│   ├── mock-server.js        # Standard LLM mock server
│   └── reasoning-mock.js     # Mock server simulating reasoning models
├── public/                   # Static assets, sprites, and sounds
└── src/
    ├── engine/
    │   ├── GameEngine.ts     # Engine interface and PRNG (mulberry32) helpers
    │   ├── arenaClash.ts     # Tactical RPG rules, status effects, and draft logic
    │   ├── hexDominion.ts    # Conquest mechanics, pathfinding, and hex grid rules
    │   ├── salvo.ts          # Hidden-board Battleship rules
    │   └── standoff.ts       # Simultaneous-reveal duel logic
    ├── llm/
    │   └── LLMClient.ts      # API consumer, JSON extraction, and rate-limit backoff
    ├── match/
    │   ├── MatchController.ts # Turn coordinator, retry budget, and forfeit controller
    │   └── replay.ts          # Replay serialization, snapshots, and key filtering
    ├── store/
    │   └── configStore.ts    # Zustand stores for settings, matches, and database persistence
    └── ui/
        ├── SetupScreen.ts    # Match config UI (endpoints, models, global parameters)
        ├── ArenaScreen.ts    # Game board, live match logs, and stats HUD
        └── ReplayScreen.ts   # Interactive replay timeline player and turn inspector
```

Adding a new game is as simple as implementing the `GameEngine` interface and creating a corresponding board visualizer component. The orchestrator and UI are game-agnostic and will integrate your new game automatically.
