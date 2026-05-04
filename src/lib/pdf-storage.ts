import { openDB, type IDBPDatabase } from "idb";

export interface PdfRecord {
  id: string;
  name: string;
  size: number;
  pages: number;
  addedAt: number;
  lastPage: number;
  lastWord: number;
  bookmarks: number[];
}

interface PdfBlob {
  id: string;
  blob: Blob;
}

const DB_NAME = "sonus-pdfs";
const DB_VERSION = 1;

let dbPromise: Promise<IDBPDatabase> | null = null;

function getDb() {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        db.createObjectStore("meta", { keyPath: "id" });
        db.createObjectStore("blobs", { keyPath: "id" });
      },
    });
  }
  return dbPromise;
}

export async function listPdfs(): Promise<PdfRecord[]> {
  const db = await getDb();
  const all = (await db.getAll("meta")) as PdfRecord[];
  return all.sort((a, b) => b.addedAt - a.addedAt);
}

export async function getPdfMeta(id: string): Promise<PdfRecord | undefined> {
  const db = await getDb();
  return (await db.get("meta", id)) as PdfRecord | undefined;
}

export async function getPdfBlob(id: string): Promise<Blob | undefined> {
  const db = await getDb();
  const rec = (await db.get("blobs", id)) as PdfBlob | undefined;
  return rec?.blob;
}

export async function savePdf(file: File, name: string, pages: number): Promise<PdfRecord> {
  const db = await getDb();
  const id = crypto.randomUUID();
  const record: PdfRecord = {
    id,
    name,
    size: file.size,
    pages,
    addedAt: Date.now(),
    lastPage: 1,
    lastWord: 0,
    bookmarks: [],
  };
  await db.put("meta", record);
  await db.put("blobs", { id, blob: file } as PdfBlob);
  return record;
}

export async function updateMeta(id: string, patch: Partial<PdfRecord>) {
  const db = await getDb();
  const existing = (await db.get("meta", id)) as PdfRecord | undefined;
  if (!existing) return;
  await db.put("meta", { ...existing, ...patch });
}

export async function deletePdf(id: string) {
  const db = await getDb();
  await db.delete("meta", id);
  await db.delete("blobs", id);
}
