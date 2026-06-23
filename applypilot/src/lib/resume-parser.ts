/**
 * Resume parsing: PDF (pdfjs-dist) and DOCX (mammoth) -> plain text.
 *
 * Runs entirely in the extension (the dashboard page). Only the extracted text
 * is later sent to Claude — the raw file never leaves the browser except when
 * Indeed itself requests it for upload.
 *
 * pdfjs needs a worker; we point it at the worker bundled by Vite. See the
 * import below — `?url` returns the asset URL so the worker loads correctly
 * inside the extension origin.
 */

import mammoth from 'mammoth';
import * as pdfjsLib from 'pdfjs-dist';
// Vite resolves this to a URL string for the bundled worker file.
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

export interface ParsedResume {
  text: string;
  fileName: string;
  mimeType: string;
  /** base64 data URL of the original file (for re-uploading to Indeed). */
  dataUrl: string;
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

async function parsePdf(buffer: ArrayBuffer): Promise<string> {
  const doc = await pdfjsLib.getDocument({ data: buffer }).promise;
  const parts: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    const strings = content.items
      .map((it) => ('str' in it ? (it as { str: string }).str : ''))
      .filter(Boolean);
    parts.push(strings.join(' '));
  }
  return parts.join('\n\n').trim();
}

async function parseDocx(buffer: ArrayBuffer): Promise<string> {
  const result = await mammoth.extractRawText({ arrayBuffer: buffer });
  return result.value.trim();
}

/** Parse a user-selected resume File into plain text + a re-uploadable data URL. */
export async function parseResume(file: File): Promise<ParsedResume> {
  const buffer = await file.arrayBuffer();
  const name = file.name.toLowerCase();
  let text: string;

  if (name.endsWith('.pdf') || file.type === 'application/pdf') {
    text = await parsePdf(buffer);
  } else if (
    name.endsWith('.docx') ||
    file.type ===
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ) {
    text = await parseDocx(buffer);
  } else if (name.endsWith('.doc')) {
    throw new Error(
      'Legacy .doc files are not supported — please export as PDF or .docx.',
    );
  } else {
    throw new Error('Unsupported file type. Upload a PDF or DOCX resume.');
  }

  if (!text || text.length < 30) {
    throw new Error(
      'Could not extract text from this file. If it is a scanned/image PDF, ' +
        'try a text-based PDF or DOCX.',
    );
  }

  const dataUrl = await fileToDataUrl(file);
  return {
    text,
    fileName: file.name,
    mimeType: file.type || (name.endsWith('.pdf') ? 'application/pdf' : ''),
    dataUrl,
  };
}
