document.addEventListener('DOMContentLoaded', function() {
    const statusIndicator = document.getElementById('status-indicator');
    const recordingStatus = document.getElementById('recording-status');
    const resultDiv = document.getElementById('result');
    const playAudioCheckbox = document.getElementById('play-audio');
    const useLLMCheckbox = document.getElementById('use-openai');
    const useVADCheckbox = document.getElementById('use-vad');
    const llmResponseContainer = document.getElementById('openai-response-container');
    const llmResponseDiv = document.getElementById('openai-response');
    const loadingAnimation = document.getElementById('loading-animation');
    const audioControls = document.getElementById('audio-controls');
    const playButton = document.getElementById('play-button');
    const stopButton = document.getElementById('stop-button');
    const modelInfoSpan = document.querySelector('.model-info span');
    
    // Configuration elements
    const configButton = document.getElementById('configButton');
    const configModal = document.getElementById('configModal');
    const closeModal = document.getElementById('closeModal');
    const configForm = document.getElementById('configForm');
    const systemPromptTextarea = document.getElementById('systemPrompt');
    
    // Track modal state
    let isModalOpen = false;
    
    // Force hide loading animation on page load
    loadingAnimation.style.display = 'none';
    loadingAnimation.classList.add('hidden');
    
    let mediaRecorder;
    let audioChunks = [];
    let isRecording = false;
    let stream;
    let currentTtsFilename = null;
    
    // VAD-specific variables
    let vadSocket = null;
    let vadActive = false;
    let vadAudioContext = null;
    let vadProcessor = null;
    let vadRecordingStartTime = null;
    let vadAudioChunks = [];
    
    // Load initial configuration
    loadConfiguration();
    
    // Configuration functions
    async function loadConfiguration() {
        try {
            const response = await fetch('/config/');
            const config = await response.json();
            systemPromptTextarea.value = config.system_prompt;
        } catch (error) {
            console.error('Error loading configuration:', error);
        }
    }
    
    async function saveConfiguration(event) {
        event.preventDefault();
        
        const formData = new FormData();
        formData.append('system_prompt', systemPromptTextarea.value);
        
        try {
            const response = await fetch('/config/', {
                method: 'POST',
                body: formData
            });
            
            const result = await response.json();
            
            if (result.status === 'success') {
                closeConfigModal();
            } else {
                console.error('Error saving configuration:', result.error);
            }
        } catch (error) {
            console.error('Error saving configuration:', error);
        }
    }
    
    // Configuration modal functions
    function openConfigModal() {
        configModal.style.display = 'block';
        isModalOpen = true;
    }
    
    function closeConfigModal() {
        configModal.style.display = 'none';
        isModalOpen = false;
    }
    
    // Configuration event listeners
    configButton.addEventListener('click', openConfigModal);
    closeModal.addEventListener('click', closeConfigModal);
    
    window.addEventListener('click', (event) => {
        if (event.target === configModal) {
            closeConfigModal();
        }
    });
    
    // Prevent spacebar from triggering recording when typing in textarea
    systemPromptTextarea.addEventListener('keydown', (event) => {
        if (event.code === 'Space') {
            event.stopPropagation();
        }
    });
    
    configForm.addEventListener('submit', saveConfiguration);
    
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
        // and if VAD is not active
        if (event.code === 'Space' && !isRecording && !vadActive) {
            event.preventDefault(); // Prevent scrolling when spacebar is pressed
            startRecording();
        }
    });
    
    // Stop recording when the spacebar is released
    document.addEventListener('keyup', event => {
        if (event.code === 'Space' && isRecording && !vadActive) {
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
                
                // Always poll for LLM response if transcription_id is available
                if (data.transcription_id) {
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
    
    // SILERO VAD WebSocket Implementation
    
    // Setup VAD WebSocket connection
    function setupVADWebSocket() {
        // Close existing connection if any
        if (vadSocket) {
            vadSocket.close();
        }
        
        // Create new WebSocket connection
        const wsProtocol = window.location.protocol === 'https:' ? 'wss://' : 'ws://';
        vadSocket = new WebSocket(`${wsProtocol}${window.location.host}/vad-stream/`);
        
        // Setup event handlers
        vadSocket.onopen = () => {
            console.log('VAD WebSocket connection established');
        };
        
        vadSocket.onmessage = (event) => {
            const data = JSON.parse(event.data);
            
            if (data.status === 'speech_state') {
                // Handle speech detection state changes
                if (data.speech_detected && !isRecording && vadActive) {
                    // Start recording immediately when speech is detected
                    console.log('VAD: Speech detected, starting recording');
                    startVADRecording();
                } else if (!data.speech_detected && isRecording && vadActive) {
                    // Stop recording when speech ends (with minimal delay)
                    console.log('VAD: Speech ended, stopping recording');
                    // Reduce delay from 450ms to 150ms for faster transcription
                    setTimeout(() => {
                        stopVADRecording();
                    }, 150);
                }
            }
        };
        
        vadSocket.onerror = (error) => {
            console.error('VAD WebSocket error:', error);
        };
        
        vadSocket.onclose = () => {
            console.log('VAD WebSocket connection closed');
        };
    }
    
    // Setup VAD audio processing
    async function setupVADAudio() {
        try {
            // Get audio stream if not already available
            if (!stream) {
                stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            }
            
            // Set up audio context for VAD processing
            vadAudioContext = new (window.AudioContext || window.webkitAudioContext)({
                sampleRate: 16000  // Silero VAD expects 16kHz audio
            });
            
            const source = vadAudioContext.createMediaStreamSource(stream);
            
            // Reduce buffer size for more frequent processing
            vadProcessor = vadAudioContext.createScriptProcessor(2048, 1, 1);
            
            // Store last process time to limit processing frequency
            let lastProcessTime = 0;
            
            // Lower volume threshold to capture softer speech onset
            const VOLUME_THRESHOLD = 0.01; // Reduced from 0.015 to be more sensitive
            
            // Pre-buffer audio chunks to capture speech before detection
            // This buffer is always maintained, even when not recording
            window.preBuffer = [];
            const maxPreBufferLength = 15; // About 1.5 seconds of audio at our chunk size
            
            vadProcessor.onaudioprocess = (audioProcessingEvent) => {
                if (!vadActive || !vadSocket || vadSocket.readyState !== WebSocket.OPEN) {
                    return;
                }
                
                const now = Date.now();
                // Process every 40ms rather than 50ms for faster response
                const shouldProcess = now - lastProcessTime > 40;
                
                // Get audio data from input buffer
                const inputBuffer = audioProcessingEvent.inputBuffer;
                const inputData = inputBuffer.getChannelData(0);
                
                // Apply lighter noise reduction to avoid losing speech onset
                const processedData = simpleNoiseReduction(inputData, 0.008); // Lower threshold
                
                // Always keep a rolling buffer of recent audio
                window.preBuffer.push(new Float32Array(processedData));
                if (window.preBuffer.length > maxPreBufferLength) {
                    window.preBuffer.shift(); // Remove oldest chunk
                }
                
                // Calculate RMS (Root Mean Square) as volume measurement
                const rms = calculateRMS(processedData);
                
                // If we're recording with VAD, store the audio chunk
                if (isRecording && vadActive) {
                    vadAudioChunks.push(new Float32Array(processedData));
                }
                
                // Only send to server at controlled intervals and if volume is meaningful
                if (shouldProcess) {
                    lastProcessTime = now;
                    
                    // Only send if the volume is above threshold to reduce false positives
                    // But don't apply this when we're already recording to avoid cutting out softer speech
                    // Use a lower threshold for initial detection
                    if (isRecording || rms > VOLUME_THRESHOLD) {
                        // Send audio data to server for VAD processing
                        const arrayBuffer = processedData.buffer;
                        const base64Data = arrayBufferToBase64(arrayBuffer);
                        
                        // Send to server if connection is open
                        if (vadSocket.readyState === WebSocket.OPEN) {
                            vadSocket.send(base64Data);
                        }
                    }
                }
            };
            
            // Connect the processor
            source.connect(vadProcessor);
            vadProcessor.connect(vadAudioContext.destination);
            
            console.log('VAD audio processing setup complete');
        } catch (error) {
            console.error('Error setting up VAD audio:', error);
            alert('Error setting up VAD. Please make sure you have a microphone connected and you have granted permission to use it.');
        }
    }
    
    // Calculate RMS (Root Mean Square) of audio data
    function calculateRMS(samples) {
        let sum = 0;
        for (let i = 0; i < samples.length; i++) {
            sum += samples[i] * samples[i];
        }
        return Math.sqrt(sum / samples.length);
    }
    
    // Modified noise reduction function with variable threshold
    function simpleNoiseReduction(samples, customThreshold) {
        // Create a new array to avoid modifying the original
        const result = new Float32Array(samples.length);
        
        // Use the provided threshold or default to 0.01
        const noiseThreshold = customThreshold || 0.01;
        
        for (let i = 0; i < samples.length; i++) {
            // Apply a soft threshold to reduce low-level noise
            if (Math.abs(samples[i]) < noiseThreshold) {
                // Use a gentler reduction to preserve more of the signal
                result[i] = samples[i] * 0.5; // Was 0.3, now 0.5 to preserve more signal
            } else {
                result[i] = samples[i];
            }
        }
        
        return result;
    }
    
    // Convert ArrayBuffer to Base64 string
    function arrayBufferToBase64(buffer) {
        const bytes = new Uint8Array(buffer);
        const binary = bytes.reduce((acc, byte) => acc + String.fromCharCode(byte), '');
        return window.btoa(binary);
    }
    
    // Start recording with VAD
    function startVADRecording() {
        if (isRecording) return;
        
        // Initialize recording with the pre-buffer contents to capture speech onset
        // This is critical - it adds the audio that was processed before speech was detected
        vadAudioChunks = Array.from(window.preBuffer || []);
        
        vadRecordingStartTime = Date.now() - (window.preBuffer.length * 128); // Adjust start time to account for prebuffer
        isRecording = true;
        
        // Update UI
        statusIndicator.classList.add('recording');
        recordingStatus.classList.remove('hidden');
        resultDiv.textContent = '';
        llmResponseDiv.textContent = '';
        llmResponseContainer.classList.add('hidden');
        audioControls.classList.add('hidden');
        console.log('VAD recording started with pre-buffer:', vadAudioChunks.length, 'chunks');
    }
    
    // Stop recording with VAD
    function stopVADRecording() {
        if (!isRecording) return;
        
        isRecording = false;
        
        // Update UI
        statusIndicator.classList.remove('recording');
        recordingStatus.classList.add('hidden');
        resultDiv.textContent = 'Processing...';
        loadingAnimation.style.display = 'flex';
        loadingAnimation.classList.remove('hidden');
        console.log('VAD recording stopped');
        
        // Convert audio chunks to WAV blob
        const recordingDuration = (Date.now() - vadRecordingStartTime) / 1000;
        if (vadAudioChunks.length > 0 && recordingDuration > 0.3) {  // Reduced minimum from 0.5 to 0.3 seconds
            // Concatenate all audio chunks
            let allAudio = new Float32Array(vadAudioChunks.reduce((acc, chunk) => acc + chunk.length, 0));
            let offset = 0;
            
            vadAudioChunks.forEach(chunk => {
                allAudio.set(chunk, offset);
                offset += chunk.length;
            });
            
            // Convert to WAV
            const wavBlob = float32ArrayToWavBlob(allAudio, 16000);
            
            // Send to server for processing
            sendVADAudioForProcessing(wavBlob);
        } else {
            console.log('Recording too short, ignoring');
            loadingAnimation.style.display = 'none';
            loadingAnimation.classList.add('hidden');
        }
    }
    
    // Convert Float32Array to WAV blob
    function float32ArrayToWavBlob(samples, sampleRate) {
        const numChannels = 1;
        const bitsPerSample = 16;
        const bytesPerSample = bitsPerSample / 8;
        const blockAlign = numChannels * bytesPerSample;
        const buffer = new ArrayBuffer(44 + samples.length * bytesPerSample);
        const view = new DataView(buffer);

        // Write WAV header
        // "RIFF" chunk descriptor
        writeString(view, 0, 'RIFF');
        view.setUint32(4, 36 + samples.length * bytesPerSample, true);
        writeString(view, 8, 'WAVE');
        
        // "fmt " sub-chunk
        writeString(view, 12, 'fmt ');
        view.setUint32(16, 16, true);  // Sub-chunk size
        view.setUint16(20, 1, true);   // Audio format (1 = PCM)
        view.setUint16(22, numChannels, true);
        view.setUint32(24, sampleRate, true);
        view.setUint32(28, sampleRate * blockAlign, true); // Byte rate
        view.setUint16(32, blockAlign, true);
        view.setUint16(34, bitsPerSample, true);
        
        // "data" sub-chunk
        writeString(view, 36, 'data');
        view.setUint32(40, samples.length * bytesPerSample, true);
        
        // Write audio data
        floatTo16BitPCM(view, 44, samples);
        
        return new Blob([buffer], { type: 'audio/wav' });
    }
    
    // Helper functions for WAV generation
    function writeString(view, offset, string) {
        for (let i = 0; i < string.length; i++) {
            view.setUint8(offset + i, string.charCodeAt(i));
        }
    }
    
    function floatTo16BitPCM(output, offset, input) {
        for (let i = 0; i < input.length; i++, offset += 2) {
            const s = Math.max(-1, Math.min(1, input[i]));
            output.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
        }
    }
    
    // Send VAD-captured audio to server for processing
    async function sendVADAudioForProcessing(wavBlob) {
        const formData = new FormData();
        formData.append('file', wavBlob, 'vad_recording.wav');
        
        try {
            resultDiv.textContent = 'Transcribing...';
            
            const response = await fetch('/process-vad-audio/', {
                method: 'POST',
                body: formData
            });
            
            const data = await response.json();
            
            if (data.status === 'success') {
                // Display the transcription result
                resultDiv.textContent = data.text || 'No transcription returned';
                
                // Always poll for LLM response if transcription_id is available
                if (data.transcription_id) {
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
                console.error('VAD transcription error:', data.error);
            }
        } catch (error) {
            resultDiv.textContent = 'Error connecting to the server';
            loadingAnimation.style.display = 'none';
            loadingAnimation.classList.add('hidden');
            console.error('Error sending VAD audio for processing:', error);
        }
    }
    
    // Toggle VAD mode
    useVADCheckbox.addEventListener('change', () => {
        vadActive = useVADCheckbox.checked;
        
        if (vadActive) {
            // Setup VAD when enabled
            setupVADWebSocket();
            setupVADAudio();
        } else {
            // Cleanup when disabled
            if (vadSocket) {
                vadSocket.close();
                vadSocket = null;
            }
            
            if (vadProcessor) {
                vadProcessor.disconnect();
                vadProcessor = null;
            }
            
            if (vadAudioContext) {
                vadAudioContext.close();
                vadAudioContext = null;
            }
        }
    });
    
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
            
            // Hide loading animation when audio starts playing
            loadingAnimation.style.display = 'none';
            loadingAnimation.classList.add('hidden');
            
            if (data.status !== 'success') {
                console.error('Error playing audio:', data.error);
            }
        } catch (error) {
            console.error('Error playing audio:', error);
        }
    }
    
    // Stop TTS audio
    async function stopTtsAudio() {
        try {
            const response = await fetch('/stop', {
                method: 'POST'
            });
            
            const data = await response.json();
            
            if (data.status !== 'success') {
                console.error('Error stopping audio:', data.error);
            }
        } catch (error) {
            console.error('Error stopping audio:', error);
        }
    }
    
    // Event listeners for audio control buttons
    playButton.addEventListener('click', playTtsAudio);
    stopButton.addEventListener('click', stopTtsAudio);
    
    // Initialize audio recording setup on page load
    setupAudioRecording();
}); 

// Make preBuffer available globally
window.preBuffer = []; 