import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { listPdfs, savePdf, deletePdf, type PdfRecord } from "@/lib/pdf-storage";
import { getPageCount, loadPdfFromBlob } from "@/lib/pdf-engine";
import { Headphones, Plus, Trash2, BookOpen, FileText, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Toaster } from "@/components/ui/sonner";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Sonus — Your PDF library" },
      { name: "description", content: "Your saved PDFs, ready to listen anywhere." },
    ],
  }),
  component: Library,
  ssr: false,
});

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`${label} timed out after ${ms}ms`));
    }, ms);
    promise
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch((err) => {
        clearTimeout(timer);
        reject(err);
      });
  });
}

function getImportErrorMessage(err: unknown) {
  const msg = err instanceof Error ? err.message : String(err);
  const lower = msg.toLowerCase();
  if (
    lower.includes("quota") ||
    lower.includes("storage") ||
    lower.includes("not enough space")
  ) {
    return "Not enough storage space on this device to save the PDF.";
  }
  if (
    lower.includes("invalidstateerror") ||
    lower.includes("securityerror") ||
    lower.includes("aborterror")
  ) {
    return "Storage is blocked in this browser mode. On iPhone, disable Private mode and try again.";
  }
  if (lower.includes("timed out")) {
    return "This PDF is taking too long to process. Try a smaller file first.";
  }
  return "Couldn't import that PDF on this device.";
}

function Library() {
  const navigate = useNavigate();
  const [pdfs, setPdfs] = useState<PdfRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [pendingName, setPendingName] = useState("");
  const [importing, setImporting] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const refresh = async () => {
    setPdfs(await listPdfs());
    setLoading(false);
  };

  useEffect(() => {
    refresh();
  }, []);

  const onFileChosen = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    if (f.type !== "application/pdf" && !f.name.toLowerCase().endsWith(".pdf")) {
      toast.error("Please select a PDF file");
      return;
    }
    setPendingFile(f);
    setPendingName(f.name.replace(/\.pdf$/i, ""));
    e.target.value = "";
  };

  const confirmImport = async () => {
    if (!pendingFile) return;
    setImporting(true);
    try {
      const pages = await withTimeout(getPageCount(pendingFile), 30000, "PDF read");
      await withTimeout(
        savePdf(pendingFile, pendingName.trim() || pendingFile.name, pages),
        30000,
        "PDF save"
      );
      toast.success("Added to your library");
      setPendingFile(null);
      await refresh();
    } catch (err) {
      console.error(err);
      toast.error(getImportErrorMessage(err));
    } finally {
      setImporting(false);
    }
  };

  const handleDelete = async (id: string) => {
    await deletePdf(id);
    await refresh();
    toast("Removed");
  };

  return (
    <div className="min-h-screen bg-background pb-32">
      <Toaster position="top-center" />
      <header className="px-6 pt-12 pb-6 max-w-2xl mx-auto">
        <div className="flex items-center gap-3 mb-8">
          <div className="h-10 w-10 rounded-2xl bg-primary text-primary-foreground grid place-items-center shadow-sm">
            <Headphones className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-2xl font-display font-bold leading-none">Sonus</h1>
            <p className="text-xs text-muted-foreground mt-1">Listen to anything</p>
          </div>
        </div>

        <h2 className="text-4xl font-display font-bold tracking-tight">
          Your library
        </h2>
        <p className="text-muted-foreground mt-2 text-sm">
          {pdfs.length === 0
            ? "Add your first PDF to start listening."
            : `${pdfs.length} document${pdfs.length === 1 ? "" : "s"} saved on this device.`}
        </p>
      </header>

      <main className="px-6 max-w-2xl mx-auto space-y-3">
        {loading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : pdfs.length === 0 ? (
          <Card className="p-10 text-center border-dashed bg-card/50">
            <FileText className="h-10 w-10 mx-auto text-muted-foreground/60 mb-4" />
            <p className="text-sm text-muted-foreground">No PDFs yet</p>
            <Button
              className="mt-6"
              onClick={() => fileRef.current?.click()}
            >
              <Plus className="h-4 w-4 mr-2" />
              Add a PDF
            </Button>
          </Card>
        ) : (
          pdfs.map((p) => {
            const progress = p.pages > 0 ? Math.round((p.lastPage / p.pages) * 100) : 0;
            return (
              <Card
                key={p.id}
                className="p-4 flex items-center gap-4 hover:shadow-md transition-shadow cursor-pointer group"
                onClick={() => navigate({ to: "/read/$id", params: { id: p.id } })}
              >
                <div className="h-14 w-11 rounded-md bg-gradient-to-br from-accent to-primary/30 grid place-items-center shrink-0 shadow-sm">
                  <BookOpen className="h-5 w-5 text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="font-medium truncate">{p.name}</h3>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {p.pages} pages · {formatSize(p.size)}
                  </p>
                  <div className="mt-2 h-1 bg-muted rounded-full overflow-hidden">
                    <div
                      className="h-full bg-primary transition-all"
                      style={{ width: `${progress}%` }}
                    />
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="opacity-0 group-hover:opacity-100 transition-opacity"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDelete(p.id);
                  }}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </Card>
            );
          })
        )}
      </main>

      {/* Floating add button */}
      <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-10">
        <Button
          size="lg"
          className="rounded-full shadow-xl h-14 px-7 text-base"
          onClick={() => fileRef.current?.click()}
        >
          <Plus className="h-5 w-5 mr-2" />
          Add PDF
        </Button>
      </div>

      <input
        ref={fileRef}
        type="file"
        accept="application/pdf,.pdf"
        className="hidden"
        onChange={onFileChosen}
      />

      <Dialog open={!!pendingFile} onOpenChange={(o) => !o && setPendingFile(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Name this PDF</DialogTitle>
          </DialogHeader>
          <Input
            value={pendingName}
            onChange={(e) => setPendingName(e.target.value)}
            placeholder="A title you'll recognize"
            autoFocus
          />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setPendingFile(null)} disabled={importing}>
              Cancel
            </Button>
            <Button onClick={confirmImport} disabled={importing}>
              {importing ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Add to library
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
