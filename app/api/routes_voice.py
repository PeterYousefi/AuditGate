import logging
from typing import Optional
from fastapi import APIRouter, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel, Field

from app.voice.elevenlabs_client import generate_speech_audio, get_speech_audio_base64

logger = logging.getLogger(__name__)

router = APIRouter()


class TTSRequest(BaseModel):
    text: str = Field(..., max_length=1000, description="Text to synthesize to speech")
    voice_id: Optional[str] = Field(None, description="ElevenLabs voice ID")


@router.post("/api/voice/tts")
async def text_to_speech_endpoint(req: TTSRequest):
    """
    Synthesizes speech using ElevenLabs API and returns base64 audio data URI.
    """
    try:
        audio_b64 = get_speech_audio_base64(req.text, req.voice_id)
        if not audio_b64:
            return {"success": False, "audio_base64": None, "message": "Voice synthesis failed or rate-limited. Falling back to text-only."}
        return {"success": True, "audio_base64": audio_b64}
    except Exception as e:
        logger.error(f"TTS endpoint error: {e}")
        return {"success": False, "audio_base64": None, "message": str(e)}


@router.post("/api/voice/stream")
async def stream_audio_endpoint(req: TTSRequest):
    """
    Synthesizes speech and streams mp3 audio directly.
    """
    try:
        audio_bytes = generate_speech_audio(req.text, req.voice_id)
        if not audio_bytes:
            raise HTTPException(status_code=503, detail="Voice generation unavailable.")
        return Response(content=audio_bytes, media_type="audio/mpeg")
    except Exception as e:
        logger.error(f"Audio stream error: {e}")
        raise HTTPException(status_code=500, detail=str(e))
