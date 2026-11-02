/**
 * Thin Web Speech dictation into the composer draft.
 *
 * Absent or unsupported → callers hide the mic. No server STT.
 */

export type DictationSession = {
  stop: () => void;
};

type SpeechRecognitionLike = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: SpeechRecognitionResultEventLike) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
};

type SpeechRecognitionResultEventLike = {
  resultIndex: number;
  results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }>;
};

type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

function recognitionCtor(): SpeechRecognitionCtor | undefined {
  const w = globalThis as typeof globalThis & {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition;
}

export function dictationSupported(): boolean {
  return recognitionCtor() !== undefined;
}

/**
 * Start listening. Final transcripts are appended via `onFinal`; interim via `onInterim`.
 * Returns undefined when the browser has no speech API.
 */
export function startDictation(input: {
  lang?: string;
  onFinal: (text: string) => void;
  onInterim?: (text: string) => void;
  onEnd?: () => void;
}): DictationSession | undefined {
  const Ctor = recognitionCtor();
  if (Ctor === undefined) return undefined;
  const recognition = new Ctor();
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.lang = input.lang ?? "en-US";
  recognition.onresult = (event) => {
    let interim = "";
    for (let i = event.resultIndex; i < event.results.length; i += 1) {
      const result = event.results[i];
      if (result === undefined) continue;
      const piece = result[0]?.transcript ?? "";
      if (result.isFinal) input.onFinal(piece);
      else interim += piece;
    }
    if (interim !== "" && input.onInterim) input.onInterim(interim);
  };
  recognition.onerror = () => {
    input.onEnd?.();
  };
  recognition.onend = () => {
    input.onEnd?.();
  };
  try {
    recognition.start();
  } catch {
    return undefined;
  }
  return {
    stop: () => {
      try {
        recognition.stop();
      } catch {
        /* already stopped */
      }
    },
  };
}
