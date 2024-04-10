import { SupabaseClient, createClient } from "@supabase/supabase-js";
import { Database } from "generated/db.js";
import { Document } from "langchain/document";
import { OpenAIEmbeddings } from "langchain/embeddings/openai";
import { SupabaseVectorStore } from "langchain/vectorstores/supabase";
import { ArxivPaperNote } from "notes/prompts.js";

export class SupabaseDatabase {
    vectorStore: SupabaseVectorStore;
    client: SupabaseClient<Database, "public", any>;

    constructor(
        client: SupabaseClient<Database, "public", any>,
        vectorStore: SupabaseVectorStore
    ) {
        this.client = client;
        this.vectorStore = vectorStore;
    }

    static async fromExistingIndex(): Promise<SupabaseDatabase> {
        const privateKey = process.env.SUPABASE_SERVICE_KEY;
        const url = process.env.SUPABASE_URL;
        if (!privateKey || !url) {
            throw new Error("Supabase credentials not found");
        }

        const supabase = createClient<Database>(url, privateKey);
        const vectorStore = await SupabaseVectorStore.fromExistingIndex(
            new OpenAIEmbeddings(),
            {
                client: supabase,
                tableName: "arxiv_embeddings",
                queryName: "match_documents",
            }
        );
        return new this(supabase, vectorStore);
    }

    static async fromDocuments(
        documents: Document[]
    ): Promise<SupabaseDatabase> {
        const privateKey = process.env.SUPABASE_SERVICE_KEY;
        const url = process.env.SUPABASE_URL;
        if (!privateKey || !url) {
            throw new Error("Supabase credentials not found");
        }

        const supabase = createClient<Database>(url, privateKey);
        const vectorStore = await SupabaseVectorStore.fromDocuments(
            documents,
            new OpenAIEmbeddings(),
            {
                client: supabase,
                tableName: "arxiv_embeddings",
                queryName: "match_documents",
            }
        );
        return new this(supabase, vectorStore);
    }

    async addPaper({
        name,
        arxivUrl,
        paper,
        notes,
    }: {
        name: string;
        arxivUrl: string;
        paper: string;
        notes: ArxivPaperNote[];
    }): Promise<void> {
        const { data, error } = await this.client
            .from("arxiv_papers")
            .insert([
                {
                    name,
                    arxiv_url: arxivUrl,
                    paper,
                    notes,
                },
            ])
            .select();
        if (error) {
            throw error;
        }
        console.log(data);
    }

    async getPaper(
        arxivUrl: string
    ): Promise<Database["public"]["Tables"]["arxiv_papers"]["Row"]> {
        const { data, error } = await this.client
            .from("arxiv_papers")
            .select()
            .eq("arxiv_url", arxivUrl);
        if (error) {
            throw error;
        }
        return data[0];
    }

    async saveQa(
        question: string,
        answer: string,
        context: string,
        followupQuestions: string[]
    ) {
        const { data, error } = await this.client
            .from("arxiv_question_answering")
            .insert([
                {
                    question,
                    answer,
                    context,
                    followup_questions: followupQuestions,
                },
            ])
            .select();
        if (error) {
            throw error;
        }
        console.log(data);
    }
}
