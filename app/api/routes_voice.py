import base64
import logging
from typing import Optional
from fastapi import APIRouter, HTTPException, UploadFile, File, Form
from fastapi.responses import Response
from pydantic import BaseModel, Field

from app.voice.elevenlabs_client import (
    generate_speech_audio,
    get_speech_audio_base64,
    convert_speech_to_text,
    normalize_for_speech
)

logger = logging.getLogger(__name__)

router = APIRouter()

DEFAULT_PROACTIVE_GREETING = "Hi, welcome to Verve support. Please share your order number and purchase email, and let me know how I can help today."


class TTSRequest(BaseModel):
    text: str = Field(..., max_length=1000, description="Text to synthesize to speech")
    voice_id: Optional[str] = Field(None, description="ElevenLabs voice ID")


class STTBase64Request(BaseModel):
    audio_base64: str = Field(..., description="Base64 encoded audio string")
    filename: Optional[str] = Field("recording.webm", description="Audio filename/extension")


@router.post("/api/stt")
async def speech_to_text_endpoint(
    file: Optional[UploadFile] = File(None),
    audio_base64: Optional[str] = Form(None)
):
    """
    Speech-to-Text Push-to-Talk endpoint using ElevenLabs scribe_v3.
    Supports either multipart/form-data file upload OR form/json base64 audio.
    """
    try:
        audio_bytes = b""
        filename = "recording.webm"

        if file:
            audio_bytes = await file.read()
            filename = file.filename or "recording.webm"
        elif audio_base64:
            clean_b64 = audio_base64
            if "," in clean_b64:
                clean_b64 = clean_b64.split(",", 1)[1]
            audio_bytes = base64.b64decode(clean_b64)

        if not audio_bytes:
            raise HTTPException(status_code=400, detail="No audio data provided.")

        transcript = convert_speech_to_text(audio_bytes, filename=filename)
        logger.info(f"ElevenLabs scribe_v3 STT transcribed: '{transcript}'")
        return {"success": True, "text": transcript}
    except Exception as e:
        logger.error(f"STT conversion failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/api/stt/json")
async def speech_to_text_json_endpoint(req: STTBase64Request):
    """
    Speech-to-Text JSON endpoint using ElevenLabs scribe_v3.
    """
    try:
        clean_b64 = req.audio_base64
        if "," in clean_b64:
            clean_b64 = clean_b64.split(",", 1)[1]
        audio_bytes = base64.b64decode(clean_b64)
        transcript = convert_speech_to_text(audio_bytes, filename=req.filename or "recording.webm")
        return {"success": True, "text": transcript}
    except Exception as e:
        logger.error(f"STT JSON conversion failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/api/voice/tts")
@router.post("/api/tts")
async def text_to_speech_endpoint(req: TTSRequest):
    """
    Synthesizes speech using ElevenLabs API with fast eleven_flash_v2_5
    and pre-TTS normalizer.
    """
    try:
        audio_b64 = get_speech_audio_base64(req.text, req.voice_id)
        if not audio_b64:
            return {"success": False, "audio_base64": None, "message": "Voice synthesis failed or rate-limited. Falling back to text-only."}
        return {"success": True, "audio_base64": audio_b64}
    except Exception as e:
        logger.error(f"TTS endpoint error: {e}")
        return {"success": False, "audio_base64": None, "message": str(e)}


@router.get("/api/voice/greeting")
async def proactive_voice_greeting_endpoint():
    """
    Returns the pre-generated spoken greeting for the 'Start Voice Support' CTA button:
    'Hi, welcome to Verve support. Please share your order number and purchase email, and let me know how I can help today.'
    """
    try:
        audio_b64 = get_speech_audio_base64(DEFAULT_PROACTIVE_GREETING)
        return {
            "success": True,
            "text": DEFAULT_PROACTIVE_GREETING,
            "audio_base64": audio_b64
        }
    except Exception as e:
        logger.error(f"Greeting synthesis error: {e}")
        return {
            "success": False,
            "text": DEFAULT_PROACTIVE_GREETING,
            "audio_base64": None,
            "message": str(e)
        }


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
