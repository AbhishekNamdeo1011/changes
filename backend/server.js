// widget-backend/server.js
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import jwt from "jsonwebtoken";
import { GoogleGenerativeAI } from "@google/generative-ai";

dotenv.config();
const app = express();

// ⚠️ IMPORTANT:
// Ye secret **auth-backend ke JWT_SECRET ke equal** hona chahiye
const PORT = process.env.PORT || 5000;
const WEBSITE_JWT_SECRET =
  process.env.WEBSITE_JWT_SECRET || process.env.JWT_SECRET || "CHANGE_ME";

app.use(
  cors({
    origin: "http://localhost:5173", // widget frontend origin
    credentials: true,
  })
);

app.use(express.json());

// ---- Simple sessions ---- //
const sessions = {}; // sessionId -> { messages: [...] }

// ---- Verify token (REAL JWT) ---- //
function verifyWebsiteToken(token) {
  console.log("🔑 verifyWebsiteToken called with:", token);

  if (!token) return null;

  // Agar galti se "Bearer xxx" aa jaye to clean kar do
  if (typeof token === "string" && token.startsWith("Bearer ")) {
    token = token.slice(7);
    console.log("🔑 Stripped Bearer prefix:", token);
  }

  try {
    const decoded = jwt.verify(token, WEBSITE_JWT_SECRET);
    console.log("✅ JWT verified (raw decoded):", decoded);

    // Auth backend ka payload: { user: { id, name, email, collegeId }, iat, exp }
    const user = decoded.user || decoded;
    console.log("✅ Extracted user from token:", user);
    return user;
  } catch (e) {
    console.log("❌ JWT verify failed:", e.message);
    return null;
  }
}

// ---- Gemini Model ---- //
async function callModel_Gemini(conversation) {
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });

  const prompt = conversation
    .map((m) => `${m.role.toUpperCase()}: ${m.content}`)
    .join("\n");

  const result = await model.generateContent(prompt);
  return result.response.text();
}

// ---- Auth endpoint for widget ---- //
app.post("/auth/website-login", (req, res) => {
  const { websiteToken } = req.body;
  console.log("🔐 /auth/website-login called");
  console.log("➡️ websiteToken from frontend:", websiteToken);

  const user = verifyWebsiteToken(websiteToken);
  console.log("👤 user after verify:", user);

  if (!user) {
    console.log("❌ No valid user → guest");
    return res.json({ mode: "guest" });
  }

  return res.json({
    mode: "student",
    student: {
      id: user.id || "unknown",
      name: user.name || "Student",
      email: user.email || "",
    },
  });
});

// ---- Chat ---- //
app.post("/api/chat", async (req, res) => {
  try {
    const { sessionId, message, websiteToken } = req.body;
    console.log("💬 /api/chat called →", { sessionId, message, websiteToken });

    if (!sessionId) return res.json({ error: "No sessionId provided" });

    const user = verifyWebsiteToken(websiteToken);

    if (!sessions[sessionId]) {
      sessions[sessionId] = {
        messages: [
          { role: "system", content: "You are a friendly student assistant." },
        ],
      };
      if (user) {
        sessions[sessionId].messages.push({
          role: "system",
          content: `Student: ${user.name} (${user.email})`,
        });
      }
    }

    sessions[sessionId].messages.push({ role: "user", content: message });

    const reply = await callModel_Gemini(sessions[sessionId].messages);

    sessions[sessionId].messages.push({ role: "assistant", content: reply });

    return res.json({ reply });
  } catch (err) {
    console.error("❌ /api/chat error:", err);
    return res.status(500).json({ reply: "Something went wrong." });
  }
});

app.listen(PORT, () => console.log("Server running on", PORT));
