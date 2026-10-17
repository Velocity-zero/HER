import sys
import io
import os
import subprocess
import speech_recognition as sr

def convert_file_to_wav(input_path: str, output_path: str) -> bool:
    try:
        proc = subprocess.run(
            ["ffmpeg", "-y", "-i", input_path, "-f", "wav", "-ar", "16000", "-ac", "1", output_path],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            timeout=5,
        )
        return proc.returncode == 0 and os.path.exists(output_path) and os.path.getsize(output_path) > 44
    except Exception as e:
        sys.stderr.write(f"ffmpeg conversion error: {e}\n")
        return False

def main():
    r = sr.Recognizer()
    try:
        if len(sys.argv) > 1:
            input_file = sys.argv[1]
            if not os.path.exists(input_file) or os.path.getsize(input_file) < 44:
                print("")
                return

            wav_target = input_file
            is_temp_wav = False

            # Check if input file is already standard RIFF WAV
            with open(input_file, "rb") as f:
                header = f.read(4)
                if header != b"RIFF":
                    wav_target = input_file + ".converted.wav"
                    is_temp_wav = True
                    ok = convert_file_to_wav(input_file, wav_target)
                    if not ok:
                        print("")
                        return

            try:
                with sr.AudioFile(wav_target) as source:
                    audio = r.record(source)
                text = r.recognize_google(audio)
                print(text)
            finally:
                if is_temp_wav and os.path.exists(wav_target):
                    try:
                        os.remove(wav_target)
                    except:
                        pass
        else:
            raw_data = sys.stdin.buffer.read()
            if not raw_data:
                print("")
                return
            buf = io.BytesIO(raw_data)
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
