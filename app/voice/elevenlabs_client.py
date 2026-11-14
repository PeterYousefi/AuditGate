import io
import re
import base64
import logging
from typing import Optional, List
from elevenlabs.client import ElevenLabs

from app.config import settings

logger = logging.getLogger(__name__)


def normalize_for_speech(text: str) -> str:
    """
    Pre-TTS Speech Normalizer:
    1. Converts numeric order mentions ('order 1042' or '#1042') into space-separated digits
       ('order 1 0 4 2') so ElevenLabs articulates each digit clearly.
    2. Converts '$28' / '$28.00' into '28 dollars' and '$28.50' into '28 dollars and 50 cents'.
    3. Strips Markdown formatting, brackets, hex IDs, and technical tags.
    """
    if not text:
        return ""
    s = text

    # 1. Currency amounts: $X.YY -> "X dollars and YY cents", $X / $X.00 -> "X dollars"
    def _currency_sub(m):
        dollars = int(m.group(1))
        cents = m.group(2)
        if cents and int(cents) > 0:
            return f"{dollars} dollars and {int(cents)} cents"
        return f"{dollars} dollars"

    s = re.sub(r"\$\s*(\d+)(?:\.(\d{2}))?", _currency_sub, s)

    # 2. Order mentions: "order 1042", "#1042", "order #1042" -> "order 1 0 4 2"
    def _order_sub(m):
        prefix = m.group(1) or "order "
        if "#" in prefix:
            prefix = "order "
        digits = m.group(2)
        spaced = " ".join(digits)
        return f"{prefix.strip()} {spaced}".strip()

    s = re.sub(r"\b(order\s*#?|#)(\d{3,6})\b", _order_sub, s, flags=re.IGNORECASE)

    # 3. Strip Markdown formatting (bold, italic, code, headings)
    s = re.sub(r"(\*\*|__)(.*?)\1", r"\2", s)
    s = re.sub(r"(\*|_)(.*?)\1", r"\2", s)
    s = re.sub(r"`([^`]+)`", r"\1", s)
    s = re.sub(r"#+\s*", "", s)

    # 4. Articulate brand name clearly with space for ElevenLabs TTS
    s = re.sub(r"\bAuditGate\b", "Audit Gate", s, flags=re.IGNORECASE)

    # 5. Strip technical brackets, bullets, and internal IDs
    s = re.sub(r"\[.*?\]", "", s)
    s = re.sub(r"•\s*", "", s)
    s = re.sub(r"\b(?:req|thread)_[0-9a-zA-Z_]+\b", "", s)
    s = re.sub(r"\b[0-9a-f]{24}\b", "", s)

    # 5. Clean up extra whitespace
    s = re.sub(r"\s+", " ", s).strip()
    return s


def generate_speech_audio(text: str, voice_id: Optional[str] = None) -> Optional[bytes]:
    """
    Synthesizes speech using ElevenLabs API with fast 'eleven_flash_v2_5' model
    and pre-normalized speech text.
    Returns raw mp3 audio bytes or None if rate-limited/failed.
    """
    if not settings.ELEVENLABS_API_KEY:
        logger.warning("ELEVENLABS_API_KEY not configured. Falling back to text-only.")
        return None

    # Pre-normalize for pronunciation clarity and low latency
    normalized_text = normalize_for_speech(text)
    if not normalized_text:
        return None
    if len(normalized_text) > 600:
        normalized_text = normalized_text[:597] + "..."

    target_voice = voice_id or settings.ELEVENLABS_VOICE_ID

    try:
        client = ElevenLabs(api_key=settings.ELEVENLABS_API_KEY)
        audio_gen = client.text_to_speech.convert(
            voice_id=target_voice,
            text=normalized_text,
            model_id="eleven_flash_v2_5",
            output_format="mp3_44100_128",
            apply_text_normalization="off"
        )
        audio_bytes = b"".join(audio_gen)
        logger.info(f"ElevenLabs TTS audio generated ({len(audio_bytes)} bytes) using eleven_flash_v2_5.")
        return audio_bytes
    except Exception as e:
        logger.error(f"ElevenLabs TTS exception: {e}. Falling back to text-only.")
        return None


def get_speech_audio_base64(text: str, voice_id: Optional[str] = None) -> Optional[str]:
    """
    Generates audio and returns it as a data URI: data:audio/mpeg;base64,...
    Enables zero-latency direct playback in browser.
    """
    audio_bytes = generate_speech_audio(text, voice_id)
    if audio_bytes:
        encoded = base64.b64encode(audio_bytes).decode("utf-8")
        return f"data:audio/mpeg;base64,{encoded}"
    return None


def convert_speech_to_text(
    audio_bytes: bytes,
    filename: str = "audio.webm",
    keyterms: Optional[List[str]] = None
) -> str:
    """
    Speech-to-Text using ElevenLabs scribe_v3 model.
    Passes numbers_format='digits' and keyterms for demo order numbers and emails.
    """
    if not settings.ELEVENLABS_API_KEY:
        raise ValueError("ELEVENLABS_API_KEY is not configured.")

    if not audio_bytes:
        return ""

    terms = keyterms or ["1042", "1089", "2055", "3010", "refund", "example.com", "alex@example.com", "sarah@example.com"]

    audio_io = io.BytesIO(audio_bytes)
    audio_io.name = filename

    client = ElevenLabs(api_key=settings.ELEVENLABS_API_KEY)
    stt_resp = client.speech_to_text.convert(
        file=audio_io,
        model_id="scribe_v3",
        keyterms=terms,
        numbers_format="digits"
    )
    transcript = getattr(stt_resp, "text", str(stt_resp))
    return transcript.strip()
