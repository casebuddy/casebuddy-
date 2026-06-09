import { Layout } from "@/components/Layout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { motion } from "framer-motion";
import { useQuery } from "@tanstack/react-query";
import { getCases, getCase, getDocumentsByCase } from "@/lib/api";
import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  Gavel,
  Play,
  Loader2,
  CheckCircle,
  Target,
  FileText,
  TrendingUp,
  TrendingDown,
  ClipboardList,
  Mic,
  Radio,
  Scale,
  User,
  MessageCircle,
  Hand,
  Headphones,
} from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { TrialPrepChecklist } from "@/components/TrialPrepChecklist";
import { TrialBinder } from "@/components/TrialBinder";
import { VoiceCourtroomV2 } from "@/components/courtroom/VoiceCourtroomV2";
import { cn } from "@/lib/utils";

const container = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: {
      staggerChildren: 0.05,
    },
  },
};

const item = {
  hidden: { opacity: 0, y: 20 },
  show: { opacity: 1, y: 0 },
};

const simulationModes = [
  {
    value: "cross-examination",
    label: "Cross-Examination",
    description: "Practice challenging opposing witnesses",
    icon: <Scale className="h-5 w-5" />,
    color: "text-red-400",
  },
  {
    value: "direct-examination",
    label: "Direct Examination",
    description: "Guide your own witness testimony",
    icon: <User className="h-5 w-5" />,
    color: "text-blue-400",
  },
  {
    value: "opening-statement",
    label: "Opening Statement",
    description: "Craft and deliver your opening",
    icon: <MessageCircle className="h-5 w-5" />,
    color: "text-emerald-400",
  },
  {
    value: "closing-argument",
    label: "Closing Argument",
    description: "Summarize and persuade the jury",
    icon: <Gavel className="h-5 w-5" />,
    color: "text-amber-400",
  },
  {
    value: "deposition",
    label: "Deposition",
    description: "Question witnesses under oath",
    icon: <FileText className="h-5 w-5" />,
    color: "text-cyan-400",
  },
  {
    value: "motion-hearing",
    label: "Motion Hearing",
    description: "Argue motions before the judge",
    icon: <Gavel className="h-5 w-5" />,
    color: "text-purple-400",
  },
  {
    value: "objections-practice",
    label: "Objections Practice",
    description: "Master courtroom objections and rulings",
    icon: <Hand className="h-5 w-5" />,
    color: "text-orange-400",
  },
  {
    value: "voir-dire",
    label: "Voir Dire",
    description: "Practice jury selection techniques",
    icon: <User className="h-5 w-5" />,
    color: "text-indigo-400",
  },
  {
    value: "evidence-foundation",
    label: "Evidence Foundation",
    description: "Learn to properly admit evidence",
    icon: <FileText className="h-5 w-5" />,
    color: "text-teal-400",
  },
];

export default function TrialPrep() {
  const [activeMainTab, setActiveMainTab] = useState("simulator");

  const { data: cases = [], isLoading } = useQuery({
    queryKey: ["cases"],
    queryFn: getCases,
  });

  const [searchParams] = useSearchParams();
  const [selectedCase, setSelectedCase] = useState<string>("");
  const [selectedMode, setSelectedMode] = useState<string>("cross-examination");
  const [isSimulating, setIsSimulating] = useState(false);

  useEffect(() => {
    const caseIdFromQuery = searchParams.get("caseId");
    if (caseIdFromQuery) {
      setSelectedCase(caseIdFromQuery);
    }
  }, [searchParams]);

  const { data: caseDetails } = useQuery({
    queryKey: ["case", selectedCase],
    queryFn: () => getCase(selectedCase),
    enabled: !!selectedCase,
  });

  const { data: documents = [] } = useQuery({
    queryKey: ["documents", selectedCase],
    queryFn: () => getDocumentsByCase(selectedCase),
    enabled: !!selectedCase,
  });

  const analyzedDocs = documents.filter(d => d.ai_analyzed);
  const allKeyFacts = analyzedDocs.flatMap(d => d.key_facts || []);
  const allFavorableFindings = analyzedDocs.flatMap(d => d.favorable_findings || []);
  const allAdverseFindings = analyzedDocs.flatMap(d => d.adverse_findings || []);
  const allActionItems = analyzedDocs.flatMap(d => d.action_items || []);

  const handleStartSimulation = () => {
    if (!selectedCase) {
      toast.error("Please select a case first");
      return;
    }
    setIsSimulating(true);
    const modeName = simulationModes.find(m => m.value === selectedMode)?.label || selectedMode;
    toast.success(`Starting ${modeName} simulation`);
  };

  const handleEndSimulation = () => {
    setIsSimulating(false);
    toast.info("Simulation ended");
  };

  const currentModeName = simulationModes.find(m => m.value === selectedMode)?.label || selectedMode;
  const currentCaseName = cases.find(c => c.id === selectedCase)?.name || "Case";

  // Full-screen courtroom when simulating
  if (isSimulating) {
    return (
      <Layout>
        <div className="h-[calc(100vh-64px)] p-2 sm:p-4">
          <VoiceCourtroom
            caseId={selectedCase}
            caseName={currentCaseName}
            mode={selectedMode}
            modeName={currentModeName}
            onEnd={handleEndSimulation}
          />
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="p-6 lg:p-8">
        <motion.div
          variants={container}
          initial="hidden"
          animate="show"
          className="max-w-7xl mx-auto space-y-8"
        >
          <motion.div variants={item}>
            <div className="flex items-center gap-3">
              <div className="p-2 bg-accent/10 rounded-lg">
                <Gavel className="h-7 w-7 text-accent" />
              </div>
              <div>
                <h1 className="text-2xl lg:text-3xl font-serif font-bold">
                  Voice Courtroom Simulator
                </h1>
                <p className="text-muted-foreground text-sm mt-0.5">
                  Immersive AI-powered courtroom simulation with real-time voice interaction and coaching
                </p>
              </div>
            </div>
          </motion.div>

          {/* Case Selector */}
          <motion.div variants={item}>
            <Card className="glass-card">
              <CardContent className="p-6">
                <div className="flex flex-col sm:flex-row gap-4">
                  <Select value={selectedCase} onValueChange={setSelectedCase}>
                    <SelectTrigger className="flex-1">
                      <SelectValue placeholder="Select a case to practice" />
                    </SelectTrigger>
                    <SelectContent>
                      {isLoading ? (
                        <div className="flex items-center justify-center p-4">
                          <Loader2 className="h-4 w-4 animate-spin" />
                        </div>
                      ) : cases.length === 0 ? (
                        <div className="p-4 text-sm text-muted-foreground text-center">
                          No cases available
                        </div>
                      ) : (
                        cases.map((c) => (
                          <SelectItem key={c.id} value={c.id}>
                            {c.name}
                          </SelectItem>
                        ))
                      )}
                    </SelectContent>
                  </Select>
                </div>
              </CardContent>
            </Card>
          </motion.div>

          {/* Main Tabs */}
          <Tabs value={activeMainTab} onValueChange={setActiveMainTab} className="space-y-6">
            <TabsList className="grid w-full max-w-lg grid-cols-3">
              <TabsTrigger value="simulator" className="flex items-center gap-2">
                <Gavel className="h-4 w-4" />
                Simulator
              </TabsTrigger>
              <TabsTrigger value="checklist" className="flex items-center gap-2">
                <ClipboardList className="h-4 w-4" />
                Checklist
              </TabsTrigger>
              <TabsTrigger value="binder" className="flex items-center gap-2">
                <FileText className="h-4 w-4" />
                Trial Binder
              </TabsTrigger>
            </TabsList>

            {/* Simulator Tab */}
            <TabsContent value="simulator" className="space-y-6">
              <div className="grid gap-6 lg:grid-cols-3">
                {/* Main Content */}
                <motion.div variants={item} className="lg:col-span-2 space-y-6">
                  {/* Mode Selection Grid */}
                  <Card className="glass-card overflow-hidden">
                    <CardHeader className="pb-3">
                      <CardTitle className="text-base">Select Simulation Mode</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                        {simulationModes.map((mode) => (
                          <button
                            key={mode.value}
                            onClick={() => setSelectedMode(mode.value)}
                            className={cn(
                              "flex items-start gap-3 p-3 rounded-lg border text-left transition-all",
                              selectedMode === mode.value
                                ? "border-accent bg-accent/5 ring-1 ring-accent/30"
                                : "border-border hover:border-accent/40 hover:bg-accent/5"
                            )}
                          >
                            <div className={cn("mt-0.5 flex-shrink-0", mode.color)}>
                              {mode.icon}
                            </div>
                            <div className="min-w-0">
                              <p className="text-sm font-medium leading-tight">{mode.label}</p>
                              <p className="text-xs text-muted-foreground mt-0.5 leading-tight">
                                {mode.description}
                              </p>
                            </div>
                          </button>
                        ))}
                      </div>
                    </CardContent>
                  </Card>

                  {/* Launch Panel */}
                  <Card className="overflow-hidden">
                    <div className="bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 p-8 min-h-[300px] flex flex-col items-center justify-center text-center relative">
                      {/* Decorative courtroom elements */}
                      <div className="absolute inset-0 overflow-hidden opacity-5 pointer-events-none">
                        <div className="absolute top-4 left-1/2 -translate-x-1/2 w-32 h-32 border-4 border-white rounded-full" />
                        <div className="absolute bottom-0 left-0 right-0 h-16 border-t-2 border-white" />
                      </div>

                      <motion.div
                        animate={{ scale: [1, 1.05, 1] }}
                        transition={{ duration: 3, repeat: Infinity }}
                        className="relative"
                      >
                        <div className="w-20 h-20 rounded-full bg-accent/10 flex items-center justify-center mb-6">
                          <Gavel className="h-10 w-10 text-accent/60" />
                        </div>
                      </motion.div>

                      <h2 className="text-xl font-semibold text-white mb-2">
                        {currentModeName}
                      </h2>
                      <p className="text-slate-400 text-sm max-w-md mb-3">
                        {simulationModes.find(m => m.value === selectedMode)?.description}
                      </p>

                      <div className="flex items-center gap-4 text-xs text-slate-500 mb-8">
                        <div className="flex items-center gap-1.5">
                          <Mic className="h-3.5 w-3.5" />
                          Voice input
                        </div>
                        <div className="flex items-center gap-1.5">
                          <Headphones className="h-3.5 w-3.5" />
                          AI voice output
                        </div>
                        <div className="flex items-center gap-1.5">
                          <Radio className="h-3.5 w-3.5" />
                          Hands-free mode
                        </div>
                      </div>

                      <Button
                        size="lg"
                        className="gap-2 bg-accent hover:bg-accent/90 text-white px-8 relative z-10"
                        onClick={handleStartSimulation}
                        disabled={!selectedCase}
                      >
                        <Play className="h-5 w-5" />
                        Enter Courtroom
                      </Button>

                      {!selectedCase && (
                        <p className="text-xs text-slate-500 mt-3">
                          Select a case above to begin
                        </p>
                      )}
                    </div>
                  </Card>
                </motion.div>

                {/* Sidebar */}
                <motion.div variants={item} className="space-y-6">
                  {/* Case Theory */}
                  {selectedCase && caseDetails && (
                    <Card className="glass-card">
                      <CardHeader className="pb-3">
                        <CardTitle className="flex items-center gap-2 text-base">
                          <Target className="h-5 w-5 text-accent" />
                          Case Theory
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="space-y-4">
                        {caseDetails.case_theory && (
                          <div>
                            <p className="text-sm text-muted-foreground mb-1">Theory</p>
                            <p className="text-sm">{caseDetails.case_theory}</p>
                          </div>
                        )}
                        {caseDetails.key_issues && caseDetails.key_issues.length > 0 && (
                          <div>
                            <p className="text-sm text-muted-foreground mb-2">Key Issues</p>
                            <div className="space-y-1">
                              {caseDetails.key_issues.map((issue, idx) => (
                                <div key={idx} className="flex items-start gap-2">
                                  <CheckCircle className="h-3.5 w-3.5 text-accent mt-0.5 flex-shrink-0" />
                                  <p className="text-xs">{issue}</p>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  )}

                  {/* Favorable Findings */}
                  {selectedCase && allFavorableFindings.length > 0 && (
                    <Card className="glass-card">
                      <CardHeader className="pb-3">
                        <CardTitle className="flex items-center gap-2 text-base">
                          <TrendingUp className="h-5 w-5 text-green-500" />
                          Strengths ({allFavorableFindings.length})
                        </CardTitle>
                      </CardHeader>
                      <CardContent>
                        <div className="space-y-2">
                          {allFavorableFindings.slice(0, 5).map((finding, idx) => (
                            <div key={idx} className="flex items-start gap-2 text-xs">
                              <div className="h-1.5 w-1.5 rounded-full bg-green-500 mt-1.5 flex-shrink-0" />
                              <p>{finding}</p>
                            </div>
                          ))}
                          {allFavorableFindings.length > 5 && (
                            <p className="text-xs text-muted-foreground text-center pt-2">
                              +{allFavorableFindings.length - 5} more
                            </p>
                          )}
                        </div>
                      </CardContent>
                    </Card>
                  )}

                  {/* Adverse Findings */}
                  {selectedCase && allAdverseFindings.length > 0 && (
                    <Card className="glass-card">
                      <CardHeader className="pb-3">
                        <CardTitle className="flex items-center gap-2 text-base">
                          <TrendingDown className="h-5 w-5 text-red-500" />
                          Weaknesses ({allAdverseFindings.length})
                        </CardTitle>
                      </CardHeader>
                      <CardContent>
                        <div className="space-y-2">
                          {allAdverseFindings.slice(0, 5).map((finding, idx) => (
                            <div key={idx} className="flex items-start gap-2 text-xs">
                              <div className="h-1.5 w-1.5 rounded-full bg-red-500 mt-1.5 flex-shrink-0" />
                              <p>{finding}</p>
                            </div>
                          ))}
                          {allAdverseFindings.length > 5 && (
                            <p className="text-xs text-muted-foreground text-center pt-2">
                              +{allAdverseFindings.length - 5} more
                            </p>
                          )}
                        </div>
                      </CardContent>
                    </Card>
                  )}

                  {/* Discovery Summary */}
                  {selectedCase && (
                    <Card className="glass-card">
                      <CardHeader className="pb-3">
                        <CardTitle className="flex items-center gap-2 text-base">
                          <FileText className="h-5 w-5 text-accent" />
                          Discovery Summary
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="space-y-3">
                        <div className="flex items-center justify-between">
                          <span className="text-sm text-muted-foreground">Total Documents</span>
                          <Badge variant="outline">{documents.length}</Badge>
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-sm text-muted-foreground">AI Analyzed</span>
                          <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200">
                            {analyzedDocs.length}
                          </Badge>
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-sm text-muted-foreground">Key Facts</span>
                          <Badge variant="outline">{allKeyFacts.length}</Badge>
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-sm text-muted-foreground">Action Items</span>
                          <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-200">
                            {allActionItems.length}
                          </Badge>
                        </div>
                      </CardContent>
                    </Card>
                  )}
                </motion.div>
              </div>
            </TabsContent>

            {/* Checklist Tab */}
            <TabsContent value="checklist">
              {selectedCase ? (
                <TrialPrepChecklist caseId={selectedCase} />
              ) : (
                <Card>
                  <CardContent className="flex items-center justify-center h-48">
                    <p className="text-muted-foreground">Please select a case above to view the trial prep checklist.</p>
                  </CardContent>
                </Card>
              )}
            </TabsContent>

            {/* Binder Tab */}
            <TabsContent value="binder">
              {selectedCase ? (
                <TrialBinder caseId={selectedCase} caseName={currentCaseName} />
              ) : (
                <Card>
                  <CardContent className="flex items-center justify-center h-48">
                    <p className="text-muted-foreground">Please select a case above to view the trial binder.</p>
                  </CardContent>
                </Card>
              )}
            </TabsContent>
          </Tabs>
        </motion.div>
      </div>
    </Layout>
  );
}
