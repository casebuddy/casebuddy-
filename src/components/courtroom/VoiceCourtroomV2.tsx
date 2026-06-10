import { useState, useRef, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { motion, AnimatePresence } from "framer-motion";
import {
  Gavel, Square, Mic, MicOff, Volume2, VolumeX,
  Loader2, Lightbulb, Timer,
  Download, Radio, Hand, ChevronRight,
  Brain
} from "lucide-react";
import { useDeepgramCourtroom } from "@/hooks/useDeepgramCourtroom";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useMutation } from "@tanstack/react-query";
import { cn } from "@/lib/utils";
import {
  createTrialSession, endTrialSession,
  addTranscriptMessage, addCoachingTip, PerformanceMetrics,
} from "@/lib/trial-session-api";

// ─── Types ───────────────────────────────────────────────────────────────────

interface Message {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: Date;
  aiRole?: string;
  coaching?: string;
  durationMs?: number;
}

interface SimulationResponse {
  success: boolean;
  message: string;
  coaching?: string;
  role: string;
  performanceHints?: string[];
  objectionTypes?: string[];
  courtroomAction?: string;
  emotionalTone?: string;
}

interface VoiceCourtroomV2Props {
  caseId: string;
  caseName: string;
  mode: string;
  modeName: string;
  onEnd: () => void;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const OBJECTION_BUTTONS = [
  { label: "Hearsay", shortcut: "H" },
  { label: "Leading", shortcut: "L" },
  { label: "Relevance", shortcut: "R" },
  { label: "Speculation", shortcut: "S" },
  { label: "Foundation", shortcut: "F" },
  { label: "Compound", shortcut: "C" },
  { label: "Argumentative", shortcut: "A" },
  { label: "Asked & Answered", shortcut: "AA" },
];

const ROLE_COLORS: Record<string, string> = {
  judge: "text-amber-400",
  witness: "text-blue-400",
  "opposing counsel": "text-rose-400",
  "court clerk": "text-slate-400",
  "potential juror": "text-purple-400",
  deponent: "text-cyan-400",
  "skeptical judge": "text-amber-300",
  default: "text-slate-300",
};

const ROLE_EMOJI: Record<string, string> = {
  judge: "⚖️",
  witness: "💬",
  "opposing counsel": "⚔️",
  "court clerk": "📋",
  "potential juror": "👤",
  deponent: "📝",
  "skeptical judge": "🔨",
  default: "🏛️",
};

function getRoleColor(role: string) {
  const lower = role.toLowerCase();
  for (const [k, v] of Object.entries(ROLE_COLORS)) {
    if (lower.includes(k)) return v;
  }
  return ROLE_COLORS.default;
}
function getRoleEmoji(role: string) {
  const lower = role.toLowerCase();
  for (const [k, v] of Object.entries(ROLE_EMOJI)) {
    if (lower.includes(k)) return v;
  }
  return ROLE_EMOJI.default;
}

// ─── Audio Visualizer ─────────────────────────────────────────────────────────

function LiveVisualizer({ level, active, color = "bg-red-500" }: { level: number; active: boolean; color?: string }) {
  const BAR_COUNT = 16;
  return (
    <div className="flex items-end gap-[2px] h-10">
      {Array.from({ length: BAR_COUNT }).map((_, i) => {
        const wave = active ? Math.max(0.05, level * (0.7 + 0.6 * Math.abs(Math.sin(Date.now() / 80 + i * 0.7)))) : 0.05;
        return (
          <motion.div
            key={i}
            className={cn("w-[3px] rounded-full", active ? color : "bg-slate-700")}
            animate={{ height: Math.max(3, wave * 40) }}
            transition={{ duration: 0.07, ease: "easeOut" }}
          />
        );
      })}
    </div>
  );
}

// ─── Speaking Wave ────────────────────────────────────────────────────────────

function SpeakingWave({ role }: { role: string }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-slate-700/80 border border-slate-600/40"
    >
      <div className="flex gap-[3px] items-end h-4">
        {[0, 1, 2, 3, 4].map(i => (
          <motion.div
            key={i}
            className="w-[3px] rounded-full bg-emerald-400"
            animate={{ height: [3, 14, 6, 16, 3] }}
            transition={{ duration: 0.7, repeat: Infinity, delay: i * 0.12, ease: "easeInOut" }}
          />
        ))}
      </div>
      <span className={cn("text-xs font-semibold", getRoleColor(role))}>
        {getRoleEmoji(role)} {role || "AI"} speaking
      </span>
    </motion.div>
  );
}

// ─── Message Bubble ───────────────────────────────────────────────────────────

function MessageBubble({ message }: { message: Message }) {
  const isUser = message.role === "user";
  const isSystem = message.role === "system";

  if (isSystem) {
    return (
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="flex justify-center py-3"
      >
        <div className="bg-slate-800/60 border border-slate-700/50 rounded-full px-4 py-1.5 flex items-center gap-2">
          <Gavel className="h-3 w-3 text-amber-400" />
          <p className="text-xs text-slate-400">{message.content}</p>
        </div>
      </motion.div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 6, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.2 }}
      className={cn("flex gap-3 group", isUser ? "flex-row-reverse" : "flex-row")}
    >
      {/* Avatar */}
      <div className={cn(
        "flex-shrink-0 w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold border",
        isUser
          ? "bg-accent/20 border-accent/30 text-accent"
          : "bg-slate-700/80 border-slate-600/40 text-slate-200"
      )}>
        {isUser ? "ATY" : <span className="text-base">{getRoleEmoji(message.aiRole || "default")}</span>}
      </div>

      <div className={cn("max-w-[78%] space-y-1", isUser ? "items-end text-right" : "items-start")}>
        {/* Role label */}
        {!isUser && message.aiRole && (
          <div className="flex items-center gap-1.5">
            <span className={cn("text-[10px] font-bold uppercase tracking-wider", getRoleColor(message.aiRole))}>
              {message.aiRole}
            </span>
            {message.durationMs && (
              <span className="text-[9px] text-slate-600">
                {(message.durationMs / 1000).toFixed(1)}s
              </span>
            )}
          </div>
        )}

        {/* Speech bubble */}
        <div className={cn(
          "rounded-2xl px-4 py-3 text-sm leading-relaxed shadow-sm",
          isUser
            ? "bg-accent text-white rounded-tr-sm"
            : "bg-slate-800/90 text-slate-100 rounded-tl-sm border border-slate-700/40"
        )}>
          <p className="whitespace-pre-wrap">{message.content}</p>
        </div>

        {/* Coaching hint */}
        {message.coaching && !isUser && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            className="flex items-start gap-1.5 mt-1.5 p-2.5 bg-amber-500/10 border border-amber-500/20 rounded-xl"
          >
            <Lightbulb className="h-3.5 w-3.5 text-amber-400 flex-shrink-0 mt-0.5" />
            <p className="text-xs text-amber-200/80 leading-relaxed">{message.coaching}</p>
          </motion.div>
        )}

        <span className="text-[10px] text-slate-600 px-1">
          {message.timestamp.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
        </span>
      </div>
    </motion.div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function VoiceCourtroomV2({ caseId, caseName, mode, modeName, onEnd }: VoiceCourtroomV2Props) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [currentInput, setCurrentInput] = useState("");
  const [aiRole, setAiRole] = useState("");
  const [exchangeCount, setExchangeCount] = useState(0);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [speechEnabled, setSpeechEnabled] = useState(true);
  const [showObjections, setShowObjections] = useState(mode === "objections-practice" || mode === "cross-examination");
  const [sessionStartTime] = useState(Date.now());
  const [elapsed, setElapsed] = useState(0);
  const [metrics, setMetrics] = useState<PerformanceMetrics>({
    totalQuestions: 0, successfulObjections: 0, missedObjections: 0,
    leadingQuestionsUsed: 0, openQuestionsUsed: 0,
    avgResponseTimeMs: null, credibilityScore: null,
  });

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const sessionCreatedRef = useRef(false);
  const isHandsFreeRef = useRef(true);
  const [handsFreeModeOn, setHandsFreeModeOn] = useState(true);
  const responseStartRef = useRef<number>(0);

  // ── Deepgram voice engine
  const voice = useDeepgramCourtroom({
    onTranscript: (text, isFinal) => {
      setCurrentInput(text);
    },
    onAutoSend: (text) => {
      if (text.trim() && !simulationMutation.isPending && !voice.isSpeaking) {
        handleSend(text.trim());
      }
    },
    onError: (err) => {
      toast.error(err, { duration: 4000 });
    },
  });

  // ── Timer
  useEffect(() => {
    const t = setInterval(() => setElapsed(Math.floor((Date.now() - sessionStartTime) / 1000)), 1000);
    return () => clearInterval(t);
  }, [sessionStartTime]);

  // ── Auto-scroll
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // ── Create session
  useEffect(() => {
    if (sessionCreatedRef.current) return;
    sessionCreatedRef.current = true;
    createTrialSession({ case_id: caseId, mode, scenario: modeName })
      .then(s => setSessionId(s.id))
      .catch(console.error);
  }, [caseId, mode, modeName]);

  // ── Auto-arm mic (hands-free)
  useEffect(() => {
    if (!handsFreeModeOn) return;
    if (voice.isListening || voice.isSpeaking || simulationMutation.isPending) return;

    const t = setTimeout(() => {
      if (!voice.isListening && !voice.isSpeaking) {
        voice.startListening();
      }
    }, 400);
    return () => clearTimeout(t);
  }, [
    handsFreeModeOn, voice.isListening, voice.isSpeaking,
    voice.startListening, simulationMutation.isPending,
  ]);

  // ── AI simulation
  const simulationMutation = useMutation({
    mutationFn: async (userMessage: string) => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("Not authenticated");

      responseStartRef.current = Date.now();

      const conversationHistory = messages
        .filter(m => m.role !== "system")
        .map(m => ({ role: m.role, content: m.content }));

      const { data, error } = await supabase.functions.invoke("trial-simulation", {
        body: {
          caseId,
          mode,
          messages: [
            ...conversationHistory,
            { role: "user", content: userMessage },
          ],
        },
      });

      if (error) throw error;
      return data as SimulationResponse;
    },

    onSuccess: async (data, userMessage) => {
      const durationMs = Date.now() - responseStartRef.current;

      const aiMsg: Message = {
        id: `ai-${Date.now()}`,
        role: "assistant",
        content: data.message,
        timestamp: new Date(),
        aiRole: data.role,
        coaching: undefined,
        durationMs,
      };

      setMessages(prev => {
        const updated = [...prev, aiMsg];
        // Attach coaching to this message if available
        if (data.coaching) {
          updated[updated.length - 1] = { ...aiMsg, coaching: data.coaching };
        }
        return updated;
      });

      setAiRole(data.role);
      setExchangeCount(c => c + 1);

      // Track metrics
      const lower = userMessage.toLowerCase();
      setMetrics(prev => ({
        ...prev,
        totalQuestions: prev.totalQuestions + 1,
        openQuestionsUsed: prev.openQuestionsUsed + (/\b(what|how|why|when|where|who)\b/.test(lower) ? 1 : 0),
        leadingQuestionsUsed: prev.leadingQuestionsUsed + (
          /isn't it true|wouldn't you agree|isn't that correct/i.test(lower) ? 1 : 0
        ),
      }));

      // Save to session
      if (sessionId) {
        addTranscriptMessage(sessionId, {
          role: "assistant", content: data.message,
          timestamp: new Date().toISOString(), aiRole: data.role,
        }).catch(console.error);
        if (data.coaching) addCoachingTip(sessionId, data.coaching).catch(console.error);
      }

      // Speak the response
      if (speechEnabled) {
        voice.stopListening();
        await voice.speak(data.message, data.role);
        // Re-arm mic after AI finishes speaking
        if (handsFreeModeOn) {
          setTimeout(() => voice.startListening(), 300);
        }
      }
    },

    onError: (err: Error) => {
      const msg = err.message?.includes("authenticated")
        ? "Session expired. Please log in again."
        : err.message || "AI response failed. Please try again.";
      toast.error(msg, { duration: 5000 });
    },
  });

  const handleSend = useCallback((text?: string) => {
    const msg = (text || currentInput).trim();
    if (!msg || simulationMutation.isPending) return;

    voice.stopListening();
    voice.stopSpeaking();
    setCurrentInput("");

    const userMsg: Message = {
      id: `user-${Date.now()}`,
      role: "user",
      content: msg,
      timestamp: new Date(),
    };
    setMessages(prev => [...prev, userMsg]);

    if (sessionId) {
      addTranscriptMessage(sessionId, {
        role: "user", content: msg,
        timestamp: new Date().toISOString(),
      }).catch(console.error);
    }

    simulationMutation.mutate(msg);
  }, [currentInput, simulationMutation, voice, sessionId]);

  const handleObjection = (type: string) => {
    handleSend(`Objection, Your Honor — ${type}.`);
  };

  const handleEndSession = async () => {
    voice.stopListening();
    voice.stopSpeaking();

    if (sessionId) {
      const finalMetrics: PerformanceMetrics = {
        ...metrics,
        credibilityScore: metrics.totalQuestions > 0
          ? Math.min(10, Math.max(1, 7 + metrics.successfulObjections * 0.5 - metrics.missedObjections * 0.3))
          : null,
      };
      try {
        await endTrialSession(sessionId, finalMetrics);
        toast.success(`Session complete — ${exchangeCount} exchanges logged.`);
      } catch (_e) {}
    }
    onEnd();
  };

  const exportTranscript = () => {
    const text = messages.map(m => {
      const who = m.role === "user" ? "ATTORNEY" : m.role === "system" ? "COURT" : (m.aiRole || "AI").toUpperCase();
      return `[${m.timestamp.toLocaleTimeString()}] ${who}:\n${m.content}`;
    }).join("\n\n");

    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
    a.download = `transcript-${caseName.replace(/\s+/g, "-")}-${new Date().toISOString().slice(0, 10)}.txt`;
    a.click();
    toast.success("Transcript exported");
  };

  const elMin = Math.floor(elapsed / 60);
  const elSec = elapsed % 60;
  const isActive = voice.isListening || voice.isSpeaking || simulationMutation.isPending;

  return (
    <div className="flex flex-col h-[calc(100vh-8rem)] max-h-[860px] bg-gradient-to-b from-slate-900 to-slate-950 rounded-xl overflow-hidden border border-slate-700/50 shadow-2xl">

      {/* ── Header ── */}
      <div className="flex-shrink-0 bg-slate-800/90 border-b border-slate-700/50 px-4 py-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            {/* Live indicator */}
            <div className="relative flex-shrink-0">
              <div className="w-2.5 h-2.5 rounded-full bg-red-500" />
              <motion.div
                className="absolute inset-0 w-2.5 h-2.5 rounded-full bg-red-500"
                animate={{ scale: [1, 2, 1], opacity: [1, 0, 1] }}
                transition={{ duration: 2, repeat: Infinity }}
              />
            </div>
            <div>
              <p className="text-sm font-semibold text-white">{modeName}</p>
              <p className="text-xs text-slate-400">{caseName}</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Badge variant="outline" className="text-xs border-slate-600 text-slate-300 gap-1 bg-slate-700/40">
              <Timer className="h-3 w-3" />
              {elMin}:{String(elSec).padStart(2, "0")}
            </Badge>
            <Badge variant="outline" className="text-xs border-slate-600 text-slate-300 bg-slate-700/40">
              {exchangeCount} exchanges
            </Badge>

            {/* Voice status */}
            <Badge
              variant="outline"
              className={cn(
                "text-xs gap-1",
                voice.connectionStatus === "connected"
                  ? "border-emerald-500/50 text-emerald-400 bg-emerald-500/10"
                  : voice.connectionStatus === "connecting"
                  ? "border-amber-500/50 text-amber-400 bg-amber-500/10"
                  : "border-slate-600 text-slate-500 bg-slate-700/40"
              )}
            >
              <Radio className={cn("h-3 w-3", voice.connectionStatus === "connected" && "animate-pulse")} />
              {voice.connectionStatus === "connected" ? "Deepgram Live"
                : voice.connectionStatus === "connecting" ? "Connecting..."
                : "Voice Off"}
            </Badge>

            <Button variant="ghost" size="sm" onClick={exportTranscript} className="h-7 px-2 text-slate-400 hover:text-white">
              <Download className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleEndSession}
              className="h-7 px-3 text-red-400 hover:text-red-300 hover:bg-red-500/10 border border-red-500/20"
            >
              <Square className="h-3 w-3 mr-1" />
              End
            </Button>
          </div>
        </div>
      </div>

      {/* ── Body ── */}
      <div className="flex flex-1 overflow-hidden">

        {/* ── Transcript ── */}
        <div className="flex flex-col flex-1 min-w-0">
          <ScrollArea className="flex-1 px-4 py-3">
            {messages.length === 0 && (
              <div className="flex flex-col items-center justify-center h-48 text-center gap-3">
                <div className="w-14 h-14 rounded-full bg-slate-800 border border-slate-700 flex items-center justify-center text-2xl">
                  ⚖️
                </div>
                <div>
                  <p className="text-slate-300 font-medium">{modeName} — Ready</p>
                  <p className="text-slate-500 text-sm mt-1">
                    Speak or type to begin. AI is listening.
                  </p>
                </div>
                <div className="flex items-center gap-1.5 text-xs text-emerald-400/80 bg-emerald-500/10 px-3 py-1.5 rounded-full border border-emerald-500/20">
                  <Brain className="h-3 w-3" />
                  Full case context loaded — documents, witnesses, timeline
                </div>
              </div>
            )}

            <div className="space-y-4 pb-2">
              {messages.map(m => <MessageBubble key={m.id} message={m} />)}
            </div>

            {/* AI thinking indicator */}
            {simulationMutation.isPending && (
              <motion.div
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                className="flex gap-3 mt-3"
              >
                <div className="w-9 h-9 rounded-full bg-slate-700/80 border border-slate-600/40 flex items-center justify-center text-base">
                  {getRoleEmoji(aiRole)}
                </div>
                <div className="bg-slate-800/90 border border-slate-700/40 rounded-2xl rounded-tl-sm px-4 py-3">
                  <div className="flex gap-1.5 items-center">
                    <motion.div className="w-2 h-2 bg-slate-500 rounded-full" animate={{ opacity: [0.3, 1, 0.3] }} transition={{ duration: 1.2, repeat: Infinity, delay: 0 }} />
                    <motion.div className="w-2 h-2 bg-slate-500 rounded-full" animate={{ opacity: [0.3, 1, 0.3] }} transition={{ duration: 1.2, repeat: Infinity, delay: 0.3 }} />
                    <motion.div className="w-2 h-2 bg-slate-500 rounded-full" animate={{ opacity: [0.3, 1, 0.3] }} transition={{ duration: 1.2, repeat: Infinity, delay: 0.6 }} />
                  </div>
                </div>
              </motion.div>
            )}
            <div ref={messagesEndRef} />
          </ScrollArea>

          {/* ── Speaking status ── */}
          <div className="flex-shrink-0 px-4 py-2 min-h-[40px] flex items-center gap-3">
            <AnimatePresence>
              {voice.isSpeaking && aiRole && <SpeakingWave key="speaking" role={aiRole} />}
              {voice.isListening && !voice.isSpeaking && (
                <motion.div
                  key="listening"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="flex items-center gap-2"
                >
                  <LiveVisualizer level={voice.audioLevel} active={voice.isListening} color="bg-red-400" />
                  <span className="text-xs text-red-400 font-medium">Listening…</span>
                  {currentInput && (
                    <span className="text-xs text-slate-500 italic max-w-[200px] truncate">"{currentInput}"</span>
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* ── Input bar ── */}
          <div className="flex-shrink-0 border-t border-slate-700/50 bg-slate-800/60 px-4 py-3">
            <div className="flex items-end gap-2">
              <div className="flex-1 relative">
                <textarea
                  value={currentInput}
                  onChange={e => setCurrentInput(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      handleSend();
                    }
                  }}
                  placeholder={voice.isListening ? "Listening… speak or type" : "Type your question or statement…"}
                  rows={2}
                  className="w-full bg-slate-900/80 border border-slate-700/60 rounded-xl px-3 py-2.5 text-sm text-slate-100 placeholder:text-slate-600 resize-none focus:outline-none focus:border-accent/50 focus:ring-1 focus:ring-accent/20"
                />
              </div>

              {/* Mic toggle */}
              <Button
                size="icon"
                variant="ghost"
                onClick={() => {
                  if (voice.isListening) {
                    voice.stopListening();
                    setHandsFreeModeOn(false);
                  } else {
                    setHandsFreeModeOn(true);
                    voice.startListening();
                  }
                }}
                className={cn(
                  "h-10 w-10 rounded-xl border flex-shrink-0",
                  voice.isListening
                    ? "bg-red-500/20 border-red-500/40 text-red-400 hover:bg-red-500/30"
                    : "bg-slate-700/40 border-slate-600/40 text-slate-400 hover:text-white"
                )}
              >
                {voice.isListening ? <Mic className="h-4 w-4" /> : <MicOff className="h-4 w-4" />}
              </Button>

              {/* TTS toggle */}
              <Button
                size="icon"
                variant="ghost"
                onClick={() => setSpeechEnabled(p => !p)}
                className={cn(
                  "h-10 w-10 rounded-xl border flex-shrink-0",
                  speechEnabled
                    ? "bg-slate-700/40 border-slate-600/40 text-emerald-400"
                    : "bg-slate-700/40 border-slate-600/40 text-slate-600"
                )}
              >
                {speechEnabled ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
              </Button>

              {/* Send */}
              <Button
                onClick={() => handleSend()}
                disabled={!currentInput.trim() || simulationMutation.isPending}
                size="icon"
                className="h-10 w-10 rounded-xl flex-shrink-0 bg-accent hover:bg-accent/90"
              >
                {simulationMutation.isPending
                  ? <Loader2 className="h-4 w-4 animate-spin" />
                  : <ChevronRight className="h-4 w-4" />}
              </Button>
            </div>

            {/* Hands-free badge */}
            <div className="flex items-center justify-between mt-2">
              <button
                onClick={() => {
                  const next = !handsFreeModeOn;
                  setHandsFreeModeOn(next);
                  if (!next) voice.stopListening();
                  toast.info(next ? "Hands-free ON — mic auto-arms after each response" : "Hands-free OFF — tap mic to speak");
                }}
                className={cn(
                  "flex items-center gap-1.5 text-xs rounded-full px-2.5 py-1 border transition-colors",
                  handsFreeModeOn
                    ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-400"
                    : "bg-slate-700/30 border-slate-600/30 text-slate-500"
                )}
              >
                <Radio className="h-3 w-3" />
                {handsFreeModeOn ? "Hands-Free ON" : "Hands-Free OFF"}
              </button>

              {mode !== "opening-statement" && mode !== "closing-argument" && (
                <button
                  onClick={() => setShowObjections(p => !p)}
                  className="flex items-center gap-1 text-xs text-slate-500 hover:text-slate-300"
                >
                  <Hand className="h-3 w-3" />
                  {showObjections ? "Hide" : "Show"} objections
                </button>
              )}
            </div>
          </div>

          {/* ── Objection buttons ── */}
          <AnimatePresence>
            {showObjections && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                className="flex-shrink-0 overflow-hidden border-t border-slate-700/50 bg-slate-900/40"
              >
                <div className="px-4 py-2 flex flex-wrap gap-1.5">
                  {OBJECTION_BUTTONS.map(obj => (
                    <button
                      key={obj.label}
                      onClick={() => handleObjection(obj.label)}
                      disabled={simulationMutation.isPending}
                      className="px-3 py-1 text-xs rounded-lg bg-rose-500/10 border border-rose-500/25 text-rose-300 hover:bg-rose-500/20 hover:border-rose-500/40 transition-colors font-medium disabled:opacity-40"
                    >
                      <Hand className="h-2.5 w-2.5 inline mr-1" />
                      {obj.label}
                    </button>
                  ))}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}

