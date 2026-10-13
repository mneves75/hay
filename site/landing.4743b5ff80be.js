"use strict";

for (const button of document.querySelectorAll("button[data-copy-target]")) {
  const command = document.getElementById(button.dataset.copyTarget);
  const feedback = document.getElementById(button.dataset.feedback);
  if (!command || !feedback) continue;
  button.hidden = false;
  button.addEventListener("click", async () => {
    button.disabled = true;
    try {
      if (!navigator.clipboard?.writeText) throw new Error("Clipboard unavailable");
      await navigator.clipboard.writeText(command.textContent.trim());
      feedback.textContent = "Copied. Paste it into your terminal.";
    } catch {
      feedback.textContent = "Copy failed. Select the command above and copy it manually.";
    } finally {
      button.disabled = false;
    }
  });
}
