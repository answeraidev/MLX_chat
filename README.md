# MLX Whisper Voice Recorder

A web application that allows users to record their voice by holding down the spacebar, and then have it transcribed using MLX Whisper.

## Features

- Press and hold the spacebar to record audio
- Release the spacebar to automatically transcribe the recording
- Clean and intuitive user interface
- Real-time feedback during recording

## Requirements

- Python 3.8+
- MLX Whisper library
- Web browser with microphone access

## Installation

1. Clone this repository
2. Install the required packages:

```
pip install -r requirements.txt
```

## Usage

1. Start the server:

```
uvicorn app:app --reload
```

2. Open your browser and navigate to `http://localhost:8000`
3. Grant microphone access when prompted
4. Press and hold the spacebar to start recording
5. Release the spacebar to stop recording and see the transcription

## Project Structure

- `app.py`: FastAPI backend for serving the web interface and handling transcription
- `static/`: Directory containing all frontend assets
  - `index.html`: Main HTML page
  - `styles.css`: CSS styling
  - `app.js`: JavaScript for handling recording and UI interaction

## Note

This application uses the browser's MediaRecorder API to record audio, which may not be supported in all browsers. For best results, use a modern browser like Chrome, Firefox, or Edge. 