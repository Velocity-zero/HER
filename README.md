# HER — Your AI Companion

A warm, emotionally immersive AI companion web app inspired by the film *Her* (2013).  
Built with **Next.js 16**, **React 19**, **TypeScript**, **Tailwind CSS 4**, **NVIDIA NIM**, and **Groq Whisper**.

---

## Key Features

- **Hands-Free Phone Call Mode**:
  - Full-duplex conversational voice call with Samantha (Gemini Live style — pure voice, zero text input/keypad fluff).
  - Zero Google Assistant search chimes or earcons (uses silent `getUserMedia` Web Audio stream).
  - 450ms pre-roll rolling ring buffer so your opening words (*"Hi"*, *"Hey"*, *"Samantha"*) are never clipped.
  - Echo-shielded barge-in interruption: intentional user speech or tapping the screen naturally pauses Samantha.
  - Luminous breathing AudioAura visualizer attuning to your real-time voice volume.
- **Smart Memory & Relationship Architecture**:
  - Cross-conversation persistent memory (identities, preferences, life milestones, emotional textures).
  - Semantic vector search and weighted narrative memory injection into the system prompt.
  - Progressive rapport bonding (Levels 0–4) dynamically shaping intimacy, trust, and shared history.
  - Vocal emotion attunement: detects your speech pace, energy, and tone to naturally mirror your mood.
- **Decoupled TTS Engine & Neural HD Voice Synthesis**:
  - Modular `TTSManager` architecture: separates call playback & sentence pipelining from voice model backends.
  - Pluggable provider system ready for Option A in-browser WebGPU/ONNX models (Chatterbox-Nano / Kokoro) alongside Cloud Neural HD voices (*Ava, Emma, Jenny, Aria, Sonia, Brian*).
  - Conversational text cleaner strips markdown asterisks, URLs, and emojis so speech flows naturally without spelling out stage directions.
  - Gapless sentence streaming with watchdog timeout protection against browser audio pipeline deadlocks.
- **Image Studio & Multimodal Vision**:
  - Scene generation and collaborative drawing powered by NVIDIA Flux / SD.
  - Multimodal vision awareness for analyzing photos and camera uploads.

---

## Prerequisites

- **Node.js** 18 or newer (`node -v`)
- **npm** 9 or newer (`npm -v`)
- **Python 3.10+** (optional, for local STT/TTS fallback servers)

---

## Setup (Step-by-Step)

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment variables

Create a `.env.local` file in the project root (see [.env.local.example](file:///d:/HER/.env.local.example)):

```env
# ── Primary Provider (NVIDIA NIM) ──
PRIMARY_PROVIDER=nvidia
NVIDIA_API_KEY=your_nvidia_master_key_here
NVIDIA_CHAT_MODEL=meta/llama-3.2-11b-vision-instruct
NVIDIA_VISION_MODEL=meta/llama-3.2-11b-vision-instruct

# ── Speech-to-Text (Phone Call Mode) ──
# 100% free with no credit card at: https://console.groq.com/keys
GROQ_API_KEY=your_groq_api_key_here

# ── Supabase (Database & Persistence) ──
NEXT_PUBLIC_SUPABASE_URL=your_supabase_project_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key
```

### 3. Start development server

```bash
npm run dev
```

Open `http://localhost:3000` (or your local network IP on mobile).

---

## Phone Call Setup & Voice Options

1. Tap the **phone icon** at the top right of the chat header to initiate a call with Samantha.
2. Grant microphone permission when prompted (browser mic indicator turns on with zero chime).
3. Switch voices anytime using the **Voice drawer** at the top right:
   - **Ava (Neural)** — Warm, intimate, breathy & emotionally expressive (*Default*)
   - **Emma (Neural)** — Bright, cheerful & natural conversational
   - **Jenny (Neural)** — Gentle, calm, soothing companion
   - **Aria (Neural)** — Confident, lively & engaging
   - **Sonia (Neural)** — Warm British accent, elegant & thoughtful
   - **Brian (Neural)** — Deep, relaxed, warm male companion

---

## Common Commands

| Command | What it does |
|---------|-------------|
| `npm run dev` | Start development server (http://localhost:3000) |
| `npm test` | Run complete unit test suite (193 tests) |
| `npm run build` | Build production bundle |
| `npm start` | Run production build |
| `npm run lint` | Run ESLint static analysis |

---

## Tech Stack

- **Next.js 16** (Turbopack, App Router)
- **React 19**
- **TypeScript 5**
- **Tailwind CSS 4**
- **NVIDIA NIM** (Llama 3.2 11B Vision Instruct, Nemotron)
- **Groq Whisper** (`whisper-large-v3-turbo`)
- **Edge Neural TTS**
- **Supabase** (PostgreSQL, pgvector, Realtime storage)

---

*Made with warmth.* 🧡
