// audio-processor.js
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
