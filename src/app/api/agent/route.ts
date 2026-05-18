import { NextRequest } from "next/server";
import ZAI from "z-ai-web-dev-sdk";

const SYSTEM_PROMPT = `Kamu adalah asisten **Prcuisa Labs** — lab riset & pengembangan teknologi AI dari Indonesia.

## Tentang Prcuisa Labs
- **Website**: https://prcuisa.com
- **Email**: prcuisa@gmail.com
- **Lokasi**: Indonesia
- **Tagline**: "AI · Automation · Smart Systems for Modern Business"

## Layanan Prcuisa Labs
1. **AI Automation** — Workflow otomatis berbasis AI, chatbot WhatsApp, asisten AI untuk bisnis
2. **Custom Software Development** — Web app, dashboard, sistem bisnis custom
3. **Smart Technology Installation** — Solusi IoT, teknologi pintar untuk kantor & rumah
4. **CRM Systems** — Manajemen hubungan pelanggan
5. **Digital Business Systems** — Transformasi digital end-to-end
6. **Custom PC Building** — Rakit PC custom
7. **QR Code Tools** — Generator QR code (termasuk integrasi Bank Mandiri Livin')

## Aturan
1. Gunakan **Bahasa Indonesia** yang santai, jelas, dan membantu.
2. Jawab berdasarkan data hasil pencarian yang diberikan di bawah. Jangan mengarang.
3. Jika data tidak cukup, katakan secara jujur.
4. Untuk pertanyaan tentang Prcuisa Labs, arahkan ke prcuisa.com atau prcuisa@gmail.com.
5. Format respons pakai markdown yang rapi.`;

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { messages } = body as { messages: Array<{ role: string; content: string }> };

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return new Response(JSON.stringify({ error: "Messages are required" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const encoder = new TextEncoder();

    const stream = new ReadableStream({
      async start(controller) {
        const send = (event: Record<string, unknown>) => {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        };

        try {
          const zai = await ZAI.create();
          const lastMessage = messages[messages.length - 1]?.content || "";

          // ── STEP 1: Web search ──
          send({ type: "status", content: "Mencari informasi..." });

          let searchContext = "";
          try {
            const results = await zai.functions.invoke("web_search", {
              query: lastMessage,
              num: 5,
            });

            if (results && results.length > 0) {
              send({ type: "tool_call", id: "search_1", tool: "web_search", args: { query: lastMessage } });

              const formatted = results
                .map(
                  (r: { name: string; url: string; snippet: string; date?: string }, i: number) =>
                    `${i + 1}. ${r.name}\n   URL: ${r.url}\n   ${r.snippet}${r.date ? ` (${r.date})` : ""}`
                )
                .join("\n\n");

              searchContext = `Hasil pencarian:\n\n${formatted}`;
              send({ type: "tool_result", id: "search_1", tool: "web_search", content: `Ditemukan ${results.length} hasil` });
            }
          } catch {
            // Search failed — continue without context
          }

          // ── STEP 2: LLM answer ──
          send({ type: "status", content: "Menyusun jawaban..." });

          const systemContent = searchContext
            ? `${SYSTEM_PROMPT}\n\n## Data Referensi (hasil pencarian)\n${searchContext}\n\nJawab pertanyaan user berdasarkan data di atas. Jika data tidak relevan, jawab dari pengetahuan kamu sendiri tentang Prcuisa Labs.`
            : SYSTEM_PROMPT;

          const conversation = [
            { role: "system" as const, content: systemContent },
            ...messages.map((m) => ({
              role: m.role as "user" | "assistant",
              content: m.content,
            })),
          ];

          const completion = await zai.chat.completions.create({
            messages: conversation,
          });

          const answer = completion.choices?.[0]?.message?.content || "Maaf, saya tidak bisa memberikan respons saat ini. Silakan coba lagi.";

          send({ type: "text", content: answer });
          send({ type: "done" });
        } catch (error: unknown) {
          const err = error as Error;
          send({ type: "error", content: err.message || "Terjadi kesalahan" });
          send({ type: "done" });
        } finally {
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  } catch (error: unknown) {
    const err = error as Error;
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}
