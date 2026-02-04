export interface OllamaResponse {
  model: string;
  created_at: string;
  response: string;
  done: boolean;
  context?: number[];
  total_duration?: number;
  load_duration?: number;
  prompt_eval_count?: number; // Input tokens
  prompt_eval_duration?: number;
  eval_count?: number; // Output tokens
  eval_duration?: number;
}

export interface OllamaGenerateOptions {
  model: string;
  prompt: string;
  stream?: boolean;
  context?: number[];
}

/**
 * Stream responses from Ollama generate API
 */
export async function* streamOllamaGenerate(
  model: string,
  prompt: string,
  baseUrl: string = "http://127.0.0.1:11434",
  context?: number[]
): AsyncGenerator<OllamaResponse> {
  const response = await fetch(`${baseUrl}/api/generate`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      prompt,
      stream: true,
      context,
    }),
  });

  if (!response.ok) {
    throw new Error(`Ollama error: ${response.status} ${response.statusText}`);
  }

  if (!response.body) {
    throw new Error("No response body");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      if (line.trim()) {
        const data: OllamaResponse = JSON.parse(line);
        yield data;
      }
    }
  }

  // Process any remaining buffer
  if (buffer.trim()) {
    const data: OllamaResponse = JSON.parse(buffer);
    yield data;
  }
}

/**
 * Check if Ollama is running and model is available
 */
export async function checkOllamaModel(
  model: string,
  baseUrl: string = "http://127.0.0.1:11434"
): Promise<boolean> {
  try {
    const response = await fetch(`${baseUrl}/api/tags`);
    if (!response.ok) return false;

    const data = await response.json();
    const models = data.models ?? [];
    return models.some(
      (m: { name: string }) =>
        m.name === model || m.name === `${model}:latest`
    );
  } catch {
    return false;
  }
}
