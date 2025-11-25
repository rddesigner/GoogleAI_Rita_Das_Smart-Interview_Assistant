
import { Injectable } from '@angular/core';
import * as pdfjsLib from 'pdfjs-dist/build/pdf';

@Injectable({ providedIn: 'root' })
export class PdfParserService {
  constructor() {
    pdfjsLib.GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.mjs`;
  }

  async getText(file: File): Promise<string> {
    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument(arrayBuffer).promise;
    let fullText = '';
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const textContent = await page.getTextContent();
      const pageText = textContent.items.map(item => (item as any).str).join(' ');
      fullText += pageText + '\n\n';
    }
    return fullText;
  }
}
