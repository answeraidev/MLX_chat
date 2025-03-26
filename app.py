from fastapi import FastAPI, UploadFile, File, Form, WebSocket
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
from dotenv import load_dotenv
import mlx
from mlx_lm import load, generate
import io
import base64
import asyncio
import json
import torch

# Replace Silero VAD direct import with torch.hub method
# from silero_vad import load_silero_vad, get_speech_timestamps, read_audio as vad_read_audio

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

# Define the models used
WHISPER_MODEL = "mlx-community/whisper-large-v3-turbo"
LLM_MODEL = "mlx-community/Mistral-7B-Instruct-v0.3-4bit"  # Using Mistral 7B 4-bit quantized

# Initialize MLX LM model
try:
    logger.info(f"Loading MLX LM model from {LLM_MODEL}")
    llm_model, tokenizer = load(LLM_MODEL)
    LLM_AVAILABLE = True
    logger.info("MLX LM model loaded successfully")
except Exception as e:
    logger.error(f"Error loading MLX LM model: {str(e)}")
    import traceback
    logger.error(f"Traceback: {traceback.format_exc()}")
    LLM_AVAILABLE = False
    logger.warning("LLM features will be disabled due to initialization error.")

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

# Load Silero VAD model once at startup
vad_model = None
vad_get_speech_timestamps = None
vad_read_audio = None

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
    
    # Initialize Silero VAD model
    global vad_model, vad_get_speech_timestamps, vad_read_audio
    try:
        logger.info("Loading Silero VAD model")
        torch.set_num_threads(1)  # To avoid performance issues
        model, utils = torch.hub.load(repo_or_dir='snakers4/silero-vad', model='silero_vad')
        vad_model = model
        vad_get_speech_timestamps, _, vad_read_audio, _, _ = utils
        logger.info("Silero VAD model loaded successfully")
    except Exception as e:
        logger.error(f"Error loading Silero VAD model: {str(e)}")
        import traceback
        logger.error(f"Traceback: {traceback.format_exc()}")
        logger.warning("VAD features will be disabled due to initialization error.")

async def get_llm_response(transcription_text: str):
    """Query local MLX LM model with the transcription text and return the response"""
    if not LLM_AVAILABLE:
        logger.warning("LLM features are disabled. Skipping LLM query.")
        return None

    try:
        logger.info(f"Sending query to MLX LM: '{transcription_text[:50]}...'")
        
        # Simple prompt format
        prompt = f"Q: {transcription_text}\nA: "
        
        # Generate response with minimal parameters
        response = generate(
            llm_model, 
            tokenizer, 
            prompt=prompt,
            max_tokens=100,  # Reduced for more concise responses
            verbose=False  # Disable verbose output
        )
        
        # Clean up the response
        response = response.strip().split('\n')[0]  # Take only the first line
        logger.info(f"MLX LM response: '{response}'")
            
        return response
    except Exception as e:
        logger.error(f"Error querying MLX LM: {str(e)}")
        import traceback
        logger.error(f"Traceback: {traceback.format_exc()}")
        return None

@app.post("/transcribe/")
async def transcribe_audio(file: UploadFile = File(...), play_audio: bool = Form(False), use_llm: bool = Form(True)):
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
            
            # Store transcription in a temporary location with unique ID for later retrieval
            transcription_id = str(uuid.uuid4())
            
            response_data = {
                "text": transcription_text,
                "transcription_id": transcription_id,
                "status": "success",
                "models": {
                    "whisper": WHISPER_MODEL,
                    "llm": LLM_MODEL if LLM_AVAILABLE else None,
                    "tts": "mlx-community/Kokoro-82M-4bit" if TTS_AVAILABLE else None
                }
            }
            
            # If LLM is requested and available, trigger the response asynchronously
            if use_llm and LLM_AVAILABLE:
                # Create a task to process LLM response and TTS in the background
                asyncio.create_task(process_llm_and_tts(transcription_id, transcription_text, play_audio))
            
            return response_data
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

# Dictionary to store LLM responses and TTS filenames
results_store = {}

async def process_llm_and_tts(transcription_id: str, transcription_text: str, play_audio: bool = False):
    """Process LLM response and TTS generation in the background"""
    try:
        # Initialize the result in the store with processing state
        results_store[transcription_id] = {
            "llm_response": None,
            "tts_filename": None,
            "completed": False,
            "error": None,
            "status": "processing"
        }

        # Get response from LLM
        llm_response = await get_llm_response(transcription_text)
        
        if llm_response is None:
            # Handle the case where we got no response from the LLM
            results_store[transcription_id].update({
                "completed": True,
                "error": "No response from LLM model",
                "status": "error"
            })
            return
        
        # Store the successful LLM response
        results_store[transcription_id].update({
            "llm_response": llm_response,
            "completed": True,
            "status": "success"
        })
        
        # Generate TTS if enabled
        if play_audio and TTS_AVAILABLE:
            try:
                tts_filename = await generate_tts(llm_response)
                results_store[transcription_id]["tts_filename"] = tts_filename
            except Exception as e:
                logger.error(f"Error in TTS processing: {str(e)}")
                import traceback
                logger.error(f"TTS traceback: {traceback.format_exc()}")
                # Don't mark as error if TTS fails, just log it
                logger.warning("TTS failed but continuing with LLM response")
    except Exception as e:
        logger.error(f"Error in background processing: {str(e)}")
        import traceback
        logger.error(f"Background processing traceback: {traceback.format_exc()}")
        # Store the error in results
        results_store[transcription_id].update({
            "completed": True,
            "error": str(e),
            "status": "error"
        })

@app.get("/get_response/{transcription_id}")
async def get_response(transcription_id: str):
    """Get the LLM response and TTS filename for a given transcription ID"""
    if transcription_id not in results_store:
        return JSONResponse({"error": "Transcription ID not found", "status": "error"}, status_code=404)
    
    result = results_store[transcription_id]
    
    if not result.get("completed", False):
        return {"status": "processing"}
    
    # If we have a successful LLM response, return it
    if result.get("status") == "success":
        return {
            "status": "success",
            "llm_response": result.get("llm_response"),
            "tts_filename": result.get("tts_filename")
        }
    
    # If there was an error, return the error
    return {
        "status": "error",
        "error": result.get("error", "Unknown error"),
        "llm_response": None,
        "tts_filename": None
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

@app.websocket("/vad-stream/")
async def vad_stream(websocket: WebSocket):
    await websocket.accept()
    logger.info("VAD WebSocket connection established")
    
    try:
        # Buffer to accumulate audio data
        audio_buffer = []
        speech_detected = False
        
        # Keep track of consecutive speech/non-speech frames for debouncing
        consecutive_speech_frames = 0
        consecutive_silence_frames = 0
        
        while True:
            # Receive audio chunk
            data = await websocket.receive_text()
            
            # Skip empty data or client closing messages
            if not data or data == "close":
                break
            
            # Decode base64 audio data
            try:
                audio_data = base64.b64decode(data.split(',')[1] if ',' in data else data)
                audio_np = np.frombuffer(audio_data, dtype=np.float32)
                
                # Add chunk to buffer
                audio_buffer.append(audio_np)
                
                # Process with VAD if we have enough data
                if len(audio_buffer) >= 3:
                    combined_audio = np.concatenate(audio_buffer)
                    
                    # Process with Silero VAD
                    if vad_model is not None and vad_get_speech_timestamps is not None:
                        # Lower threshold for initial detection to be more sensitive (0.65 → 0.5)
                        # Maintain moderate threshold for ongoing speech (0.4)
                        threshold = 0.4 if speech_detected else 0.65
                        
                        speech_timestamps = vad_get_speech_timestamps(
                            combined_audio, 
                            vad_model,
                            threshold=threshold,
                            sampling_rate=16000,
                            min_speech_duration_ms=100,  # Keep this low to catch short speech segments
                            min_silence_duration_ms=150, # Reduced from 400ms to 150ms for faster speech end detection
                            speech_pad_ms=50,  # Reduced from 70ms to 50ms
                            return_seconds=True
                        )
                        
                        # Determine if speech is present in the audio
                        raw_speech_detected = len(speech_timestamps) > 0
                        
                        # Implement debouncing to prevent rapid switching
                        if raw_speech_detected:
                            consecutive_speech_frames += 1
                            consecutive_silence_frames = 0
                        else:
                            consecutive_silence_frames += 1
                            consecutive_speech_frames = 0
                        
                        # Apply debouncing logic: require fewer consecutive frames to start (2 instead of 3)
                        if not speech_detected and consecutive_speech_frames >= 2:
                            speech_detected = True
                            await websocket.send_json({
                                "status": "speech_state",
                                "speech_detected": True
                            })
                        elif speech_detected and consecutive_silence_frames >= 1: # Reduced from 2 to 1 for faster end detection
                            speech_detected = False
                            await websocket.send_json({
                                "status": "speech_state",
                                "speech_detected": False
                            })
                    
                    # Keep more frames in buffer for context
                    if len(audio_buffer) > 15:  # Increased from 10 to 15
                        audio_buffer = audio_buffer[-5:]  # Keep more chunks (3 → 5) for better context
            
            except Exception as e:
                logger.error(f"Error processing audio chunk: {str(e)}")
                continue
    
    except Exception as e:
        logger.error(f"WebSocket error: {str(e)}")
    finally:
        logger.info("VAD WebSocket connection closed")

@app.post("/process-vad-audio/")
async def process_vad_audio(file: UploadFile = File(...), play_audio: bool = Form(False), use_llm: bool = Form(True)):
    """Process audio captured using VAD"""
    # This is similar to the transcribe_audio endpoint but specifically for VAD-captured audio
    with tempfile.NamedTemporaryFile(delete=False, suffix=os.path.splitext(file.filename)[1]) as temp_file:
        # Write the uploaded file content to the temporary file
        content = await file.read()
        temp_file.write(content)
        temp_file.flush()
        
        try:
            # Transcribe the audio using MLX Whisper with the specified model
            logger.info(f"Transcribing VAD-captured audio: {temp_file.name}")
            
            result = mlx_whisper.transcribe(
                temp_file.name,
                path_or_hf_repo=WHISPER_MODEL,
            )
            
            # Clean up the temporary file
            os.unlink(temp_file.name)
            
            transcription_text = result["text"]
            logger.info(f"VAD transcription result: '{transcription_text[:50]}...'")
            
            # Store transcription in a temporary location with unique ID for later retrieval
            transcription_id = str(uuid.uuid4())
            
            response_data = {
                "text": transcription_text,
                "transcription_id": transcription_id,
                "status": "success",
                "models": {
                    "whisper": WHISPER_MODEL,
                    "llm": LLM_MODEL if LLM_AVAILABLE else None,
                    "tts": "mlx-community/Kokoro-82M-4bit" if TTS_AVAILABLE else None
                }
            }
            
            # If LLM is requested and available, trigger the response asynchronously
            if use_llm and LLM_AVAILABLE:
                # Create a task to process LLM response and TTS in the background
                asyncio.create_task(process_llm_and_tts(transcription_id, transcription_text, play_audio))
            
            return response_data
        except Exception as e:
            # Clean up the temporary file in case of error
            os.unlink(temp_file.name)
            logger.error(f"VAD transcription error: {str(e)}")
            import traceback
            logger.error(f"VAD transcription traceback: {traceback.format_exc()}")
            return {
                "error": str(e),
                "status": "error"
            }