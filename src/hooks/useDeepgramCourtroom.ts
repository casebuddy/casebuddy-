import { useState, useRef, useCallback, useEffect } from "react";

export interface DeepgramCourtroomOptions {
  onTranscript: (text: string, isFinal: boolean) => void;
  onAutoSend?: (text: string) => void;
  onError?: (error: string) => void;
  onAudioLevel?: (level: number) => void;
  silenceTimeoutMs?: number;
}

export interface DeepgramCourtroomState {
  isListening: boolean;
  connectionStatus: "disconnected" | "connecting" | "connected" | "error";
  interimTranscript: string;
  audioLevel: number;
  isSpeaking: boolean;
}

// Role-to-voice mapping using ElevenLabs-inspired browser voice selection
const ROLE_VOICE_PROFILES: Record<string, { pitch: number; rate: number; hints: string[] }> = {
  judge:             { pitch: 0.78, rate: 0.88, hints: ["google uk english male", "daniel", "david", "guy", "james"] },
  witness:           { pitch: 1.05, rate: 0.96, hints: ["samantha", "aria", "jenny", "karen", "moira"] },
  "opposing counsel":{ pitch: 0.92, rate: 1.02, hints: ["guy", "alex", "tom", "google us english male"] },
  "court clerk":     { pitch: 1.08, rate: 1.0,  hints: ["victoria", "kate", "jenny", "zira"] },
  "potential juror": { pitch: 1.02, rate: 0.99, hints: ["samantha", "tessa", "fiona"] },
  deponent:          { pitch: 0.97, rate: 0.94, hints: ["daniel", "tom", "reed"] },
  "skeptical judge": { pitch: 0.72, rate: 0.85, hints: ["daniel", "david", "google uk english male"] },
  default:           { pitch: 0.96, rate: 0.95, hints: [] },
};

// Cache voices once loaded
let voiceCache: SpeechSynthesisVoice[] = [];

function loadVoices(): SpeechSynthesisVoice[] {
  if (voiceCache.length > 0) return voiceCache;
  voiceCache = window.speechSynthesis.getVoices();
  return voiceCache;
}

function getBestVoiceForRole(role: string): SpeechSynthesisVoice | null {
  const voices = loadVoices();
  if (!voices.length) return null;

  const profile = ROLE_VOICE_PROFILES[role.toLowerCase()] || ROLE_VOICE_PROFILES.default;
  const en = voices.filter(v => v.lang.toLowerCase().startsWith("en"));
  const pool = en.length ? en : voices;

  // Priority 1: exact hint name match
  for (const hint of profile.hints) {
    const match = pool.find(v => v.name.toLowerCase().includes(hint));
    if (match) return match;
  }

  // Priority 2: neural/premium/natural voice
  const neural = pool.find(v => /neural|natural|premium|enhanced|wavenet/i.test(v.name));
  if (neural) return neural;

  return pool[0] || null;
}

function splitForSpeech(text: string): string[] {
  // Split on sentence boundaries, keeping chunks under ~180 chars for smooth streaming
  const sentences = text.match(/[^.!?]+[.!?]+/g) || [text];
  const chunks: string[] = [];
  let current = "";

  for (const s of sentences) {
    if ((current + s).length > 180 && current) {
      chunks.push(current.trim());
      current = s;
    } else {
      current += s;
    }
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks.filter(Boolean);
}

export function useDeepgramCourtroom({
  onTranscript,
  onAutoSend,
  onError,
  onAudioLevel,
  silenceTimeoutMs = 1800,
}: DeepgramCourtroomOptions) {
  const [state, setState] = useState<DeepgramCourtroomState>({
    isListening: false,
    connectionStatus: "disconnected",
    interimTranscript: "",
    audioLevel: 0,
    isSpeaking: false,
  });

  const socketRef = useRef<WebSocket | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const animFrameRef = useRef<number>(0);
  const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingTranscriptRef = useRef("");
  const lastSentRef = useRef({ text: "", at: 0 });
  const isSpeakingRef = useRef(false);
  const utteranceQueueRef = useRef<SpeechSynthesisUtterance[]>([]);
  const voicesMounted = useRef(false);

  // Pre-load voices on mount
  useEffect(() => {
    if (voicesMounted.current) return;
    voicesMounted.current = true;
    if (window.speechSynthesis.getVoices().length === 0) {
      window.speechSynthesis.addEventListener("voiceschanged", () => {
        voiceCache = window.speechSynthesis.getVoices();
      }, { once: true });
    }
  }, []);

  const stopAudioMonitor = useCallback(() => {
    cancelAnimationFrame(animFrameRef.current);
    analyserRef.current = null;
  }, []);

  const startAudioMonitor = useCallback((stream: MediaStream) => {
    try {
      const ctx = new AudioContext();
      audioCtxRef.current = ctx;
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      analyserRef.current = analyser;

      const data = new Uint8Array(analyser.frequencyBinCount);
      const tick = () => {
        if (!analyserRef.current) return;
        analyserRef.current.getByteFrequencyData(data);
        const avg = data.reduce((a, b) => a + b, 0) / data.length / 255;
        onAudioLevel?.(avg);
        setState(prev => ({ ...prev, audioLevel: avg }));
        animFrameRef.current = requestAnimationFrame(tick);
      };
      animFrameRef.current = requestAnimationFrame(tick);
    } catch (_e) {
      // Non-fatal
    }
  }, [onAudioLevel]);

  const stopListening = useCallback(() => {
    if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
    if (mediaRecorderRef.current?.state !== "inactive") {
      try { mediaRecorderRef.current?.stop(); } catch (_e) {}
    }
    if (socketRef.current) {
      socketRef.current.close();
      socketRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }
    stopAudioMonitor();
    pendingTranscriptRef.current = "";
    setState(prev => ({ ...prev, isListening: false, connectionStatus: "disconnected", interimTranscript: "", audioLevel: 0 }));
  }, [stopAudioMonitor]);

  const startListening = useCallback(async () => {
    if (state.isListening) return;

    try {
      setState(prev => ({ ...prev, connectionStatus: "connecting" }));

      // Request mic with echo cancellation for natural conversation
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          sampleRate: 16000,
        }
      });
      streamRef.current = stream;
      startAudioMonitor(stream);

      // Fetch a short-lived Deepgram token from our secure edge function
      const { supabase } = await import("@/integrations/supabase/client");
      const { data: tokenData, error: tokenError } = await supabase.functions.invoke("deepgram-token");
      
      if (tokenError || !tokenData?.token) {
        onError?.("Could not get voice recognition token. Check your connection.");
        stopListening();
        return;
      }

      // Connect to Deepgram with legal-optimized model + smart formatting
      const params = new URLSearchParams({
        model: "nova-2-legal",
        smart_format: "true",
        interim_results: "true",
        endpointing: "400",
        utterance_end_ms: "1200",
        no_delay: "true",
        punctuate: "true",
        diarize: "false",
        channels: "1",
        encoding: "linear16",
        sample_rate: "16000",
      });

      const socket = new WebSocket(
        `wss://api.deepgram.com/v1/listen?${params}`,
        ["token", tokenData.token]
      );
      socketRef.current = socket;

      socket.onopen = () => {
        setState(prev => ({ ...prev, connectionStatus: "connected", isListening: true }));

        const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
          ? "audio/webm;codecs=opus"
          : "audio/webm";

        const recorder = new MediaRecorder(stream, { mimeType, audioBitsPerSecond: 32000 });
        mediaRecorderRef.current = recorder;

        recorder.ondataavailable = e => {
          if (e.data.size > 0 && socket.readyState === WebSocket.OPEN) {
            socket.send(e.data);
          }
        };
        recorder.start(100); // 100ms chunks for low latency
      };

      socket.onmessage = e => {
        try {
          const msg = JSON.parse(e.data);
          if (msg.type !== "Results") return;

          const alt = msg.channel?.alternatives?.[0];
          if (!alt) return;

          const transcript = alt.transcript?.trim() || "";
          const isFinal = msg.is_final === true;
          const speechFinal = msg.speech_final === true;

          if (!transcript) return;

          if (isFinal || speechFinal) {
            pendingTranscriptRef.current = transcript;
            onTranscript(transcript, true);

            // Auto-send after speech final
            if (speechFinal && onAutoSend) {
              if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
              silenceTimerRef.current = setTimeout(() => {
                const text = pendingTranscriptRef.current.trim();
                const now = Date.now();
                if (text && (lastSentRef.current.text !== text || now - lastSentRef.current.at > 2000)) {
                  lastSentRef.current = { text, at: now };
                  onAutoSend(text);
                  pendingTranscriptRef.current = "";
                }
              }, 300);
            }
          } else {
            setState(prev => ({ ...prev, interimTranscript: transcript }));
            onTranscript(transcript, false);
          }
        } catch (_e) {}
      };

      socket.onerror = () => {
        onError?.("Voice connection interrupted. Reconnecting...");
        setState(prev => ({ ...prev, connectionStatus: "error" }));
      };

      socket.onclose = e => {
        if (e.code !== 1000) {
          setState(prev => ({ ...prev, connectionStatus: "disconnected", isListening: false }));
        }
      };

    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("Permission") || msg.includes("NotAllowed")) {
        onError?.("Microphone access denied. Allow mic permission and try again.");
      } else {
        onError?.(`Could not start voice: ${msg}`);
      }
      stopListening();
    }
  }, [state.isListening, startAudioMonitor, stopListening, onTranscript, onAutoSend, onError]);

  // TTS using browser SpeechSynthesis with role-matched voices
  const speak = useCallback((text: string, role: string = "default"): Promise<void> => {
    return new Promise(resolve => {
      if (!("speechSynthesis" in window)) { resolve(); return; }

      window.speechSynthesis.cancel();
      isSpeakingRef.current = true;
      setState(prev => ({ ...prev, isSpeaking: true }));

      const chunks = splitForSpeech(text);
      if (!chunks.length) { isSpeakingRef.current = false; setState(prev => ({ ...prev, isSpeaking: false })); resolve(); return; }

      const profile = ROLE_VOICE_PROFILES[role.toLowerCase()] || ROLE_VOICE_PROFILES.default;
      const voice = getBestVoiceForRole(role);

      let remaining = chunks.length;
      const onDone = () => {
        remaining--;
        if (remaining <= 0) {
          isSpeakingRef.current = false;
          setState(prev => ({ ...prev, isSpeaking: false }));
          resolve();
        }
      };

      chunks.forEach((chunk, i) => {
        const utt = new SpeechSynthesisUtterance(chunk);
        utt.pitch = profile.pitch + (chunk.endsWith("?") ? 0.05 : 0);
        utt.rate = profile.rate + (i % 3 === 0 ? 0.01 : -0.01);
        utt.volume = 1.0;
        if (voice) utt.voice = voice;
        utt.onend = onDone;
        utt.onerror = onDone;
        window.speechSynthesis.speak(utt);
      });
    });
  }, []);

  const stopSpeaking = useCallback(() => {
    window.speechSynthesis.cancel();
    isSpeakingRef.current = false;
    setState(prev => ({ ...prev, isSpeaking: false }));
  }, []);

  useEffect(() => {
    return () => {
      stopListening();
      stopSpeaking();
    };
  }, [stopListening, stopSpeaking]);

  return {
    ...state,
    startListening,
    stopListening,
    speak,
    stopSpeaking,
  };
}
