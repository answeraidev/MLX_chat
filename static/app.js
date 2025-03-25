document.addEventListener('DOMContentLoaded', function() {
    const statusIndicator = document.getElementById('status-indicator');
    const recordingStatus = document.getElementById('recording-status');
    const resultDiv = document.getElementById('result');
    const playAudioCheckbox = document.getElementById('play-audio');
    const useOpenAICheckbox = document.getElementById('use-openai');
    const openAIResponseContainer = document.getElementById('openai-response-container');
    const openAIResponseDiv = document.getElementById('openai-response');
    const audioControls = document.getElementById('audio-controls');
    const playButton = document.getElementById('play-button');
    const stopButton = document.getElementById('stop-button');
    const modelInfoSpan = document.querySelector('.model-info span');
    
    let mediaRecorder;
    let audioChunks = [];
    let isRecording = false;
    let stream;
    let currentTtsFilename = null;
    
    // Set up the audio recording
    async function setupAudioRecording() {
        try {
            stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            
            // Initialize the media recorder with audio stream
            mediaRecorder = new MediaRecorder(stream);
            
            // Handle data available event (when audio data becomes available)
            mediaRecorder.addEventListener('dataavailable', event => {
                audioChunks.push(event.data);
            });
            
            // Handle recording stop event
            mediaRecorder.addEventListener('stop', () => {
                // Create a blob from the audio chunks
                const audioBlob = new Blob(audioChunks, { type: 'audio/wav' });
                
                // Clear audio chunks for next recording
                audioChunks = [];
                
                // Send audio to server for transcription
                sendAudioForTranscription(audioBlob);
            });
            
            console.log('Audio recording setup complete');
        } catch (error) {
            console.error('Error accessing microphone:', error);
            alert('Error accessing microphone. Please make sure you have a microphone connected and you have granted permission to use it.');
        }
    }
    
    // Start recording when the spacebar is pressed
    document.addEventListener('keydown', event => {
        // Only respond to spacebar press and only if not already recording
        if (event.code === 'Space' && !isRecording) {
            event.preventDefault(); // Prevent scrolling when spacebar is pressed
            startRecording();
        }
    });
    
    // Stop recording when the spacebar is released
    document.addEventListener('keyup', event => {
        if (event.code === 'Space' && isRecording) {
            stopRecording();
        }
    });
    
    // Start recording function
    function startRecording() {
        if (!mediaRecorder) {
            setupAudioRecording().then(() => {
                startRecording();
            });
            return;
        }
        
        if (mediaRecorder.state === 'inactive') {
            audioChunks = [];
            mediaRecorder.start();
            isRecording = true;
            
            // Update UI
            statusIndicator.classList.add('recording');
            recordingStatus.classList.remove('hidden');
            console.log('Recording started');
        }
    }
    
    // Stop recording function
    function stopRecording() {
        if (mediaRecorder && mediaRecorder.state === 'recording') {
            mediaRecorder.stop();
            isRecording = false;
            
            // Update UI
            statusIndicator.classList.remove('recording');
            recordingStatus.classList.add('hidden');
            resultDiv.textContent = 'Processing...';
            openAIResponseDiv.textContent = '';
            openAIResponseContainer.classList.add('hidden');
            audioControls.classList.add('hidden'); // Hide audio controls until we have new TTS
            console.log('Recording stopped');
        }
    }
    
    // Send audio to the server for transcription
    async function sendAudioForTranscription(audioBlob) {
        // Create a FormData object to send the audio file
        const formData = new FormData();
        formData.append('file', audioBlob, 'recording.wav');
        formData.append('play_audio', playAudioCheckbox.checked);
        formData.append('use_openai', useOpenAICheckbox.checked);
        
        try {
            resultDiv.textContent = 'Transcribing...';
            openAIResponseDiv.textContent = useOpenAICheckbox.checked ? 'Waiting for OpenAI response...' : '';
            openAIResponseContainer.classList[useOpenAICheckbox.checked ? 'remove' : 'add']('hidden');
            
            // Send the audio to our API endpoint
            const response = await fetch('/transcribe/', {
                method: 'POST',
                body: formData
            });
            
            const data = await response.json();
            
            if (data.status === 'success') {
                // Update model info if available
                if (data.models) {
                    const whisperModel = data.models.whisper ? data.models.whisper.split('/').pop() : 'Unknown';
                    const openaiModel = data.models.openai ? data.models.openai : 'Disabled';
                    const ttsModel = data.models.tts ? data.models.tts.split('/').pop() : 'Disabled';
                    
                    modelInfoSpan.textContent = `Using: ${whisperModel} + ${openaiModel}`;
                }
                
                // Display the transcription result
                resultDiv.textContent = data.text || 'No transcription returned';
                
                // Display OpenAI response if available
                if (data.openai_response) {
                    openAIResponseDiv.textContent = data.openai_response;
                    openAIResponseContainer.classList.remove('hidden');
                    console.log("OpenAI response displayed:", data.openai_response);
                } else {
                    if (useOpenAICheckbox.checked) {
                        openAIResponseDiv.textContent = 'No response received from OpenAI.';
                        openAIResponseContainer.classList.remove('hidden');
                        console.warn("No OpenAI response received despite being enabled");
                    } else {
                        openAIResponseContainer.classList.add('hidden');
                    }
                }
                
                // Handle TTS audio if available
                if (data.tts_filename) {
                    currentTtsFilename = data.tts_filename;
                    audioControls.classList.remove('hidden');
                    console.log("TTS filename received:", data.tts_filename);
                    // Server handles auto-play, but we'll show controls for manual replay
                } else {
                    audioControls.classList.add('hidden');
                    console.warn("No TTS filename received");
                }
            } else {
                // Display error message
                resultDiv.textContent = `Error: ${data.error || 'Unknown error'}`;
                openAIResponseContainer.classList.add('hidden');
                audioControls.classList.add('hidden');
                console.error('Transcription error:', data.error);
            }
        } catch (error) {
            resultDiv.textContent = 'Error connecting to the server';
            openAIResponseContainer.classList.add('hidden');
            audioControls.classList.add('hidden');
            console.error('Error sending audio for transcription:', error);
        }
    }
    
    // Play TTS audio
    async function playTtsAudio() {
        if (!currentTtsFilename) return;
        
        try {
            const formData = new FormData();
            formData.append('filename', currentTtsFilename);
            
            const response = await fetch('/play', {
                method: 'POST',
                body: formData
            });
            
            const data = await response.json();
            
            if (data.status !== 'playing') {
                console.error('Error playing audio:', data.error);
            }
        } catch (error) {
            console.error('Error playing TTS audio:', error);
        }
    }
    
    // Stop TTS audio
    async function stopTtsAudio() {
        try {
            const response = await fetch('/stop', {
                method: 'POST'
            });
            
            const data = await response.json();
            
            if (data.status !== 'stopped') {
                console.error('Error stopping audio:', data.error);
            }
        } catch (error) {
            console.error('Error stopping TTS audio:', error);
        }
    }
    
    // Add event listeners for play and stop buttons
    playButton.addEventListener('click', playTtsAudio);
    stopButton.addEventListener('click', stopTtsAudio);
    
    // Initialize audio recording setup when the page loads
    setupAudioRecording();
}); 