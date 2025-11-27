// src/App.jsx
import React, { useEffect, useRef, useState } from "react";
import { verifyWebsiteToken, sendChatMessage } from "./api";

function ChatBubble({ who, text }) {
  return (
    <div className={`bubble ${who === "user" ? "user" : "ai"}`}>
      <div className="bubble-text">{text}</div>
    </div>
  );
}

export default function App() {
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState("guest");
  const [student, setStudent] = useState(null);

  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const sessionId = useRef(`s_${Math.random().toString(36).slice(2, 9)}`);

  // --- Read token from URL or from parent via postMessage ---
  useEffect(() => {
    console.log("🟢 Chat widget mounted, waiting for token...");

    const params = new URLSearchParams(window.location.search);
    const urlToken = params.get("token");

    // 1️⃣ If token in URL → use it
    if (urlToken) {
      console.log("🔹 Token from URL:", urlToken);
      window.__WEBSITE_TOKEN = urlToken;

      verifyWebsiteToken(urlToken).then((data) => {
        console.log("🔹 Auth response (URL token):", data);
        setMode(data.mode || "guest");
        if (data.mode === "student") setStudent(data.student);
        setLoading(false);
      });
      return;
    }

    // 2️⃣ Else wait for parent → postMessage
    const onMessage = (ev) => {
      console.log("📨 Widget: message received in iframe:", ev.origin, ev.data);

      const data = ev.data;
      if (!data || typeof data !== "object") return;

      // ✅ New protocol: { type: "WEBSITE_TOKEN", websiteToken: "..." }
      if (data.type !== "WEBSITE_TOKEN") return;

      const wToken = data.websiteToken;
      console.log("🔸 Widget: websiteToken from postMessage:", wToken);

      if (!wToken) {
        console.warn("⚠️ Empty websiteToken received, ignoring");
        return;
      }

      window.__WEBSITE_TOKEN = wToken;

      verifyWebsiteToken(wToken).then((res) => {
        console.log("🔸 Auth response (postMessage):", res);
        setMode(res.mode || "guest");
        if (res.mode === "student") setStudent(res.student);
        setLoading(false);
      });
    };

    window.addEventListener("message", onMessage);

    // 🔁 Handshake: Parent se token maango
    try {
      console.log("💬 Widget: sending REQUEST_WEBSITE_TOKEN to parent");
      window.parent?.postMessage({ type: "REQUEST_WEBSITE_TOKEN" }, "*");
    } catch (err) {
      console.error("❌ Widget: failed to post REQUEST_WEBSITE_TOKEN", err);
    }

    // Guest fallback if no token comes at all
    const fallback = setTimeout(() => {
      console.log("⏱️ No token received → Guest mode fallback");
      setLoading(false);
      setMode("guest");
    }, 2000);

    return () => {
      window.removeEventListener("message", onMessage);
      clearTimeout(fallback);
    };
  }, []);

  // Welcome message
  useEffect(() => {
    setMessages((prev) => [
      ...prev,
      { who: "ai", text: "Hi! Ask me anything — I'm here to help." },
    ]);
  }, []);

  async function sendMessage() {
    if (!input.trim()) return;
    const text = input.trim();

    setMessages((prev) => [...prev, { who: "user", text }]);
    setInput("");
    setSending(true);

    const token = window.__WEBSITE_TOKEN || null;
    console.log("💬 Sending chat with token:", token);

    try {
      const reply = await sendChatMessage(sessionId.current, text, token);
      setMessages((prev) => [...prev, { who: "ai", text: reply }]);
    } catch (err) {
      console.error("❌ sendChatMessage failed:", err);
      setMessages((prev) => [
        ...prev,
        {
          who: "ai",
          text: "Sorry, there was an error while sending your message.",
        },
      ]);
    } finally {
      setSending(false);
    }
  }

  if (loading) return <div className="center">Loading…</div>;

  return (
    <div className="widget">
      <header className="header">
        <div className="title">Campus Assistant</div>
        <div className="mode">
          {mode === "student"
            ? `Student: ${student?.name ?? "Unknown"}`
            : "Guest"}
        </div>
      </header>

      <div className="messages">
        {messages.map((m, i) => (
          <ChatBubble key={i} who={m.who} text={m.text} />
        ))}
      </div>

      <div className="composer">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") sendMessage();
          }}
          placeholder="Type here…"
          disabled={sending}
        />
        <button onClick={sendMessage} disabled={sending || !input.trim()}>
          {sending ? "..." : "Send"}
        </button>
      </div>
    </div>
  );
}
