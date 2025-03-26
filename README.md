# MLX Whisper Voice Assistant

A web application that allows users to record their voice by holding down the spacebar, have it transcribed and interact with AI - all running locally on Apple Silicon using MLX models.

## Features

- Press and hold the spacebar to record audio
- Release the spacebar to automatically transcribe the recording 
- Get AI responses using local MLX models
- Text-to-Speech playback of responses
- Voice Activity Detection (VAD) for better audio capture
- Clean and intuitive user interface with loading animations

## Models & Credits

This project integrates several open-source models and libraries:

- **Speech Recognition**: Using [MLX Whisper](https://github.com/ml-explore/mlx-examples/tree/main/whisper) - `mlx-community/whisper-large-v3-turbo`
- **Language Model**: Using [MLX LM](https://github.com/ml-explore/mlx-lm) - `mlx-community/Mistral-7B-Instruct-v0.3-4bit`
- **Text-to-Speech**: Using [MLX Audio](https://github.com/Blaizzy/mlx-audio) - `mlx-community/Kokoro-82M-4bit`
- **Voice Activity Detection**: Using [Silero VAD](https://github.com/snakers4/silero-vad) for precise audio capture

## Requirements

- macOS with Apple Silicon (MLX requirement)
- Python 3.8+
- Web browser with microphone access

## Installation

1. Clone this repository
2. Install the required packages:

```bash
pip install -r requirements.txt
```

## Configuration

1. The application provides a user-friendly configuration interface accessible through the gear icon (⚙️) in the UI where you can:
   - Set your custom system prompt to control how the AI assistant behaves
   - Enable/disable Voice Activity Detection
   - Configure TTS settings

## Running the Application

1. Start the FastAPI server:
```bash
uvicorn app:app --reload
```

2. The application will be available at http://localhost:8000
3. Click the gear icon (⚙️) in the top-right corner to access configuration settings

## Notes

- All processing is done locally on your Apple Silicon Mac
- No API keys or internet connection required
- Processing speed and memory usage will depend on your Mac's capabilities

## Acknowledgments

This project is built upon several amazing open-source projects:
- [MLX](https://github.com/ml-explore/mlx) by Apple
- [MLX Examples (Whisper)](https://github.com/ml-explore/mlx-examples) for speech recognition
- [MLX LM](https://github.com/ml-explore/mlx-lm) for the language model implementation
- [MLX Audio](https://github.com/Blaizzy/mlx-audio) for text-to-speech capabilities
- [Silero VAD](https://github.com/snakers4/silero-vad) for voice activity detection

## License

MIT License