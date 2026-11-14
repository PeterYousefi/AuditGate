# 🎙️ ElevenLabs Real-Time Voice Output Integration

## Overview

AuditGate incorporates natural voice feedback powered by ElevenLabs:
- **TTS Model:** `eleven_flash_v2_5` (ultra-low latency, sub-200ms audio generation).
- **Default Voice:** `21m00Tcm4TlvDq8ikWAM` (Rachel - clear, professional customer support tone).
- **Playback Architecture:** Audio is delivered as base64 data URIs directly within chat JSON payloads, eliminating secondary network latency and enabling instantaneous browser playback.

## Resilience & Fallbacks

1. **Graceful Text-Only Fallback:** If ElevenLabs encounters rate limits or network degradation, the backend catches the error, logs a warning, and returns text-only without degrading agent execution.
2. **User Mute Control:** The browser interface includes a live toggle to enable or mute voice output at any time.
3. **Animated Wave Visualizer:** When speaking, an audio frequency wave animation displays in the interface to highlight active speech.
