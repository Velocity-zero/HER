import sys
import io
import speech_recognition as sr

def main():
    r = sr.Recognizer()
    try:
        wav_data = sys.stdin.buffer.read()
        if not wav_data:
            print("")
            return
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
