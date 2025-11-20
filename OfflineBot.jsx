// OfflinebotPage.jsx
import React, { useState, useRef, useEffect } from "react";

/**
 * OfflinebotPage with WebLLM integration.
 * - Typing (three-dot) animation shows ONLY while the model is generating (isLoading).
 * - During download/initialization (isDownloading) the three-dot animation is NOT shown.
 * - UI otherwise unchanged.
 */

const MODEL_NAME = "Llama-3.1-8B-Instruct-q4f32_1-MLC";
const MODEL_SIZE_TEXT = "≈ 4.0 GB";
const LOCALSTORAGE_KEY = "webllm_downloaded_v1";

const OfflinebotPage = () => {
  // UI state (unchanged)
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  // isLoading -> used only for generation (shows typing dots)
  const [isLoading, setIsLoading] = useState(false);
  // isDownloading -> used for download/init (DO NOT show typing dots)
  const [isDownloading, setIsDownloading] = useState(false);

  // internal webllm state
  const engineRef = useRef(null);
  const modelLoadedRef = useRef(false);
  const userDeclinedRef = useRef(false);
  const abortRef = useRef(null);
  const disposedRef = useRef(false);

  // UI-only progress markers (not changing UI layout)
  const [internalInitStatus, setInternalInitStatus] = useState("");
  const [internalProgress, setInternalProgress] = useState(0);

  // show/hide the small in-UI download button
  const [showDownloadButton, setShowDownloadButton] = useState(false);

  const chatEndRef = useRef(null);

  // Scroll to bottom when messages update
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isLoading, isDownloading]);

  // On mount: check download status and prompt if needed
  useEffect(() => {
    disposedRef.current = false;

    if (window.__webllm_engine) {
      engineRef.current = window.__webllm_engine;
      modelLoadedRef.current = true;
      setShowDownloadButton(false);
      setInternalInitStatus("Model ready");
      setInternalProgress(100);
      return;
    }

    const downloaded = localStorage.getItem(LOCALSTORAGE_KEY);
    if (downloaded === "1") {
      // artifacts present; initialize on demand later
      setShowDownloadButton(false);
      setInternalInitStatus("Model artifacts present (init on demand)");
      modelLoadedRef.current = false;
      return;
    }

    const previouslyDeclined = localStorage.getItem(`${LOCALSTORAGE_KEY}_declined`);
    if (previouslyDeclined === "1") {
      userDeclinedRef.current = true;
      setShowDownloadButton(true);
      return;
    }

    // Show native confirm on first mount (keeps UI unchanged)
    try {
      const wantDownload = window.confirm(
        `Do you want to download offline mode (${MODEL_SIZE_TEXT})? Click OK to download now, Cancel to use simulated responses.`
      );
      if (wantDownload) {
        startDownloadAndInit();
      } else {
        userDeclinedRef.current = true;
        localStorage.setItem(`${LOCALSTORAGE_KEY}_declined`, "1");
        setShowDownloadButton(true);
        setMessages((prev) => [...prev, { role: "model", content: "Using simulated responses (offline model not downloaded)." }]);
      }
    } catch (e) {
      userDeclinedRef.current = true;
      setShowDownloadButton(true);
    }

    return () => {
      disposedRef.current = true;
      try {
        if (abortRef.current) abortRef.current.abort();
      } catch (e) {}
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Lazy import and engine creation
  const lazyCreateEngine = async (onProgress) => {
    const webllmPkg = await import("@mlc-ai/web-llm");
    const CreateMLCEngine = webllmPkg.CreateMLCEngine || webllmPkg.default?.CreateMLCEngine;
    if (!CreateMLCEngine) throw new Error("CreateMLCEngine not found in @mlc-ai/web-llm");
    const eng = await CreateMLCEngine(MODEL_NAME, {
      initProgressCallback: onProgress,
    });
    return eng;
  };

  // Start download/init (used on mount or by button)
  const startDownloadAndInit = async () => {
    if (window.__webllm_engine) {
      engineRef.current = window.__webllm_engine;
      modelLoadedRef.current = true;
      setShowDownloadButton(false);
      setInternalInitStatus("Model ready");
      setInternalProgress(100);
      return;
    }

    setInternalInitStatus("Requesting model...");
    setInternalProgress(0);
    setIsDownloading(true); // NOTE: download flag (no typing dots)
    // Keep isLoading false here so three-dot doesn't show

    const onProgress = (report) => {
      if (disposedRef.current) return;
      const t = report?.text || "Loading model...";
      setInternalInitStatus(t);
      if (typeof report?.progress === "number") {
        setInternalProgress(Math.round(report.progress * 100));
      }
      if (report?.progress === 1 || report?.progress >= 1) {
        setInternalProgress(100);
      }
    };

    try {
      const eng = await lazyCreateEngine(onProgress);
      if (disposedRef.current) {
        if (eng && typeof eng.dispose === "function") {
          try { eng.dispose(); } catch (e) {}
        }
        setIsDownloading(false);
        return;
      }

      engineRef.current = eng;
      window.__webllm_engine = eng;
      localStorage.setItem(LOCALSTORAGE_KEY, "1");
      localStorage.removeItem(`${LOCALSTORAGE_KEY}_declined`);
      modelLoadedRef.current = true;
      setShowDownloadButton(false);
      setInternalInitStatus("Model ready");
      setInternalProgress(100);
      setMessages((prev) => [...prev, { role: "model", content: "Offline model downloaded and ready." }]);
    } catch (err) {
      console.error("Failed to download/init model:", err);
      userDeclinedRef.current = true;
      localStorage.setItem(`${LOCALSTORAGE_KEY}_declined`, "1");
      setShowDownloadButton(true);
      setMessages((prev) => [...prev, { role: "model", content: "Failed to initialize offline model. Using simulated responses." }]);
    } finally {
      setIsDownloading(false);
    }
  };

  // Simulated response (unchanged)
  const simulateResponse = (userText) => {
    setIsLoading(true); // generation typing dots for simulated response
    setTimeout(() => {
      setMessages((prev) => [...prev, { role: "model", content: "This is a simulated AI response." }]);
      setIsLoading(false);
    }, 1000);
  };

  // Send handler: uses engine if ready, otherwise simulated or init-on-demand
  const handleSend = async (e) => {
    if (e && typeof e.preventDefault === "function") e.preventDefault();
    if (!input.trim() || isLoading || isDownloading) return;

    const userText = input.trim();
    setMessages((prev) => [...prev, { role: "user", content: userText }]);
    setInput("");

    if (engineRef.current && modelLoadedRef.current && engineRef.current.chat?.completions?.create) {
      await generateWithEngine(userText);
      return;
    }

    const downloadedBefore = localStorage.getItem(LOCALSTORAGE_KEY) === "1";
    if (downloadedBefore && !engineRef.current) {
      await startDownloadAndInit();
      if (engineRef.current && modelLoadedRef.current) {
        await generateWithEngine(userText);
        return;
      } else {
        simulateResponse(userText);
        return;
      }
    }

    if (userDeclinedRef.current) {
      simulateResponse(userText);
      return;
    }

    // fallback: show download button and simulated response
    setShowDownloadButton(true);
    simulateResponse(userText);
  };

  // Generate using engine with streaming; uses isLoading (typing dots)
  const generateWithEngine = async (userText) => {
    const eng = engineRef.current;
    if (!eng || !eng.chat || !eng.chat.completions || !eng.chat.completions.create) {
      setMessages((prev) => [...prev, { role: "model", content: "Chat API not available in this engine build." }]);
      return;
    }

    const chatHistory = [
      { role: "system", content: "You are a helpful assistant." },
      ...messages.map((m) => (m.role === "user" ? { role: "user", content: m.content } : { role: "assistant", content: m.content })),
      { role: "user", content: userText },
    ];

    try {
      if (abortRef.current) {
        abortRef.current.abort();
        abortRef.current = null;
      }
    } catch (e) {}

    const controller = new AbortController();
    abortRef.current = controller;
    setIsLoading(true); // show typing dots during generation

    // placeholder assistant message for streaming updates
    setMessages((prev) => [...prev, { role: "model", content: " " }]);
    let assistantAccum = "";

    try {
      const stream = await eng.chat.completions.create({
        messages: chatHistory,
        stream: true,
        temperature: 0.7,
        max_tokens: 512,
        signal: controller.signal,
      });

      for await (const chunk of stream) {
        const piece = chunk?.choices?.[0]?.delta?.content || "";
        if (piece) assistantAccum += piece;

        setMessages((prev) => {
          const lastIdx = prev.length - 1;
          if (lastIdx >= 0 && prev[lastIdx].role === "model") {
            const newPrev = prev.slice(0, lastIdx);
            return [...newPrev, { role: "model", content: assistantAccum }];
          } else {
            return [...prev, { role: "model", content: assistantAccum || " " }];
          }
        });
      }
    } catch (err) {
      if (err?.name === "AbortError") {
        setMessages((prev) => [...prev, { role: "model", content: "Generation cancelled." }]);
      } else {
        console.error("Generation error:", err);
        setMessages((prev) => [...prev, { role: "model", content: "Error: " + (err?.message || "Unknown error") }]);
      }
    } finally {
      setIsLoading(false);
      abortRef.current = null;
    }
  };

  // Stop generation
  const handleStop = () => {
    if (abortRef.current) {
      try {
        abortRef.current.abort();
      } catch (e) {}
      abortRef.current = null;
      setIsLoading(false);
    }
  };

  // Download button click
  const onClickDownloadButton = async () => {
    if (window.__webllm_engine) {
      engineRef.current = window.__webllm_engine;
      modelLoadedRef.current = true;
      setShowDownloadButton(false);
      setInternalInitStatus("Model ready");
      setInternalProgress(100);
      return;
    }
    await startDownloadAndInit();
  };

  return (
    <div className="w-full bg-[#E8FDFF] h-[90vh] mt-20">
      <div className="h-[98%] w-screen ml-0 lg:w-[80vw] lg:ml-5 flex flex-col bg-[#CAECFF] rounded-2xl relative ">
        {/* Small in-UI Download Button (only visible when not downloaded yet) */}
        {showDownloadButton && (
          <div className="absolute right-6 top-6 z-20">
            <button
              onClick={onClickDownloadButton}
              className="px-3 py-1 rounded bg-[#FF993A] text-white text-xs"
              title={`Download offline model (${MODEL_SIZE_TEXT})`}
            >
              Download Offline Model
            </button>
          </div>
        )}

        {/* Welcome Text */}
        {messages.length === 0 && (
          <div className="absolute w-full px-14 py-28 text-center lg:flex lg:flex-col lg:items-center">
            <h2 className="text-3xl lg:text-4xl font-bold">
              Welcome to <span className="bg-[#FF993A] text-white px-4 py-1 rounded-xl">Your AI</span>
            </h2>
            <p className="text-xs lg:text-sm ml-2 mt-2">
              The power of AI at your service - Tame the knowledge
            </p>
          </div>
        )}

        {/* Chat Window */}
        <div className="flex-1 w-full overflow-y-auto px-8 py-4 flex flex-col gap-2 mt-24">
          {messages.map((msg, index) => (
            <div
              key={index}
              className={`max-w-[70%] md:max-w-[85%] p-3 rounded-xl wrap-break-word ${
                msg.role === "user" ? "self-end bg-[#FF993A] text-white" : "self-start bg-gray-200 text-black"
              }`}
            >
              {msg.content}
            </div>
          ))}

          {/* Typing (three-dot) indicator: show ONLY during generation (isLoading). */}
          {isLoading && (
            <div className="self-start p-4 bg-gray-200 rounded-xl">
              <div className="flex gap-1">
                <span className="w-2 h-2 bg-gray-600 rounded-full animate-bounce"></span>
                <span className="w-2 h-2 bg-gray-600 rounded-full animate-bounce [animation-delay:0.2s]"></span>
                <span className="w-2 h-2 bg-gray-600 rounded-full animate-bounce [animation-delay:0.4s]"></span>
              </div>
            </div>
          )}
          <div ref={chatEndRef}></div>
        </div>

        {/* Input Form */}
        <div className="absolute bottom-[1%] w-full px-4">
          <form onSubmit={handleSend} className="w-full relative">
            <input
              type="text"
              placeholder='Example: "Explain Quantum Computing"'
              value={input}
              onChange={(e) => setInput(e.target.value)}
              // disable input while generating (isLoading) OR while downloading (isDownloading)
              disabled={isLoading || isDownloading}
              className="h-12 rounded-lg px-4 w-full bg-[#D0E1E7] border border-black/30 disabled:bg-gray-300 disabled:text-gray-500"
            />
            <div
              onClick={isLoading ? handleStop : handleSend}
              className={`absolute h-8 w-8 ${isLoading ? "bg-gray-400 cursor-not-allowed" : "bg-[#FF993A] cursor-pointer"} flex items-center justify-center right-4 top-2 rounded`}
            >
              <i className="ri-send-plane-2-fill text-white"></i>
            </div>
          </form>
        </div>

        {/* Optional small debug/progress area (hidden unless init in progress) */}
        {internalInitStatus && internalProgress < 100 && (
          <div className="absolute left-6 bottom-20 text-xs bg-white/80 p-2 rounded shadow">
            <div className="font-medium">Model Init</div>
            <div className="text-[11px]">{internalInitStatus} {internalProgress > 0 ? `(${internalProgress}%)` : ""}</div>
          </div>
        )}
      </div>
    </div>
  );
};

export default OfflinebotPage;
