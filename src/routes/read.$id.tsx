import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ChevronLeft,
  ChevronRight,
  Pause,
  Play,
  ArrowLeft,
  Settings2,
  Bookmark,
  BookmarkCheck,
  Search,
  Loader2,
  SkipBack,
  SkipForward,
} from "lucide-react";
import {
  getPdfBlob,
  getPdfMeta,
  updateMeta,
  type PdfRecord,
} from "@/lib/pdf-storage";
import { extractPageText, loadPdfFromBlob, type PageContent } from "@/lib/pdf-engine";
import { getVoices } from "@/lib/tts";

export const Route = createFileRoute("/read/$id")({
  component: Reader,
  ssr: false,
});

function Reader() {
  const { id } = Route.useParams();
  const navigate = useNavigate();

  const [meta, setMeta] = useState<PdfRecord | null>(null);
  const [pdfDoc, setPdfDoc] = useState<Awaited<ReturnType<typeof loadPdfFromBlob>> | null>(null);
  const [page, setPage] = useState<number>(1);
  const [pageContent, setPageContent] = useState<PageContent | null>(null);
  const [loadingPage, setLoadingPage] = useState(false);

  const [isPlaying, setIsPlaying] = useState(false);
  const [activeWord, setActiveWord] = useState<number>(-1);
  const [rate, setRate] = useState<number>(1);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [voiceGender, setVoiceGender] = useState<"female" | "male">("female");
  const [voiceOptions, setVoiceOptions] = useState<{ female: string; male: string }>({
    female: "",
    male: "",
  });
  const [settingsOpen, setSettingsOpen] = useState(false);

  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<{ page: number; preview: string }[]>([]);
  const [searching, setSearching] = useState(false);

  const utterRef = useRef<SpeechSynthesisUtterance | null>(null);
  const wordsRef = useRef<PageContent["words"]>([]);
  const activeWordElRef = useRef<HTMLSpanElement | null>(null);
  const readyToPlayNextRef = useRef(false);
  const hasStartedPlaybackRef = useRef(false);

  // Load PDF + meta
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const m = await getPdfMeta(id);
      if (!m) {
        navigate({ to: "/" });
        return;
      }
      const blob = await getPdfBlob(id);
      if (!blob) return;
      const doc = await loadPdfFromBlob(blob);
      if (cancelled) {
        await doc.destroy();
        return;
      }
      setMeta(m);
      setPdfDoc(doc);
      setPage(m.lastPage || 1);
    })();
    return () => {
      cancelled = true;
      window.speechSynthesis.cancel();
    };
  }, [id, navigate]);

  // Voices — prefer calm female voices
  useEffect(() => {
    getVoices().then((v) => {
      setVoices(v);
      const femaleHints = [
        "samantha", "victoria", "karen", "moira", "tessa", "fiona", "serena",
        "allison", "ava", "susan", "kate", "zira", "hazel", "joanna", "salli",
        "amy", "emma", "aria", "jenny", "libby", "sonia", "en-us-language",
        "google uk english female", "google us english",
        "female", "woman",
      ];
      const maleHints = [
        "andrew", "daniel", "david", "george", "fred", "alex", "guy",
        "brian", "ryan", "arthur", "davis", "christopher", "en-gb-language",
        "male", "man",
      ];
      const baseScore = (voice: SpeechSynthesisVoice) => {
        const n = voice.name.toLowerCase();
        let s = 0;
        if (voice.lang.toLowerCase().startsWith("en")) s += 10;
        if (n.includes("google")) s += 3;
        if (n.includes("natural") || n.includes("neural") || n.includes("premium")) s += 5;
        return s;
      };
      const femaleScore = (voice: SpeechSynthesisVoice) => {
        const n = voice.name.toLowerCase();
        let s = baseScore(voice);
        if (femaleHints.some((h) => n.includes(h))) s += 20;
        if (n.includes("male") && !n.includes("female")) s -= 15;
        return s;
      };
      const maleScore = (voice: SpeechSynthesisVoice) => {
        const n = voice.name.toLowerCase();
        let s = baseScore(voice);
        if (maleHints.some((h) => n.includes(h))) s += 20;
        if (n.includes("female") && !n.includes("male")) s -= 15;
        return s;
      };
      const findByName = (needles: string[]) =>
        v.find((voice) => needles.some((n) => voice.name.toLowerCase().includes(n.toLowerCase())));
      const preferredFemale = findByName([
        "microsoft ava",
        "ava (natural)",
        "ava online",
        "samantha",
        "google uk english female",
      ]);
      const preferredMale = findByName([
        "microsoft andrew",
        "andrew (natural)",
        "andrew online",
        "daniel",
        "google uk english male",
      ]);

      const bestFemale = preferredFemale ?? [...v].sort((a, b) => femaleScore(b) - femaleScore(a))[0];
      const bestMale = preferredMale ?? [...v].sort((a, b) => maleScore(b) - maleScore(a))[0];
      setVoiceOptions({
        female: bestFemale?.name ?? "",
        male: bestMale?.name ?? bestFemale?.name ?? "",
      });
    });
  }, []);

  // Load page text + preload neighbours
  useEffect(() => {
    if (!pdfDoc || !meta) return;
    let cancelled = false;
    setLoadingPage(true);
    setActiveWord(-1);
    (async () => {
      const content = await extractPageText(pdfDoc, page);
      if (cancelled) return;
      setPageContent(content);
      wordsRef.current = content.words;
      setLoadingPage(false);
      // Background preload next page
      if (page < meta.pages) {
        extractPageText(pdfDoc, page + 1).catch(() => {});
      }
      // Persist progress
      updateMeta(id, { lastPage: page });
      // If user requested next-page playback, kick it off
      if (readyToPlayNextRef.current) {
        readyToPlayNextRef.current = false;
        setTimeout(() => speakCurrent(content), 100);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pdfDoc, page, meta?.pages, id]);

  // Auto scroll active word
  useEffect(() => {
    if (activeWordElRef.current) {
      activeWordElRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [activeWord]);

  const speakCurrent = useCallback(
    (content?: PageContent | null, fromWord = 0) => {
      const c = content || pageContent;
      if (!c || !c.text.trim()) {
        // empty page → advance
        if (meta && page < meta.pages) {
          readyToPlayNextRef.current = true;
          setPage((p) => p + 1);
        } else {
          setIsPlaying(false);
        }
        return;
      }
      const synth = window.speechSynthesis;
      synth.cancel();

      const startChar = c.words[fromWord]?.start ?? 0;
      const text = c.text.slice(startChar);
      const u = new SpeechSynthesisUtterance(text);
      const selectedVoiceName = voiceOptions[voiceGender];
      const v = voices.find((x) => x.name === selectedVoiceName);
      if (v) u.voice = v;
      u.rate = rate;
      u.pitch = 1.05;

      u.onboundary = (ev) => {
        if (ev.name && ev.name !== "word") return;
        const absChar = startChar + ev.charIndex;
        // find word containing/just after this char
        const idx = wordsRef.current.findIndex(
          (w) => absChar >= w.start && absChar < w.end
        );
        if (idx >= 0) setActiveWord(idx);
      };
      u.onend = () => {
        setActiveWord(-1);
        if (meta && page < meta.pages) {
          readyToPlayNextRef.current = true;
          setPage((p) => p + 1);
        } else {
          setIsPlaying(false);
        }
      };
      u.onerror = () => setIsPlaying(false);

      utterRef.current = u;
      hasStartedPlaybackRef.current = true;
      setIsPlaying(true);
      synth.speak(u);
    },
    [pageContent, voices, voiceGender, voiceOptions, rate, meta, page]
  );

  // Apply speed/voice changes immediately from the current word.
  useEffect(() => {
    if (!hasStartedPlaybackRef.current) return;
    const synth = window.speechSynthesis;
    if (!isPlaying && !synth.paused) return;
    const fromWord = activeWord >= 0 ? activeWord : 0;
    speakCurrent(pageContent, fromWord);
  }, [voiceGender, voiceOptions, rate, isPlaying, activeWord, pageContent, speakCurrent]);

  const handlePlayPause = () => {
    const synth = window.speechSynthesis;
    if (isPlaying) {
      synth.pause();
      setIsPlaying(false);
    } else if (synth.paused && utterRef.current) {
      const fromWord = activeWord >= 0 ? activeWord : 0;
      speakCurrent(pageContent, fromWord);
    } else {
      const startWord = meta?.lastWord && page === meta.lastPage ? meta.lastWord : 0;
      speakCurrent(pageContent, startWord);
    }
  };

  // Save word progress periodically while playing
  useEffect(() => {
    if (activeWord >= 0) {
      updateMeta(id, { lastPage: page, lastWord: activeWord });
    }
  }, [activeWord, page, id]);

  const goToPage = (n: number) => {
    if (!meta) return;
    const target = Math.max(1, Math.min(meta.pages, n));
    window.speechSynthesis.cancel();
    setIsPlaying(false);
    setPage(target);
  };

  const toggleBookmark = async () => {
    if (!meta) return;
    const has = meta.bookmarks.includes(page);
    const next = has
      ? meta.bookmarks.filter((p) => p !== page)
      : [...meta.bookmarks, page].sort((a, b) => a - b);
    await updateMeta(id, { bookmarks: next });
    setMeta({ ...meta, bookmarks: next });
  };

  const runSearch = async () => {
    if (!pdfDoc || !meta || !searchQuery.trim()) return;
    setSearching(true);
    setSearchResults([]);
    const q = searchQuery.toLowerCase();
    const results: { page: number; preview: string }[] = [];
    for (let i = 1; i <= meta.pages; i++) {
      try {
        const c = await extractPageText(pdfDoc, i);
        const idx = c.text.toLowerCase().indexOf(q);
        if (idx >= 0) {
          const start = Math.max(0, idx - 30);
          const end = Math.min(c.text.length, idx + q.length + 30);
          results.push({ page: i, preview: "…" + c.text.slice(start, end) + "…" });
          if (results.length >= 50) break;
        }
      } catch {}
    }
    setSearchResults(results);
    setSearching(false);
  };

  const isBookmarked = meta?.bookmarks.includes(page) ?? false;

  const renderedText = useMemo(() => {
    if (!pageContent) return null;
    if (!pageContent.words.length) {
      return <p className="text-muted-foreground italic">No selectable text on this page.</p>;
    }
    const elements: React.ReactNode[] = [];
    let cursor = 0;
    pageContent.words.forEach((w, i) => {
      // gap (whitespace / newlines)
      const gap = pageContent.text.slice(cursor, w.start);
      if (gap) {
        elements.push(
          <span key={`g-${i}`} style={{ whiteSpace: "pre-wrap" }}>
            {gap}
          </span>
        );
      }
      const isActive = i === activeWord;
      elements.push(
        <span
          key={`w-${i}`}
          ref={isActive ? activeWordElRef : undefined}
          className={`tts-word${isActive ? " active" : ""}`}
        >
          {w.text}
        </span>
      );
      cursor = w.end;
    });
    const tail = pageContent.text.slice(cursor);
    if (tail) elements.push(<span key="tail" style={{ whiteSpace: "pre-wrap" }}>{tail}</span>);
    return elements;
  }, [pageContent, activeWord]);

  if (!meta) {
    return (
      <div className="min-h-screen grid place-items-center bg-background">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Top bar */}
      <header className="sticky top-0 z-20 bg-background/80 backdrop-blur border-b">
        <div className="max-w-2xl mx-auto px-4 h-14 flex items-center gap-2">
          <Button variant="ghost" size="icon" asChild>
            <Link to="/"><ArrowLeft className="h-5 w-5" /></Link>
          </Button>
          <div className="flex-1 min-w-0">
            <h1 className="text-sm font-medium truncate">{meta.name}</h1>
            <p className="text-xs text-muted-foreground">Page {page} of {meta.pages}</p>
          </div>
          <Button variant="ghost" size="icon" onClick={toggleBookmark}>
            {isBookmarked ? <BookmarkCheck className="h-5 w-5 text-primary" /> : <Bookmark className="h-5 w-5" />}
          </Button>
          <Sheet open={searchOpen} onOpenChange={setSearchOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon"><Search className="h-5 w-5" /></Button>
            </SheetTrigger>
            <SheetContent side="right" className="w-full sm:max-w-md">
              <SheetHeader>
                <SheetTitle>Search & bookmarks</SheetTitle>
              </SheetHeader>
              <div className="mt-4 space-y-4">
                <div className="flex gap-2">
                  <Input
                    placeholder="Search this PDF…"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && runSearch()}
                  />
                  <Button onClick={runSearch} disabled={searching}>
                    {searching ? <Loader2 className="h-4 w-4 animate-spin" /> : "Go"}
                  </Button>
                </div>
                {searchResults.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-xs text-muted-foreground">{searchResults.length} matches</p>
                    {searchResults.map((r) => (
                      <button
                        key={r.page}
                        className="w-full text-left p-3 rounded-lg hover:bg-muted transition"
                        onClick={() => { goToPage(r.page); setSearchOpen(false); }}
                      >
                        <div className="text-xs font-medium text-primary">Page {r.page}</div>
                        <div className="text-xs text-muted-foreground mt-1">{r.preview}</div>
                      </button>
                    ))}
                  </div>
                )}
                {meta.bookmarks.length > 0 && (
                  <div>
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">Bookmarks</p>
                    <div className="flex flex-wrap gap-2">
                      {meta.bookmarks.map((p) => (
                        <Button
                          key={p}
                          variant="outline"
                          size="sm"
                          onClick={() => { goToPage(p); setSearchOpen(false); }}
                        >
                          Page {p}
                        </Button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </SheetContent>
          </Sheet>
          <Sheet open={settingsOpen} onOpenChange={setSettingsOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon"><Settings2 className="h-5 w-5" /></Button>
            </SheetTrigger>
            <SheetContent side="right" className="w-full sm:max-w-sm">
              <SheetHeader><SheetTitle>Voice & speed</SheetTitle></SheetHeader>
              <div className="mt-6 space-y-6">
                <div>
                  <label className="text-sm font-medium block mb-2">Voice</label>
                  <Select
                    value={voiceGender}
                    onValueChange={(v) => setVoiceGender(v as "female" | "male")}
                  >
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="female">Female</SelectItem>
                      <SelectItem value="male">Male</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <div className="flex justify-between mb-2">
                    <label className="text-sm font-medium">Speed</label>
                    <span className="text-sm text-muted-foreground">{rate.toFixed(2)}×</span>
                  </div>
                  <Slider
                    value={[rate]}
                    min={0.5}
                    max={2}
                    step={0.05}
                    onValueChange={(v) => setRate(v[0])}
                  />
                </div>
              </div>
            </SheetContent>
          </Sheet>
        </div>
      </header>

      {/* Reader */}
      <main className="flex-1 max-w-2xl w-full mx-auto px-6 py-8 pb-40">
        {loadingPage || !pageContent ? (
          <div className="flex justify-center py-20">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <article className="font-display text-[1.15rem] leading-[1.85] text-foreground/90 selection:bg-highlight">
            {renderedText}
          </article>
        )}
      </main>

      {/* Player bar */}
      <footer className="fixed bottom-0 inset-x-0 bg-card/95 backdrop-blur border-t z-20 pb-[env(safe-area-inset-bottom)]">
        <div className="max-w-2xl mx-auto px-4 py-3">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-xs text-muted-foreground w-10 tabular-nums">{page}</span>
            <Slider
              value={[page]}
              min={1}
              max={meta.pages}
              step={1}
              onValueChange={(v) => goToPage(v[0])}
            />
            <span className="text-xs text-muted-foreground w-10 text-right tabular-nums">{meta.pages}</span>
          </div>
          <div className="flex items-center justify-center gap-2">
            <Button variant="ghost" size="icon" onClick={() => goToPage(page - 10)}>
              <SkipBack className="h-5 w-5" />
            </Button>
            <Button variant="ghost" size="icon" onClick={() => goToPage(page - 1)}>
              <ChevronLeft className="h-5 w-5" />
            </Button>
            <Button
              size="icon"
              className="h-14 w-14 rounded-full mx-2 shadow-lg"
              onClick={handlePlayPause}
              disabled={loadingPage}
            >
              {isPlaying ? <Pause className="h-6 w-6" /> : <Play className="h-6 w-6 ml-0.5" />}
            </Button>
            <Button variant="ghost" size="icon" onClick={() => goToPage(page + 1)}>
              <ChevronRight className="h-5 w-5" />
            </Button>
            <Button variant="ghost" size="icon" onClick={() => goToPage(page + 10)}>
              <SkipForward className="h-5 w-5" />
            </Button>
          </div>
        </div>
      </footer>
    </div>
  );
}
