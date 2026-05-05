export function getVoices(): Promise<SpeechSynthesisVoice[]> {
  return new Promise((resolve) => {
    const synth = window.speechSynthesis;
    const initial = synth.getVoices();
    if (initial.length) return resolve(initial);

    let settled = false;
    const finish = (voices: SpeechSynthesisVoice[]) => {
      if (settled) return;
      settled = true;
      clearInterval(poll);
      clearTimeout(timeout);
      synth.removeEventListener("voiceschanged", handler);
      resolve(voices);
    };

    const handler = () => {
      const voices = synth.getVoices();
      if (voices.length) finish(voices);
    };
    synth.addEventListener("voiceschanged", handler);

    const poll = window.setInterval(() => {
      const voices = synth.getVoices();
      if (voices.length) finish(voices);
    }, 250);

    const timeout = window.setTimeout(() => {
      finish(synth.getVoices());
    }, 2500);
  });
}
