let socket = new WebSocket("ws://localhost:8001");
let displayDiv = document.getElementById('textDisplay');
let errorDiv = document.getElementById('errorMessage');
let micStatusSpan = document.getElementById('micStatus');
let serverStatusSpan = document.getElementById('serverStatus');
let server_available = false;
let mic_available = false;
let fullSentences = [];

const serverCheckInterval = 5000; // Check every 5 seconds

// Update status indicators
function updateStatus() {
    micStatusSpan.textContent = mic_available ? '✅ Connected' : '❌ Not available';
    micStatusSpan.style.color = mic_available ? '#4caf50' : '#ff6b6b';
    
    serverStatusSpan.textContent = server_available ? '✅ Connected' : '❌ Not connected';
    serverStatusSpan.style.color = server_available ? '#4caf50' : '#ff6b6b';
}

// Show error message
function showError(message) {
    errorDiv.textContent = message;
    errorDiv.style.display = 'block';
}

// Hide error message
function hideError() {
    errorDiv.style.display = 'none';
}

function connectToServer() {
    try {
        socket = new WebSocket("ws://localhost:8001");

        socket.onopen = function(event) {
            server_available = true;
            updateStatus();
            hideError();
            start_msg();
        };

        socket.onmessage = function(event) {
            let data = JSON.parse(event.data);

            if (data.type === 'realtime') {
                displayRealtimeText(data.text, displayDiv);
            } else if (data.type === 'fullSentence') {
                fullSentences.push(data.text);
                displayRealtimeText("", displayDiv); // Refresh display with new full sentence
            }
        };

        socket.onclose = function(event) {
            server_available = false;
            updateStatus();
            showError("Connection to server closed. Attempting to reconnect...");
        };

        socket.onerror = function(event) {
            server_available = false;
            updateStatus();
            showError("WebSocket error occurred. Please check if the server is running.");
        };
    } catch (e) {
        showError("Error connecting to server: " + e.message);
    }
}

function displayRealtimeText(realtimeText, displayDiv) {
    let displayedText = fullSentences.map((sentence, index) => {
        let span = document.createElement('span');
        span.textContent = sentence + " ";
        span.className = index % 2 === 0 ? 'yellow' : 'cyan';
        return span.outerHTML;
    }).join('') + realtimeText;

    displayDiv.innerHTML = displayedText || "Waiting for speech...";
}

function start_msg() {
    if (!mic_available)
        displayRealtimeText("🎤  please allow microphone access  🎤", displayDiv);
    else if (!server_available)
        displayRealtimeText("🖥️  please start server  🖥️", displayDiv);
    else
        displayRealtimeText("👄  start speaking  👄", displayDiv);
}

// Check server availability periodically
setInterval(() => {
    if (!server_available) {
        connectToServer();
    }
}, serverCheckInterval);

// Initial connection
connectToServer();

// Initial status update
updateStatus();
start_msg();

// Request access to the microphone
navigator.mediaDevices.getUserMedia({ audio: true })
.then(async stream => {
    const audioContext = new AudioContext();
    const source = audioContext.createMediaStreamSource(stream);
    
    // Load and register the audio worklet processor
    try {
        // Create a blob URL for the audio processor code if running locally
        const processorCode = `
        class AudioProcessor extends AudioWorkletProcessor {
          constructor() {
            super();
            this.bufferSize = 256;
            this.buffer = new Float32Array(this.bufferSize);
            this.bufferIndex = 0;
          }
        
          process(inputs, outputs, parameters) {
            // Get the first input channel from the first input
            const input = inputs[0][0];
            
            if (!input) return true;
        
            // Fill our buffer
            for (let i = 0; i < input.length; i++) {
              this.buffer[this.bufferIndex++] = input[i];
              
              // When the buffer is full, send it to the main thread
              if (this.bufferIndex >= this.bufferSize) {
                // Convert to 16-bit PCM
                const outputData = new Int16Array(this.bufferSize);
                for (let j = 0; j < this.bufferSize; j++) {
                  outputData[j] = Math.max(-32768, Math.min(32767, this.buffer[j] * 32768));
                }
                
                // Send the PCM data to the main thread
                this.port.postMessage({
                  audioData: outputData.buffer,
                }, [outputData.buffer]);
                
                // Reset the buffer
                this.buffer = new Float32Array(this.bufferSize);
                this.bufferIndex = 0;
              }
            }
            
            // Return true to keep the processor running
            return true;
          }
        }
        
        registerProcessor('audio-processor', AudioProcessor);
        `;
        
        // Create a blob URL for the processor code
        const blob = new Blob([processorCode], { type: 'application/javascript' });
        const processorUrl = URL.createObjectURL(blob);
        
        // Try loading from the blob URL
        await audioContext.audioWorklet.addModule(processorUrl);
        const workletNode = new AudioWorkletNode(audioContext, 'audio-processor');
        
        // Connect the source to the worklet node
        source.connect(workletNode);
        // We don't need to connect the worklet to the destination since we're not playing audio
        // This prevents audio feedback
        
        mic_available = true;
        updateStatus();
        hideError();
        start_msg();
        
        // Handle audio data from the worklet
        workletNode.port.onmessage = (event) => {
            if (event.data.audioData) {
                // Get the audio data from the message
                const outputData = new Int16Array(event.data.audioData);
                
                // Send the 16-bit PCM data to the server
                if (socket.readyState === WebSocket.OPEN) {
                    // Create a JSON string with metadata
                    const metadata = JSON.stringify({ sampleRate: audioContext.sampleRate });
                    // Convert metadata to a byte array
                    const metadataBytes = new TextEncoder().encode(metadata);
                    // Create a buffer for metadata length (4 bytes for 32-bit integer)
                    const metadataLength = new ArrayBuffer(4);
                    const metadataLengthView = new DataView(metadataLength);
                    // Set the length of the metadata in the first 4 bytes
                    metadataLengthView.setInt32(0, metadataBytes.byteLength, true); // true for little-endian
                    // Combine metadata length, metadata, and audio data into a single message
                    const combinedData = new Blob([metadataLength, metadataBytes, outputData.buffer]);
                    socket.send(combinedData);
                }
            }
        };
    } catch (error) {
        console.error('Error initializing AudioWorklet:', error);
        mic_available = false;
        updateStatus();
        showError('Error initializing audio processing. Your browser may not support AudioWorklet. Please try a different browser.');
    }
})
.catch(e => {
    console.error('Microphone access error:', e);
    mic_available = false;
    updateStatus();
    showError(`Microphone access denied: ${e.message}. Please allow microphone access and reload the page.`);
});