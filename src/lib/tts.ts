export function getVoices(): Promise<SpeechSynthesisVoice[]> {
  return new Promise((resolve) => {
    const synth = window.speechSynthesis;
    const v = synth.getVoices();
    if (v.length) return resolve(v);
    const handler = () => {
      resolve(synth.getVoices());
      synth.removeEventListener("voiceschanged", handler);
    };
    synth.addEventListener("voiceschanged", handler);
  });
}
