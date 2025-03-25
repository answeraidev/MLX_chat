from fastapi import FastAPI, UploadFile, File, Form
import mlx_whisper
import tempfile
import os
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse, FileResponse, JSONResponse
import uuid
import numpy as np
import soundfile as sf
import logging
import openai
from dotenv import load_dotenv

# Load environment variables from .env file if present
load_dotenv()

# Configure logging
logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s")
logger = logging.getLogger("mlx-whisper-tts")

# Import MLX Audio TTS functionality
try:
    from mlx_audio.tts.utils import load_model
    from mlx_audio.tts.audio_player import AudioPlayer
    TTS_AVAILABLE = True
except ImportError:
    logger.warning("MLX Audio not installed. TTS features will be disabled.")
    TTS_AVAILABLE = False

# Configure OpenAI client
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")
if not OPENAI_API_KEY:
    logger.warning("OPENAI_API_KEY not found in environment variables. OpenAI features will be disabled.")
    OPENAI_AVAILABLE = False
else:
    try:
        logger.info(f"Initializing OpenAI client with API key ending in ...{OPENAI_API_KEY[-4:]}")
        openai_client = openai.OpenAI(api_key=OPENAI_API_KEY)
        
        # Try a simple test call to verify the API key works
        test_response = openai_client.chat.completions.create(
            model="gpt-4o-search-preview",
            messages=[{"role": "user", "content": "Hello, testing connection."}],
            max_tokens=5
        )
        logger.info(f"OpenAI test successful. Response: {test_response.choices[0].message.content}")
        
        OPENAI_AVAILABLE = True
        logger.info("OpenAI client initialized successfully and API key verified")
    except Exception as e:
        logger.error(f"Error initializing OpenAI client: {str(e)}")
        import traceback
        logger.error(f"Traceback: {traceback.format_exc()}")
        OPENAI_AVAILABLE = False
        logger.warning("OpenAI features will be disabled due to initialization error.")

# Define the models used
WHISPER_MODEL = "mlx-community/whisper-large-v3-turbo"
OPENAI_MODEL = "gpt-4o"

app = FastAPI()

# Add CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # For development, in production you'd want to specify exact origins
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Mount static files directory
app.mount("/static", StaticFiles(directory="static"), name="static")

# Set up output folder for TTS audio files
OUTPUT_FOLDER = os.path.join(os.path.expanduser("~"), ".mlx_audio", "outputs")
os.makedirs(OUTPUT_FOLDER, exist_ok=True)

# Global variables for TTS
tts_model = None
audio_player = None

# Initialize TTS model and audio player
def setup_tts():
    global tts_model, audio_player
    
    if not TTS_AVAILABLE:
        return
    
    try:
        # Initialize TTS model
        default_model = "mlx-community/Kokoro-82M-4bit"
        logger.info(f"Loading TTS model from {default_model}")
        tts_model = load_model(default_model)
        logger.info("TTS model loaded successfully")
        
        # Initialize audio player
        audio_player = AudioPlayer()
        logger.info("Audio player initialized successfully")
    except Exception as e:
        logger.error(f"Error initializing TTS: {str(e)}")

@app.on_event("startup")
async def startup_event():
    # Initialize TTS model and audio player on server startup
    setup_tts()

async def get_openai_response(transcription_text: str):
    """Query OpenAI API with the transcription text and return the response"""
    if not OPENAI_AVAILABLE:
        logger.warning("OpenAI features are disabled. Skipping OpenAI query.")
        return None

    try:
        logger.info(f"Sending query to OpenAI: '{transcription_text[:50]}...'")
        logger.info(f"Using API key ending with: ...{OPENAI_API_KEY[-4:] if OPENAI_API_KEY else 'None'}")
        logger.info(f"Using model: {OPENAI_MODEL}")
        
        response = openai_client.chat.completions.create(
            model=OPENAI_MODEL,
            messages=[
                {"role": "system", "content": "You are a helpful assistant. Please provide concise responses."},
                {"role": "user", "content": transcription_text}
            ],
            max_tokens=300
        )
        
        logger.info(f"OpenAI API response status: SUCCESS")
        assistant_response = response.choices[0].message.content.strip()
        logger.info(f"Received response from OpenAI: '{assistant_response[:50]}...'")
        return assistant_response
    except Exception as e:
        logger.error(f"Error querying OpenAI: {str(e)}")
        import traceback
        logger.error(f"Traceback: {traceback.format_exc()}")
        return None

@app.post("/transcribe/")
async def transcribe_audio(file: UploadFile = File(...), play_audio: bool = Form(False), use_openai: bool = Form(True)):
    # Create a temporary file to store the uploaded audio
    with tempfile.NamedTemporaryFile(delete=False, suffix=os.path.splitext(file.filename)[1]) as temp_file:
        # Write the uploaded file content to the temporary file
        content = await file.read()
        temp_file.write(content)
        temp_file.flush()
        
        try:
            # Transcribe the audio using MLX Whisper with the specified model
            logger.info(f"Transcribing audio file: {temp_file.name}")
            logger.info(f"Using Whisper model: {WHISPER_MODEL}")
            
            result = mlx_whisper.transcribe(
                temp_file.name,
                path_or_hf_repo=WHISPER_MODEL,
            )
            
            # Clean up the temporary file
            os.unlink(temp_file.name)
            
            transcription_text = result["text"]
            logger.info(f"Transcription result: '{transcription_text[:50]}...'")
            
            # If OpenAI is enabled and requested, get response from OpenAI
            openai_response = None
            if use_openai and OPENAI_AVAILABLE:
                logger.info("OpenAI is enabled and available. Getting response...")
                openai_response = await get_openai_response(transcription_text)
                if openai_response:
                    logger.info(f"OpenAI response received: '{openai_response[:50]}...'")
                else:
                    logger.warning("Failed to get response from OpenAI.")
            else:
                if not use_openai:
                    logger.info("OpenAI integration disabled by user.")
                if not OPENAI_AVAILABLE:
                    logger.warning("OpenAI is not available. Check API key and initialization.")
            
            # Text to use for TTS - either OpenAI response or transcription
            tts_text = openai_response if openai_response else transcription_text
            logger.info(f"Using text for TTS: '{tts_text[:50]}...'")
            
            # If TTS is available, generate audio
            tts_filename = None
            if play_audio and TTS_AVAILABLE and tts_model is not None:
                try:
                    logger.info("Generating TTS audio...")
                    tts_filename = await generate_tts(tts_text)
                    logger.info(f"TTS audio generated: {tts_filename}")
                    
                    # Auto-play the audio response
                    if tts_filename:
                        logger.info("Attempting to auto-play the audio...")
                        play_success = await play_audio_file(tts_filename)
                        if play_success:
                            logger.info("Audio auto-played successfully")
                        else:
                            logger.warning("Failed to auto-play audio")
                except Exception as e:
                    logger.error(f"TTS generation error: {str(e)}")
                    import traceback
                    logger.error(f"TTS traceback: {traceback.format_exc()}")
            else:
                if not play_audio:
                    logger.info("Audio playback disabled by user.")
                if not TTS_AVAILABLE:
                    logger.warning("TTS is not available.")
                if tts_model is None:
                    logger.warning("TTS model is not initialized.")
            
            return {
                "text": transcription_text,
                "openai_response": openai_response,
                "status": "success",
                "tts_filename": tts_filename,
                "models": {
                    "whisper": WHISPER_MODEL,
                    "openai": OPENAI_MODEL if OPENAI_AVAILABLE else None,
                    "tts": "mlx-community/Kokoro-82M-4bit" if TTS_AVAILABLE else None
                }
            }
        except Exception as e:
            # Clean up the temporary file in case of error
            os.unlink(temp_file.name)
            logger.error(f"Transcription error: {str(e)}")
            import traceback
            logger.error(f"Transcription traceback: {traceback.format_exc()}")
            return {
                "error": str(e),
                "status": "error"
            }

async def generate_tts(text: str, voice: str = "af_heart", speed: float = 1.0):
    """Generate TTS audio for the given text and return the filename"""
    global tts_model
    
    if not text.strip():
        raise ValueError("Text is empty")
    
    if tts_model is None:
        raise ValueError("TTS model not initialized")
    
    # Generate a unique filename
    unique_id = str(uuid.uuid4())
    filename = f"tts_{unique_id}.wav"
    output_path = os.path.join(OUTPUT_FOLDER, filename)
    
    logger.info(f"Generating TTS for text: '{text[:50]}...' with voice: {voice}, speed: {speed}")
    
    # Generate TTS
    results = tts_model.generate(
        text=text,
        voice=voice,
        speed=speed,
        lang_code=voice[0],
        verbose=False,
    )
    
    # Gather all segments into a single wav
    audio_arrays = []
    for segment in results:
        audio_arrays.append(segment.audio)
    
    if not audio_arrays:
        raise ValueError("No audio segments generated")
    
    # Concatenate all segments
    cat_audio = np.concatenate(audio_arrays, axis=0)
    
    # Write the audio as a WAV
    sf.write(output_path, cat_audio, 24000)
    
    if not os.path.exists(output_path) or os.path.getsize(output_path) == 0:
        raise ValueError("Failed to create audio file or file is empty")
    
    return filename

async def play_audio_file(filename: str):
    """Play an audio file using the audio player"""
    global audio_player
    
    if not TTS_AVAILABLE or audio_player is None:
        return False
    
    file_path = os.path.join(OUTPUT_FOLDER, filename)
    if not os.path.exists(file_path):
        logger.error(f"Audio file not found: {file_path}")
        return False
    
    try:
        # Load the audio file
        audio_data, sample_rate = sf.read(file_path)
        
        # If audio is stereo, convert to mono
        if len(audio_data.shape) > 1 and audio_data.shape[1] > 1:
            audio_data = audio_data.mean(axis=1)
        
        # Queue the audio for playback
        audio_player.queue_audio(audio_data)
        logger.info(f"Auto-playing audio file: {filename}")
        return True
    except Exception as e:
        logger.error(f"Failed to auto-play audio: {str(e)}")
        return False

@app.get("/audio/{filename}")
def get_audio_file(filename: str):
    """Return an audio file from the outputs folder"""
    file_path = os.path.join(OUTPUT_FOLDER, filename)
    
    if not os.path.exists(file_path):
        return JSONResponse({"error": "File not found"}, status_code=404)
    
    return FileResponse(file_path, media_type="audio/wav")

@app.post("/play")
async def play_audio(filename: str = Form(...)):
    """Play audio directly from the server using the AudioPlayer"""
    global audio_player
    
    if not TTS_AVAILABLE or audio_player is None:
        return JSONResponse({"error": "Audio player not initialized"}, status_code=500)
    
    file_path = os.path.join(OUTPUT_FOLDER, filename)
    if not os.path.exists(file_path):
        return JSONResponse({"error": "File not found"}, status_code=404)
    
    try:
        # Load the audio file
        audio_data, sample_rate = sf.read(file_path)
        
        # If audio is stereo, convert to mono
        if len(audio_data.shape) > 1 and audio_data.shape[1] > 1:
            audio_data = audio_data.mean(axis=1)
        
        # Queue the audio for playback
        audio_player.queue_audio(audio_data)
        
        return {"status": "playing", "filename": filename}
    except Exception as e:
        return JSONResponse({"error": f"Failed to play audio: {str(e)}"}, status_code=500)

@app.post("/stop")
async def stop_audio():
    """Stop any currently playing audio"""
    global audio_player
    
    if not TTS_AVAILABLE or audio_player is None:
        return JSONResponse({"error": "Audio player not initialized"}, status_code=500)
    
    try:
        audio_player.stop()
        return {"status": "stopped"}
    except Exception as e:
        return JSONResponse({"error": f"Failed to stop audio: {str(e)}"}, status_code=500)

@app.get("/")
async def root():
    # Serve the index.html file
    with open("static/index.html", "r") as f:
        html_content = f.read()
    return HTMLResponse(content=html_content)