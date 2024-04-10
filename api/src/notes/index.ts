import axios from "axios";
import { PDFDocument } from "pdf-lib";
import { Document } from "langchain/document";
import { writeFile, unlink, readFile } from "fs/promises";
import { UnstructuredLoader } from "langchain/document_loaders/fs/unstructured";
import { formatDocumentsAsString } from "langchain/util/document";
import { ChatOpenAI } from "langchain/chat_models/openai";
import {
    ArxivPaperNote,
    NOTES_TOOL_SCHEMA,
    NOTE_PROMPT,
    outputParser,
} from "./prompts.js";
import "dotenv/config";
import { SupabaseDatabase } from "database.js";

const unstructuredApiKey = process.env.UNSTRUCTURED_API_KEY;
const openaiApiKey = process.env.OPENAI_API_KEY;

async function loadPdfFromUrl(url: string): Promise<Buffer> {
    const response = await axios.get(url, {
        responseType: "arraybuffer",
    });
    return response.data;
}

async function convertPdfToDocuments(pdf: Buffer): Promise<Document[]> {
    if (!unstructuredApiKey) {
        throw new Error("UNSTRUCTURED_API_KEY not set");
    }
    const randomFilename = Math.random().toString(36).substring(7);
    const fileName = `./pdfs/${randomFilename}.pdf`;
    await writeFile(fileName, pdf, "binary");
    const loader = new UnstructuredLoader(fileName, {
        apiKey: process.env.UNSTRUCTURED_API_KEY,
        strategy: "hi_res",
    });
    const documents = await loader.load();
    await unlink(fileName);
    return documents;
}

async function generateNotes(
    documents: Document[]
): Promise<Array<ArxivPaperNote>> {
    const documentsAsString = formatDocumentsAsString(documents);
    const model = new ChatOpenAI({
        modelName: "gpt-4-1106-preview",
        temperature: 0.0,
        openAIApiKey: openaiApiKey,
    });
    const modelWithTool = model.bind({
        tools: [NOTES_TOOL_SCHEMA],
    });
    const chain = NOTE_PROMPT.pipe(modelWithTool).pipe(outputParser);
    const response = await chain.invoke({
        paper: documentsAsString,
    });
    return response;
}

async function deletePages(
    pdf: Buffer,
    pagesToDelete: number[]
): Promise<Buffer> {
    const pdfDoc = await PDFDocument.load(pdf);
    let offset = 1;
    for (const pageNumber of pagesToDelete) {
        pdfDoc.removePage(pageNumber - offset);
        offset++;
    }
    const pdfBytes = await pdfDoc.save();
    return Buffer.from(pdfBytes);
}

export async function takeNotes({
    paperUrl,
    name,
    pagesToDelete,
}: {
    paperUrl: string;
    name: string;
    pagesToDelete: number[];
}) {
    if (!paperUrl.endsWith(".pdf")) {
        throw new Error("URL must be a PDF");
    }
    let pdfAsBuffer = await loadPdfFromUrl(paperUrl);
    if (pagesToDelete.length > 0) {
        // remove pages
        pdfAsBuffer = await deletePages(pdfAsBuffer, pagesToDelete);
    }
    const documents = await convertPdfToDocuments(pdfAsBuffer);
    // const doc = await readFile("pdf/documents.json", "utf-8");
    // const documents = JSON.parse(doc);
    const notes = await generateNotes(documents);

    const new_documents: Document[] = documents.map((doc) => {
        return {
            ...doc,
            metadata: {
                ...doc.metadata,
                url: paperUrl,
            },
        };
    });

    const database = await SupabaseDatabase.fromDocuments(new_documents);
    await Promise.all([
        await database.addPaper({
            name: "arxiv",
            arxivUrl: paperUrl,
            paper: formatDocumentsAsString(new_documents),
            notes,
        }),
        await database.vectorStore.addDocuments(new_documents),
    ]);

    console.log(notes);
    console.log(`Found ${notes.length} notes`);
}

// takeNotes({
//     paperUrl: "https://arxiv.org/pdf/2404.04902.pdf",
//     name: "arxiv",
//     pagesToDelete: [8],
// });
