/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * AudioWorkletProcessor para capturar y procesar audio del micrófono
 * Reemplaza el ScriptProcessorNode deprecado y MediaRecorder
 * Proporciona procesamiento de audio en tiempo real para Gemini Live API
 */
class AudioCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    
    // Configurar el puerto de mensajes para comunicación con el hilo principal
    this.port.onmessage = (event) => {
      // Manejar mensajes del hilo principal si es necesario
      if (event.data.type === 'configure') {
        // Configuración adicional si se requiere
        console.log('[AudioWorklet] Processor configured');
      }
    };
    
    console.log('[AudioWorklet] AudioCaptureProcessor initialized');
  }

  /**
   * Procesa los datos de audio en tiempo real
   * @param {Float32Array[][]} inputs - Arrays de datos de audio de entrada
   * @param {Float32Array[][]} outputs - Arrays de datos de audio de salida
   * @param {Object} parameters - Parámetros de audio
   * @returns {boolean} - true para mantener el procesador activo
   */
  process(inputs, outputs, parameters) {
    // Obtener el primer canal de entrada
    const input = inputs[0];
    
    if (input && input.length > 0) {
      const inputData = input[0]; // Primer canal (mono)
      
      if (inputData && inputData.length > 0) {
        // Enviar los datos de audio al hilo principal
        // Los datos están en formato Float32Array, perfectos para conversión PCM
        this.port.postMessage({
          type: 'audioData',
          audioData: inputData
        });
      }
    }
    
    // Retornar true para mantener el procesador activo
    return true;
  }
}

// Registrar el procesador con el nombre que usaremos en el hilo principal
registerProcessor('audio-capture-processor', AudioCaptureProcessor);
