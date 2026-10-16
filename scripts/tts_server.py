import asyncio
import edge_tts
from aiohttp import web

PREVIEWS = {
    "en-US-AvaMultilingualNeural": "Hey Theodore, I was just thinking about you.",
    "en-US-EmmaMultilingualNeural": "Hi! It's so lovely talking with you today.",
    "en-US-JennyNeural": "I'm right here with you. Take your time.",
    "en-US-AriaNeural": "That's fascinating! Tell me more about that.",
    "en-GB-SoniaNeural": "Hello there. Wonderful to hear your voice.",
    "en-US-BrianMultilingualNeural": "Hey, I'm glad you called. How are you doing today?",
}

cache = {}

async def synthesize(text: str, voice: str, rate: str = "+0%", pitch: str = "+0Hz", volume: str = "+0%") -> bytes:
    key = f"{voice}:{rate}:{pitch}:{volume}:{text}"
    if key in cache:
        return cache[key]
    communicate = edge_tts.Communicate(text, voice, rate=rate, pitch=pitch, volume=volume)
    mp3_chunks = []
    async for chunk in communicate.stream():
        if chunk["type"] == "audio":
            mp3_chunks.append(chunk["data"])
    data = b"".join(mp3_chunks)
    if data:
        if len(cache) > 250:
            cache.pop(next(iter(cache)))
        cache[key] = data
    return data

async def handle_tts(request):
    try:
        body = await request.json()
        text = body.get("text", "").strip()
        voice = body.get("voice", "en-US-AvaMultilingualNeural")
        rate = body.get("rate", "+0%")
        pitch = body.get("pitch", "+0Hz")
        volume = body.get("volume", "+0%")
        if not text:
            return web.Response(status=400, text="Empty text")
        audio = await synthesize(text, voice, rate, pitch, volume)
        if not audio:
            return web.Response(status=502, text="TTS synthesis failed")
        return web.Response(body=audio, content_type="audio/mpeg")
    except Exception as e:
        return web.Response(status=500, text=str(e))

async def handle_health(request):
    return web.json_response({"status": "ok", "cached": len(cache)})

async def prewarm():
    print("[TTS Server] Pre-warming preview voices...")
    for voice, text in PREVIEWS.items():
        try:
            await synthesize(text, voice)
            print(f"[TTS Server] Pre-warmed {voice}")
        except Exception as e:
            print(f"[TTS Server] Failed pre-warm for {voice}: {e}")

async def start_background_tasks(app):
    asyncio.create_task(prewarm())

def create_app():
    app = web.Application()
    app.router.add_post("/tts", handle_tts)
    app.router.add_get("/health", handle_health)
    app.on_startup.append(start_background_tasks)
    return app

if __name__ == "__main__":
    app = create_app()
    web.run_app(app, host="127.0.0.1", port=5055)
