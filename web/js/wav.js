// PCM-WAV, mono, 16 bit. Liefert Puffer und eine Int16-Ansicht auf die Samples.
export function createWav(samples, rate) {
  const buffer = wavHeader(samples, rate, new ArrayBuffer(44 + samples * 2));
  return { buffer, pcm: new Int16Array(buffer, 44, samples) };
}

// Nur der 44-Byte-Kopf (die Samples folgen stückweise, siehe mix.js).
export function wavHeader(samples, rate, buffer = new ArrayBuffer(44)) {
  const v = new DataView(buffer);
  const ascii = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  ascii(0, "RIFF");
  v.setUint32(4, 36 + samples * 2, true);
  ascii(8, "WAVE");
  ascii(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);          // PCM
  v.setUint16(22, 1, true);          // mono
  v.setUint32(24, rate, true);
  v.setUint32(28, rate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  ascii(36, "data");
  v.setUint32(40, samples * 2, true);
  return buffer;
}
