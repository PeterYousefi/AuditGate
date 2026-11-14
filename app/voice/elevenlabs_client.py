import base64
import logging
from typing import Optional
import httpx

from app.config import settings

logger = logging.getLogger(__name__)


def generate_speech_audio(text: str, voice_id: Optional[str] = None) -> Optional[bytes]:
    """
    Synthesizes speech using ElevenLabs API.
    Uses ultra-fast 'eleven_flash_v2_5' model.
    Returns raw mp3 audio bytes or None if rate-limited/failed.
    """
    if not settings.ELEVENLABS_API_KEY:
        logger.warning("ELEVENLABS_API_KEY not configured. Falling back to text-only.")
        return None

    # Clean text to prevent excessive token usage
    clean_text = text.strip()
    if not clean_text:
        return None
    if len(clean_text) > 600:
        clean_text = clean_text[:597] + "..."

    target_voice = voice_id or settings.ELEVENLABS_VOICE_ID
    url = f"https://api.elevenlabs.io/v1/text-to-speech/{target_voice}"

    headers = {
        "xi-api-key": settings.ELEVENLABS_API_KEY,
        "Content-Type": "application/json",
        "Accept": "audio/mpeg"
    }

    payload = {
        "text": clean_text,
        "model_id": settings.ELEVENLABS_MODEL_ID,
        "voice_settings": {
            "stability": 0.5,
            "similarity_boost": 0.75,
            "style": 0.0,
            "use_speaker_boost": True
        }
    }

    try:
        with httpx.Client(timeout=15.0) as client:
            resp = client.post(url, headers=headers, json=payload)
            if resp.status_code == 200:
                logger.info(f"ElevenLabs TTS audio generated successfully ({len(resp.content)} bytes).")
                return resp.content
            else:
                logger.warning(
                    f"ElevenLabs TTS API returned HTTP {resp.status_code}: {resp.text[:200]}. "
                    "Gracefully falling back to text-only."
                )
                return None
    except Exception as e:
        logger.error(f"ElevenLabs TTS exception: {e}. Gracefully falling back to text-only.")
        return None


def get_speech_audio_base64(text: str, voice_id: Optional[str] = None) -> Optional[str]:
    """
    Generates audio and returns it as a data URI: data:audio/mpeg;base64,...
    Enables zero-latency direct playback in browser without secondary requests.
    """
    audio_bytes = generate_speech_audio(text, voice_id)
    if audio_bytes:
        encoded = base64.b64encode(audio_bytes).decode("utf-8")
        return f"data:audio/mpeg;base64,{encoded}"
    return None
