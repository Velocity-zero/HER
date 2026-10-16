import sys
import io
import subprocess
import speech_recognition as sr

def convert_to_wav(raw_bytes: bytes) -> bytes:
    # Use ffmpeg to convert any WebM/Opus/MP4/OGG/WAV buffer to 16kHz Mono WAV in memory
    try:
        proc = subprocess.Popen(
            ["ffmpeg", "-y", "-i", "pipe:0", "-f", "wav", "-ar", "16000", "-ac", "1", "pipe:1"],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
        )
        wav_out, _ = proc.communicate(input=raw_bytes)
        if proc.returncode == 0 and wav_out:
            return wav_out
    except Exception as e:
        sys.stderr.write(f"ffmpeg conversion error: {e}\n")
    return raw_bytes

def main():
    r = sr.Recognizer()
    try:
        raw_data = sys.stdin.buffer.read()
        if not raw_data:
            print("")
            return
        wav_data = convert_to_wav(raw_data)
        buf = io.BytesIO(wav_data)
        with sr.AudioFile(buf) as source:
            audio = r.record(source)
        text = r.recognize_google(audio)
        print(text)
    except sr.UnknownValueError:
        print("")
    except Exception as e:
        sys.stderr.write(f"STT Error: {e}\n")
        print("")

if __name__ == "__main__":
    main()
