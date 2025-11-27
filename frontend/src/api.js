// widget-frontend/src/api.js
const API_BASE = "http://localhost:5000";

export const verifyWebsiteToken = async (websiteToken) => {
  console.log("🧪 verifyWebsiteToken called with:", websiteToken);

  try {
    const res = await fetch(`${API_BASE}/auth/website-login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ websiteToken }),
    });

    const data = await res.json();
    console.log("🧪 Token auth response:", data);
    return data;
  } catch (err) {
    console.error("❌ Error verifying token:", err);
    return { mode: "guest" };
  }
};

export const sendChatMessage = async (sessionId, message, websiteToken) => {
  console.log("💬 Sending message:", message);
  console.log("📎 Token used:", websiteToken);

  try {
    const res = await fetch(`${API_BASE}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId,
        message,
        websiteToken,
      }),
    });

    const data = await res.json();
    console.log("🤖 Chat reply:", data.reply);
    return data.reply || "No reply received.";
  } catch (err) {
    console.error("❌ Chat error:", err);
    return "Sorry — something went wrong.";
  }
};
