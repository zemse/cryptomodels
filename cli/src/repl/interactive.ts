import * as readline from "readline";

export interface ReplOptions {
  modelName: string;
  onPrompt: (prompt: string) => Promise<void>;
  onQueueStatus?: () => void;
  onQuit: () => void;
}

export function startRepl(options: ReplOptions): void {
  const { modelName, onPrompt, onQueueStatus, onQuit } = options;

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const promptUser = () => {
    rl.question(`[${modelName}] > `, async (input) => {
      const trimmed = input.trim();

      if (trimmed === "/quit" || trimmed === "/exit") {
        rl.close();
        onQuit();
        return;
      }

      if (trimmed === "/queue") {
        if (onQueueStatus) {
          onQueueStatus();
        } else {
          console.log("Queue status not available.");
        }
        promptUser();
        return;
      }

      if (trimmed === "") {
        promptUser();
        return;
      }

      try {
        await onPrompt(trimmed);
      } catch (error) {
        console.error(
          `Error: ${error instanceof Error ? error.message : "Unknown error"}`
        );
      }

      promptUser();
    });
  };

  console.log(`\nConnected to model: ${modelName}`);
  console.log("Commands: /queue (check queue), /quit or /exit (leave)\n");

  promptUser();

  rl.on("close", () => {
    onQuit();
  });
}
