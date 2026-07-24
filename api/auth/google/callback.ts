import type { VercelRequest, VercelResponse } from "@vercel/node";
import { exchangeCodeForTokens, verifyState } from "../../_lib/googleFit.js";
import { saveGoogleTokens } from "../../_lib/pet-logic.js";

function htmlPage(title: string, body: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title></head>
<body style="font-family:system-ui,sans-serif;text-align:center;padding-top:60px;color:#222;">${body}</body></html>`;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Content-Type", "text/html; charset=utf-8");

  const code = req.query.code as string | undefined;
  const state = req.query.state as string | undefined;
  if (!code || !state) {
    return res.status(400).send(htmlPage("WalkPet", "<h2>Некорректная ссылка</h2>"));
  }

  const userId = verifyState(state);
  if (userId === null) {
    return res.status(400).send(htmlPage("WalkPet", "<h2>Ссылка устарела</h2><p>Попробуй подключить Google Fit заново из приложения.</p>"));
  }

  try {
    const tokens = await exchangeCodeForTokens(code);
    if (!tokens.refreshToken) throw new Error("no refresh token returned by Google");
    await saveGoogleTokens(userId, tokens.accessToken, tokens.refreshToken, tokens.expiresAt);
  } catch (err) {
    return res
      .status(500)
      .send(htmlPage("WalkPet", `<h2>Не удалось подключить Google Fit</h2><p>${err instanceof Error ? err.message : "unknown error"}</p>`));
  }

  return res
    .status(200)
    .send(
      htmlPage(
        "WalkPet",
        "<h2>Google Fit подключён ✅</h2><p>Можешь вернуться в Telegram — шаги начнут подтягиваться автоматически.</p>",
      ),
    );
}
