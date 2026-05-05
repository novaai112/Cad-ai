import { NextRequest } from "next/server"

// ─── SolidWorks AI System Prompt ────────────────────────────────────────────
const SOLIDWORKS_SYSTEM_PROMPT = `You are SolidWorks AI — an advanced CAD engineering assistant specializing exclusively in SolidWorks 3D modeling and analysis. You have deep expertise in:

## Your Core Capabilities:
1. **SolidWorks Model Creation**: Generate complete, executable Python scripts using the SolidWorks COM API (win32com.client) to create any 3D model from text prompts or image analysis.
2. **Error Auto-Fixing**: If a SolidWorks script has errors, automatically diagnose and provide corrected code — always produce a working solution.
3. **Image to CAD**: Analyze uploaded images and generate SolidWorks scripts to recreate the geometry.
4. **CAD Explanation**: Explain SolidWorks features, operations, sketches, mates, assemblies, and FEA analysis.
5. **Auto-Launch SolidWorks**: Scripts always check if SolidWorks is running and open it if needed.

## SolidWorks Script Rules (CRITICAL — always follow these):
- Always wrap script in a function \`create_model()\` and call it
- Always use \`win32com.client.Dispatch("SldWorks.Application")\` to connect
- Always set \`swApp.Visible = True\` to make SolidWorks visible
- Always create a new Part document with \`swApp.NewDocument()\` or use the template path
- Always use SI units (meters) unless user specifies otherwise
- Always include error handling with \`try/except\`
- Always add \`swApp.ActiveDoc.Save3(1, 0, 0)\` at the end to save
- For sketches: SelectSketchEntities → sketch constraints → ExtrudeSketch
- For features: always use correct parameter counts for SolidWorks COM API
- Comments in code must explain each step clearly

## Python Script Template:
\`\`\`python
import win32com.client
import pythoncom
import time
import subprocess
import os

def create_model():
    pythoncom.CoInitialize()
    
    # Connect to SolidWorks or launch it
    try:
        swApp = win32com.client.GetActiveObject("SldWorks.Application")
        print("Connected to running SolidWorks instance")
    except:
        print("SolidWorks not running — launching...")
        subprocess.Popen(r"C:\\Program Files\\SOLIDWORKS Corp\\SOLIDWORKS\\SLDWORKS.EXE")
        time.sleep(8)
        swApp = win32com.client.Dispatch("SldWorks.Application")
    
    swApp.Visible = True
    
    # Create new part document
    template = swApp.GetUserPreferenceStringValue(9)  # swDefaultTemplatePart
    swDoc = swApp.NewDocument(template, 0, 0, 0)
    swModel = swDoc
    swModel.SketchManager.InsertSketch(True)
    
    # TODO: Add geometry here
    
    swModel.ClearSelection2(True)
    errors = 0
    warnings = 0
    swModel.Save3(1, errors, warnings)
    print("Model created successfully!")
    
    pythoncom.CoUninitialize()

create_model()
\`\`\`

## Response Format:
- **For model creation requests**: Always provide a complete, runnable Python script + brief explanation
- **For questions/analysis**: Provide clear, professional engineering explanations
- **For errors**: Diagnose the issue and provide fixed code immediately
- **For image analysis**: Describe the geometry and then generate a SolidWorks script
- Keep explanations concise and engineering-focused
- Use markdown with code blocks for all scripts

## Important Behavior:
- NEVER say "I cannot create SolidWorks models" — always generate the script
- Always fix errors automatically without asking
- If SolidWorks path differs, use wildcard search in C:\\Program Files for SLDWORKS.EXE
- Always create geometrically correct and manufacturable models`

// ─── Helper: SSE stream from OpenAI-compatible API ───────────────────────────
function makeOpenAIStream(responseBody: ReadableStream): ReadableStream {
  const encoder = new TextEncoder()
  return new ReadableStream({
    async start(controller) {
      const reader = responseBody.getReader()
      const decoder = new TextDecoder()
      let buffer = ""

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split("\n")
        buffer = lines.pop() || ""

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            const data = line.slice(6).trim()
            if (data === "[DONE]") continue
            try {
              const json = JSON.parse(data)
              const text = json?.choices?.[0]?.delta?.content
              if (text) controller.enqueue(encoder.encode(text))
            } catch {}
          }
        }
      }
      controller.close()
    },
  })
}

// ─── Gemini (Google AI) ───────────────────────────────────────────────────────
async function callGemini(messages: any[], imageData?: string): Promise<ReadableStream> {
  // Variable name: Gemini_API_KEY (underscore)
  const apiKey = process.env["Gemini_API_KEY"]
  if (!apiKey) throw new Error("Gemini_API_KEY not set in .env.local")

  // Build Gemini contents array
  const contents: any[] = []
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i]
    const isLast = i === messages.length - 1

    if (msg.role === "user") {
      const parts: any[] = []
      if (isLast && imageData && imageData.startsWith("data:image/")) {
        const [header, base64Data] = imageData.split(",")
        const mimeType = header.match(/data:([^;]+)/)?.[1] || "image/jpeg"
        parts.push({ inlineData: { mimeType, data: base64Data } })
      }
      parts.push({ text: msg.content || "Describe this image for SolidWorks modeling" })
      contents.push({ role: "user", parts })
    } else {
      contents.push({ role: "model", parts: [{ text: msg.content }] })
    }
  }

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:streamGenerateContent?alt=sse&key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SOLIDWORKS_SYSTEM_PROMPT }] },
        contents,
        generationConfig: { temperature: 0.7, maxOutputTokens: 8192 },
      }),
    }
  )

  if (!response.ok) {
    const err = await response.text()
    throw new Error(`Gemini API error ${response.status}: ${err}`)
  }

  // Parse Gemini SSE → plain text stream
  const encoder = new TextEncoder()
  return new ReadableStream({
    async start(controller) {
      const reader = response.body!.getReader()
      const decoder = new TextDecoder()
      let buffer = ""

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split("\n")
        buffer = lines.pop() || ""

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            const data = line.slice(6).trim()
            if (data === "[DONE]") continue
            try {
              const json = JSON.parse(data)
              const text = json?.candidates?.[0]?.content?.parts?.[0]?.text
              if (text) controller.enqueue(encoder.encode(text))
            } catch {}
          }
        }
      }
      controller.close()
    },
  })
}

// ─── OpenRouter (GPT-4o and Claude) ──────────────────────────────────────────
// OpenRouter key (sk-or-v1-...) — routes to any model via OpenAI-compatible API
async function callOpenRouter(
  messages: any[],
  modelId: string,
  imageData?: string
): Promise<ReadableStream> {
  const apiKey = process.env["API_KEY"]
  if (!apiKey) throw new Error("API_KEY (OpenRouter) not set in .env.local")

  const orMessages: any[] = [{ role: "system", content: SOLIDWORKS_SYSTEM_PROMPT }]

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i]
    const isLast = i === messages.length - 1

    // Add image inline for the last user message
    if (msg.role === "user" && isLast && imageData && imageData.startsWith("data:image/")) {
      orMessages.push({
        role: "user",
        content: [
          { type: "image_url", image_url: { url: imageData, detail: "high" } },
          { type: "text", text: msg.content || "Analyze this image for SolidWorks modeling" },
        ],
      })
    } else {
      orMessages.push({ role: msg.role, content: msg.content })
    }
  }

  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
      "HTTP-Referer": "https://solidworks-ai.app",
      "X-Title": "SolidWorks AI",
    },
    body: JSON.stringify({
      model: modelId,   // e.g. "openai/gpt-4o" or "anthropic/claude-sonnet-4"
      messages: orMessages,
      stream: true,
      max_tokens: 1024,
      temperature: 0.7,
    }),
  })

  if (!response.ok) {
    const err = await response.text()
    throw new Error(`OpenRouter API error ${response.status}: ${err}`)
  }

  return makeOpenAIStream(response.body!)
}


// ─── Main POST Handler ────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  try {
    const { messages, model } = await req.json()

    if (!messages || !Array.isArray(messages)) {
      return new Response(JSON.stringify({ error: "Invalid request: messages array required" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      })
    }

    if (messages.length === 0) {
      return new Response(JSON.stringify({ error: "No messages provided" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      })
    }

    // Extract image from last user message
    const lastMsg = messages[messages.length - 1]
    const imageData = lastMsg?.role === "user" ? lastMsg?.imageData : undefined

    // Clean messages — strip imageData from history, keep only text
    const cleanMessages = messages
      .map((m: any) => ({
        role: m.role,
        content: m.content || (m.imageData ? "[Image provided for SolidWorks modeling]" : ""),
      }))
      .filter((m: any) => m.content.trim().length > 0)

    const selectedModel: string = model || "google/gemini-2.0-flash-001"

    let stream: ReadableStream

    if (selectedModel.startsWith("google/") || selectedModel.includes("gemini")) {
      // ── Gemini (direct Google API, uses Gemini_API_KEY) ──
      try {
        stream = await callGemini(cleanMessages, imageData)
      } catch (error: any) {
        if (error.message && error.message.includes("429")) {
          console.log("Gemini quota exceeded, falling back to GPT-4o via OpenRouter...")
          stream = await callOpenRouter(cleanMessages, "openai/gpt-4o", imageData)
        } else {
          throw error
        }
      }
    } else {
      // ── Everything else → OpenRouter (GPT-4o, Claude, etc.) ──
      // Map internal model IDs to OpenRouter model IDs
      const orModelMap: Record<string, string> = {
        "openai/gpt-4o": "openai/gpt-4o",
        "anthropic/claude-sonnet-4": "anthropic/claude-sonnet-4-5",
      }
      const orModel = orModelMap[selectedModel] ?? selectedModel
      stream = await callOpenRouter(cleanMessages, orModel, imageData)
    }

    return new Response(stream, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "no-cache",
      },
    })
  } catch (error) {
    console.error("SolidWorks AI error:", error)
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : "An unexpected error occurred",
      }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    )
  }
}
