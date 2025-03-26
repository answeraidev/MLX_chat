# MLX Whisper Voice Assistant

A web application that allows users to record their voice by holding down the spacebar, have it transcribed using MLX Whisper, and get AI responses using OpenAI. The responses can also be played back using Text-to-Speech.

## Features

- Press and hold the spacebar to record audio
- Release the spacebar to automatically transcribe the recording 
- Get AI responses from OpenAI based on your transcribed audio
- Text-to-Speech playback of responses
- Clean and intuitive user interface with loading animations
- Real-time feedback during recording and processing

## Requirements

- Python 3.8+
- MLX Whisper library
- MLX Audio for TTS features
- OpenAI API key for AI responses
- Web browser with microphone access

## Installation

1. Clone this repository
2. Install the required packages:

```
pip install -r requirements.txt
```

3. Set up your OpenAI API key:
   - Copy the `.env.example` file to `.env`
   - Replace `your_openai_api_key_here` with your actual OpenAI API key
   - If you don't have an OpenAI API key, you can [create one here](https://platform.openai.com/api-keys)

## Usage

1. Start the server:

```
uvicorn app:app --reload
```

2. Open your browser and navigate to `http://localhost:8000`
3. Grant microphone access when prompted
4. Press and hold the spacebar to start recording
5. Release the spacebar to stop recording and see the transcription
6. The AI response will appear below your transcription, along with audio playback controls

## Configuration Options

In the web interface, you can:

- Enable/disable AI responses from OpenAI
- Enable/disable TTS audio playback

## Project Structure

- `app.py`: FastAPI backend for serving the web interface, handling transcription, OpenAI integration, and TTS
- `static/`: Directory containing all frontend assets
  - `index.html`: Main HTML page
  - `styles.css`: CSS styling
  - `app.js`: JavaScript for handling recording and UI interaction
- `.env.example`: Example environment file for API keys

## Note

This application uses the browser's MediaRecorder API to record audio, which may not be supported in all browsers. For best results, use a modern browser like Chrome, Firefox, or Edge. 