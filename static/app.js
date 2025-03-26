document.addEventListener('DOMContentLoaded', function() {
    const statusIndicator = document.getElementById('status-indicator');
    const recordingStatus = document.getElementById('recording-status');
    const resultDiv = document.getElementById('result');
    const playAudioCheckbox = document.getElementById('play-audio');
    const useLLMCheckbox = document.getElementById('use-openai');
    const llmResponseContainer = document.getElementById('openai-response-container');
    const llmResponseDiv = document.getElementById('openai-response');
    const loadingAnimation = document.getElementById('loading-animation');
    const audioControls = document.getElementById('audio-controls');
    const playButton = document.getElementById('play-button');
    const stopButton = document.getElementById('stop-button');
    const modelInfoSpan = document.querySelector('.model-info span');
    
    // Force hide loading animation on page load
    loadingAnimation.style.display = 'none';
    loadingAnimation.classList.add('hidden');
    
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
                
                // Show loading animation when processing starts
                loadingAnimation.classList.remove('hidden');
                
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
            resultDiv.textContent = '';
            llmResponseDiv.textContent = '';
            llmResponseContainer.classList.add('hidden');
            audioControls.classList.add('hidden');
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
            // Show loading animation as soon as recording stops
            loadingAnimation.style.display = 'flex';
            loadingAnimation.classList.remove('hidden');
            console.log('Recording stopped');
        }
    }
    
    // Send audio to the server for transcription
    async function sendAudioForTranscription(audioBlob) {
        const formData = new FormData();
        formData.append('file', audioBlob, 'recording.wav');
        formData.append('play_audio', playAudioCheckbox.checked);  // Request TTS generation if auto-play is enabled
        formData.append('use_llm', useLLMCheckbox.checked);
        
        try {
            resultDiv.textContent = 'Transcribing...';
            
            const response = await fetch('/transcribe/', {
                method: 'POST',
                body: formData
            });
            
            const data = await response.json();
            
            if (data.status === 'success') {
                // Update model info if available
                if (data.models) {
                    const whisperModel = data.models.whisper ? data.models.whisper.split('/').pop() : 'Unknown';
                    const llmModel = data.models.llm ? data.models.llm.split('/').pop() : 'Disabled';
                    const ttsModel = data.models.tts ? data.models.tts.split('/').pop() : 'Disabled';
                    
                    modelInfoSpan.textContent = `Using: ${whisperModel} + ${llmModel}`;
                }
                
                // Display the transcription result
                resultDiv.textContent = data.text || 'No transcription returned';
                
                // If LLM is enabled, poll for the response
                if (useLLMCheckbox.checked && data.transcription_id) {
                    pollForLLMResponse(data.transcription_id);
                } else {
                    // If no LLM processing needed, hide loading animation
                    loadingAnimation.style.display = 'none';
                    loadingAnimation.classList.add('hidden');
                }
            } else {
                // Display error message
                resultDiv.textContent = `Error: ${data.error || 'Unknown error'}`;
                loadingAnimation.style.display = 'none';
                loadingAnimation.classList.add('hidden');
                console.error('Transcription error:', data.error);
            }
        } catch (error) {
            resultDiv.textContent = 'Error connecting to the server';
            loadingAnimation.style.display = 'none';
            loadingAnimation.classList.add('hidden');
            console.error('Error sending audio for transcription:', error);
        }
    }
    
    // Poll for LLM response and TTS result
    async function pollForLLMResponse(transcriptionId, attempt = 0) {
        try {
            // Increase timeout to 60 seconds (60 attempts at 1 second intervals)
            if (attempt > 60) {
                llmResponseDiv.textContent = 'LLM response timed out. Please try again.';
                llmResponseContainer.classList.remove('hidden');
                loadingAnimation.style.display = 'none';
                loadingAnimation.classList.add('hidden');
                console.error('Polling for LLM response timed out');
                return;
            }
            
            const response = await fetch(`/get_response/${transcriptionId}`);
            const data = await response.json();
            
            // Handle processing state
            if (data.status === 'processing') {
                // Continue polling while processing
                setTimeout(() => pollForLLMResponse(transcriptionId, attempt + 1), 1000);
                return;
            }
            
            // Always show the response container
            llmResponseContainer.classList.remove('hidden');
            
            // Handle error state
            if (data.status === 'error') {
                llmResponseDiv.textContent = data.error || 'Unknown error';
                loadingAnimation.style.display = 'none';
                loadingAnimation.classList.add('hidden');
                console.error('LLM response error:', data.error);
                return;
            }
            
            // Handle success state
            if (data.status === 'success' && data.llm_response) {
                llmResponseDiv.textContent = data.llm_response;
                
                // Handle TTS if available
                if (data.tts_filename) {
                    currentTtsFilename = data.tts_filename;
                    audioControls.classList.remove('hidden');
                    
                    // If auto-play is enabled, play the audio immediately
                    if (playAudioCheckbox.checked) {
                        playTtsAudio(); // This will hide the loading animation when audio starts
                    } else {
                        // Only hide loading if not auto-playing
                        loadingAnimation.style.display = 'none';
                        loadingAnimation.classList.add('hidden');
                    }
                } else {
                    loadingAnimation.style.display = 'none';
                    loadingAnimation.classList.add('hidden');
                }
            } else {
                // This should rarely happen as we handle all states above
                llmResponseDiv.textContent = 'No response from LLM';
                loadingAnimation.style.display = 'none';
                loadingAnimation.classList.add('hidden');
            }
        } catch (error) {
            console.error('Error polling for LLM response:', error);
            llmResponseDiv.textContent = 'Error retrieving LLM response';
            llmResponseContainer.classList.remove('hidden');
            loadingAnimation.style.display = 'none';
            loadingAnimation.classList.add('hidden');
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
            
            if (data.status === 'playing') {
                // Immediately hide loading animation when audio starts playing
                loadingAnimation.style.display = 'none';
                loadingAnimation.classList.add('hidden');
            } else {
                console.error('Error playing audio:', data.error);
                // Also hide loading animation if there's an error
                loadingAnimation.style.display = 'none';
                loadingAnimation.classList.add('hidden');
            }
        } catch (error) {
            console.error('Error playing TTS audio:', error);
            // Hide loading animation on error
            loadingAnimation.style.display = 'none';
            loadingAnimation.classList.add('hidden');
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