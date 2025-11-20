// src/components/ScanDocs.jsx
import React, { useRef, useState, useEffect } from "react";

const kidImgPath = "/imgs/kid3.png";

const ScanDocs = () => {
  // desktop detection (fallback to width)
  const [isDesktop, setIsDesktop] = useState(
    typeof window !== "undefined" ? window.innerWidth >= 1024 : false
  );

  useEffect(() => {
    const onResize = () => setIsDesktop(window.innerWidth >= 1024);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // refs & state
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const fileInputRef = useRef(null);
  const cameraInputRef = useRef(null);

  const [isDesktopCamera, setIsDesktopCamera] = useState(false);
  const [selectedFile, setSelectedFile] = useState(null);
  const [capturedImage, setCapturedImage] = useState(null);
  const [output, setOutput] = useState("");
  const [loading, setLoading] = useState(false);
  const [targetLang, setTargetLang] = useState("Hindi");

  // ---------- Frontend sanitizer ----------
  function sanitizeOutput(text) {
    if (!text && text !== 0) return "";
    let t = String(text);

    // decode common HTML entities
    const entities = {
      "&amp;": "&",
      "&lt;": "<",
      "&gt;": ">",
      "&#39;": "'",
      "&#039;": "'",
      "&quot;": '"',
      "&nbsp;": " ",
    };
    t = t.replace(/(&amp;|&lt;|&gt;|&#39;|&#039;|&quot;|&nbsp;)/g, (m) => entities[m] || m);

    // Remove heading markers (# at line starts)
    t = t.replace(/(^|\n)\s*#{1,6}\s+/g, "$1");

    // Remove backticks preserving inner text
    t = t.replace(/`{1,3}([^`]*)`{1,3}/g, "$1");

    // Remove bold/italic markers but keep inner text
    t = t.replace(/(\*\*|__)(.*?)\1/g, "$2");
    t = t.replace(/(\*|_)(.*?)\1/g, "$2");

    // Remove stray *, _, backticks that remain
    t = t.replace(/[*_`]/g, "");

    // Collapse excessive newlines and spaces
    t = t.replace(/\r/g, "").replace(/\t/g, " ");
    t = t.replace(/\n{3,}/g, "\n\n");
    t = t.replace(/[ \t]{2,}/g, " ");

    return t.trim();
  }

  // helpers: parse, escape (unchanged core logic with small tweaks)
  function parseMinimalOutput(text) {
    if (!text || typeof text !== "string") return null;
    const lines = text.replace(/\r/g, "").split("\n").map((l) => l.trim());
    while (lines.length && lines[0] === "") lines.shift();
    while (lines.length && lines[lines.length - 1] === "") lines.pop();
    if (lines.length === 0) return null;
    const result = { title: null, bullets: [], deadlines: [], actions: [], summary: null, raw: text };
    result.title = lines[0];
    let mode = "bullets";
    for (let i = 1; i < lines.length; i++) {
      const ln = lines[i];
      if (!ln) continue;
      const low = ln.toLowerCase();
      if (low.startsWith("deadlines")) { mode = "deadlines"; continue; }
      if (low.startsWith("actions")) { mode = "actions"; continue; }
      if (low.startsWith("summary")) {
        const parts = ln.split(":");
        if (parts.length > 1) result.summary = parts.slice(1).join(":").trim();
        mode = "summary";
        continue;
      }
      if (ln.startsWith("- ")) {
        const content = ln.slice(2).trim();
        if (!content) continue;
        if (mode === "deadlines") {
          const match = content.match(/^(.+?)[:—-]\s*([0-9]{4}-[0-9]{2}-[0-9]{2})$/);
          if (match) result.deadlines.push({ text: match[1].trim(), date: match[2].trim() });
          else {
            const match2 = content.match(/^(.+?)[:—-]\s*([0-9]{1,2}\s+[A-Za-z]{3,}\s+[0-9]{4})$/);
            if (match2) {
              const parsed = tryParseDate(match2[2].trim());
              result.deadlines.push({ text: match2[1].trim(), date: parsed });
            } else result.deadlines.push({ text: content, date: null });
          }
        } else if (mode === "actions") result.actions.push(content);
        else if (mode === "summary") { if (!result.summary) result.summary = content; }
        else result.bullets.push(content);
        continue;
      }
      const numMatch = ln.match(/^\s*\d+\.\s+(.*)$/);
      if (numMatch) { mode = "actions"; result.actions.push(numMatch[1].trim()); continue; }
      if (mode === "actions" && ln) { result.actions.push(ln); continue; }
      if (mode === "bullets" && ln.length < 180) { result.bullets.push(ln); continue; }
      if (i === lines.length - 1 && !result.summary) result.summary = ln;
    }
    if (!result.summary) {
      const summaryLine = lines.find((l) => /^summary[:\-]/i.test(l));
      if (summaryLine) {
        const parts = summaryLine.split(/[:\-]/);
        result.summary = parts.slice(1).join(":").trim();
      } else {
        if (result.bullets.length > 0) result.summary = result.bullets[result.bullets.length - 1];
        else result.summary = "";
      }
    }
    if (result.bullets.length > 5) result.bullets = result.bullets.slice(0, 5);
    return result;
  }

  // try parse date like "25 Nov 2025" to "2025-11-25"
  function tryParseDate(dateStr) {
    try {
      const d = new Date(dateStr);
      if (!isNaN(d.getTime())) {
        const yyyy = d.getFullYear();
        const mm = String(d.getMonth() + 1).padStart(2, "0");
        const dd = String(d.getDate()).padStart(2, "0");
        return `${yyyy}-${mm}-${dd}`;
      }
    } catch {}
    return null;
  }

  // Helper to escape HTML for safe rendering
  const escapeHtml = (unsafe) => {
    if (!unsafe && unsafe !== 0) return "";
    return String(unsafe)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  };

  // Helper to check if structured has any meaningful sections
  const hasAnyStructuredSection = (s) => {
    if (!s) return false;
    const hasBullets = Array.isArray(s.bullets) && s.bullets.some((b) => b && b.trim() !== "");
    const hasDeadlines = Array.isArray(s.deadlines) && s.deadlines.length > 0;
    const hasActions = Array.isArray(s.actions) && s.actions.some((a) => a && a.trim() !== "");
    const hasSummary = s.summary && s.summary.trim() !== "";
    return hasBullets || hasDeadlines || hasActions || hasSummary;
  };

  // upload logic
  const uploadFileOrImage = async (data, isBase64 = false) => {
    try {
      setLoading(true);
      setOutput("");
      const formData = new FormData();
      if (isBase64) {
        // convert data url to blob
        const response = await fetch(data);
        const blob = await response.blob();
        formData.append("image", blob, "capture.png");
      } else {
        formData.append("image", data);
      }
      formData.append("targetLang", targetLang);
      const resp = await fetch("http://localhost:3000/api/post", {
        method: "POST",
        body: formData,
        credentials: "include",
      });
      if (!resp.ok) throw new Error(`HTTP error: ${resp.status}`);
      const json = await resp.json();
      const caption = json?.post?.caption || json?.caption || json?.summary || "";
      setOutput(caption || "No summary found.");
    } catch (err) {
      console.error("Upload error:", err);
      setOutput("❌ Error while summarizing document. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  // file select + validation
  const handleFileSelect = (file) => {
    if (!file) return;
    const validTypes = [
      "image/jpeg",
      "image/jpg",
      "image/png",
      "image/gif",
      "application/pdf",
      "application/msword",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ];
    if (!validTypes.includes(file.type)) {
      alert("Please select a valid image (JPG/PNG/GIF), PDF or Word document.");
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      alert("File size should be less than 10MB");
      return;
    }
    setSelectedFile(file);
    setCapturedImage(null);
    uploadFileOrImage(file, false);
  };

  const triggerFileInput = () => fileInputRef.current?.click();

  // mobile camera
  const handleMobileCameraChange = (e) => {
    const file = e.target.files && e.target.files[0];
    if (file) {
      handleFileSelect(file);
      e.target.value = "";
    }
  };

  // desktop camera
  const openDesktopCamera = async () => {
    try {
      setIsDesktopCamera(true);
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
    } catch (err) {
      console.error("Webcam error:", err);
      alert("Camera access blocked or unavailable");
      setIsDesktopCamera(false);
    }
  };

  const capturePhoto = () => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (video && canvas) {
      const ctx = canvas.getContext("2d");
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const imageData = canvas.toDataURL("image/png");
      setCapturedImage(imageData);
      stopCamera();
      setSelectedFile(null);
      uploadFileOrImage(imageData, true);
    }
  };

  const stopCamera = () => {
    if (videoRef.current && videoRef.current.srcObject) {
      const tracks = videoRef.current.srcObject.getTracks();
      tracks.forEach((t) => t.stop());
      videoRef.current.srcObject = null;
    }
    setIsDesktopCamera(false);
  };

  // sanitized + parsed structured output
  const cleanedOutput = sanitizeOutput(output);
  const structured = parseMinimalOutput(cleanedOutput);

  return (
    <div className="w-full min-h-screen mt-10 bg-[#E8FDFF] overflow-y-auto pb-10">
      <div className="max-w-7xl mx-auto px-6 sm:px-8 lg:px-12 py-6 mt-12">
        <div className="flex flex-col lg:flex-row gap-6 lg:gap-10 items-stretch">
          {/* Left Section */}
          <div className="flex-1">
            <div className="bg-gradient-to-r from-[#3B9FFF] to-[#5FB4FF] rounded-3xl shadow-2xl overflow-hidden p-6 sm:p-8 md:p-10 flex items-center gap-6 min-h-[28vh] lg:min-h-[38vh]">
              <img
                src={kidImgPath}
                alt="Scan kid"
                className="max-h-[22vh] lg:max-h-[30vh] object-contain flex-shrink-0"
              />
              <div className="flex-1">
                <h1
                  className="text-lg sm:text-2xl md:text-3xl lg:text-4xl text-white font-normal leading-tight"
                  style={{ fontFamily: "Righteous, sans-serif" }}
                >
                  Upload or Scan
                  <br />
                  your Docs for clear
                  <br />
                  understanding
                </h1>
              </div>
            </div>
          </div>

          {/* Right Section - PERFECT Card (responsive widths) */}
          <div className="w-full lg:w-1/3">
            <div className="bg-white rounded-3xl shadow-xl p-4 sm:p-6 md:p-8 flex flex-col justify-between min-h-[36vh] lg:min-h-[42vh]">
              {/* Upload area */}
              <div className="space-y-4">
                <div
                  className="border-2 border-dashed border-[#FF9D5C] rounded-2xl p-4 sm:p-6 flex flex-col items-center justify-center hover:shadow-lg transition-shadow cursor-pointer lg: h-26 mb-1"
                  onClick={triggerFileInput}
                  role="button"
                  aria-label="Select file to upload"
                  tabIndex={0}
                  onKeyDown={(e) => (e.key === "Enter" ? triggerFileInput() : null)}
                >
                  <div className="w-12 h-12 sm:w-14 sm:h-14 bg-gray-50 rounded-lg flex items-center justify-center mb-3">
                    <i className="ri-image-line text-2xl text-[#FF9D5C]" />
                  </div>
                  <p className="text-gray-600 text-sm font-medium">Select file</p>
                  <p className="text-xs text-gray-400 mt-2">Images, PDF or Word (max 10MB)</p>
                </div>

                {/* file input hidden */}
                <input
                  ref={fileInputRef}
                  type="file"
                  id="file-upload"
                  className="hidden"
                  accept="image/*,.pdf,.doc,.docx"
                  onChange={(e) => {
                    const file = e.target.files && e.target.files[0];
                    handleFileSelect(file);
                    e.target.value = "";
                  }}
                />

                {/* language selector (small & neat) */}
                <div className="flex items-center gap-3 h-10  ">
                  <label className="text-xs text-gray-500">Output language</label>
                  <select
                    value={targetLang}
                    onChange={(e) => setTargetLang(e.target.value)}
                    className="ml-auto text-sm rounded-md border px-2 py-1 bg-white"
                    title="Select output language"
                  >
                    <option>English</option>
                    <option>Hindi</option>
                    <option>Tamil</option>
                    <option>Marathi</option>
                    <option>Gujarati</option>
                    <option>Bengali</option>
                    <option>Urdu</option>
                    <option>Kannada</option>
                    <option>Telugu</option>
                  </select>
                </div>
              </div>

              {/* Divider */}
              <div className="w-full border-t my-3" />

              {/* Camera Buttons Row - unified height & spacing */}
              <div className="flex flex-col sm:flex-row gap-2">
                {/* Mobile camera (only shown on small screens) */}
                {!isDesktop && (
                  <label htmlFor="mobile-camera" className="flex-1">
                    <div className="w-full flex items-center justify-center gap-2 py-1 rounded-lg bg-[#FFE4C4] hover:bg-[#FFD9B3] text-[#FF9D5C] font-medium transition-colors shadow-sm  cursor-pointer">
                      <i className="ri-camera-line text-lg" />
                      <span className="text-sm">Open Camera & Take Photo</span>
                    </div>
                    <input
                      ref={cameraInputRef}
                      id="mobile-camera"
                      type="file"
                      className="hidden"
                      accept="image/*"
                      capture="environment"
                      onChange={handleMobileCameraChange}
                    />
                  </label>
                )}

                {/* Desktop camera (only shown on desktop) */}
                {isDesktop && !isDesktopCamera && (
                  <button
                    onClick={openDesktopCamera}
                    className="flex-1 py-3 rounded-lg bg-[#FFE4C4] hover:bg-[#FFD9B3] text-[#FF9D5C] font-medium transition-colors shadow-sm flex items-center justify-center gap-2"
                    aria-label="Open desktop camera"
                  >
                    <i className="ri-camera-line text-lg" />
                    <span className="text-sm">Open Camera & Take Photo</span>
                  </button>
                )}

                {/* When desktop camera is active, show capture/cancel as two equal buttons */}
                {isDesktopCamera && (
                  <>
                    <button
                      onClick={capturePhoto}
                      className="flex-1 py-3 rounded-lg bg-[#3B9FFF] hover:bg-[#2e82e6] text-white font-medium transition-colors"
                    >
                      Capture
                    </button>
                    <button
                      onClick={stopCamera}
                      className="flex-1 py-3 rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-800 font-medium transition-colors"
                    >
                      Cancel
                    </button>
                  </>
                )}
              </div>

              {/* Small area to show selected filename or captured preview */}
              <div className="mt-3">
                {selectedFile && !capturedImage && (
                  <p className="text-sm text-gray-600 truncate">Selected: {selectedFile.name}</p>
                )}
                {capturedImage && (
                  <div className="mt-2">
                    <img src={capturedImage} alt="captured preview" className="w-full rounded-md shadow-sm" />
                    <p className="text-xs text-gray-500 mt-2">Preview of the captured image</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Output Section */}
        <div className="mt-8 lg:mt-12">
          <h2 className="text-2xl sm:text-3xl lg:text-4xl font-bold mb-6">Output</h2>
          <div className="bg-[#CAECFF] rounded-3xl p-5 sm:p-8 md:p-10 min-h-[20vh] lg:min-h-[28vh] shadow-md">
            {loading ? (
              <p className="text-gray-700 text-base">⏳ Summarizing...</p>
            ) : (structured && hasAnyStructuredSection(structured)) ? (
              <div className="space-y-6">
                <h3 className="text-xl sm:text-2xl font-semibold">{escapeHtml(structured.title || "Document")}</h3>

                {structured.bullets && structured.bullets.length > 0 && (
                  <div>
                    <h4 className="font-medium mb-2">Key Points</h4>
                    <ul className="list-disc pl-6">
                      {structured.bullets.map((b, idx) => (
                        <li key={idx} className="text-gray-700">{escapeHtml(b)}</li>
                      ))}
                    </ul>
                  </div>
                )}

                <div>
                  <h4 className="font-medium mb-2">Deadlines</h4>
                  {structured.deadlines && structured.deadlines.length > 0 ? (
                    <div className="overflow-x-auto">
                      <table className="min-w-full bg-white rounded-md">
                        <thead>
                          <tr>
                            <th className="text-left px-3 py-2 text-sm">Task</th>
                            <th className="text-left px-3 py-2 text-sm">Date</th>
                          </tr>
                        </thead>
                        <tbody>
                          {structured.deadlines.map((d, i) => (
                            <tr key={i} className="border-t">
                              <td className="px-3 py-2 text-sm">{escapeHtml(d.text)}</td>
                              <td className="px-3 py-2 text-sm">{d.date ? escapeHtml(d.date) : "TBD"}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <p className="text-gray-700">None</p>
                  )}
                </div>

                {structured.actions && structured.actions.length > 0 && (
                  <div>
                    <h4 className="font-medium mb-2">Actions</h4>
                    <ol className="list-decimal pl-6">
                      {structured.actions.map((a, idx) => (
                        <li key={idx} className="text-gray-700">{escapeHtml(a)}</li>
                      ))}
                    </ol>
                  </div>
                )}

                <div>
                  <strong>Summary:</strong> <span className="text-gray-700">{escapeHtml(structured.summary)}</span>
                </div>
              </div>
            ) : cleanedOutput && cleanedOutput.trim() !== "" ? (
              // fallback: render sanitized raw text but formatted
              <div className="raw-output space-y-2">
                {cleanedOutput.split("\n").map((line, i) => (
                  <p key={i} className="text-gray-700">{line}</p>
                ))}
              </div>
            ) : (
              <p className="text-gray-700 text-base">{output || "After upload your docs you will get all information here.."}</p>
            )}
          </div>
        </div>
      </div>

      {/* Hidden canvas for capture */}
      <canvas ref={canvasRef} style={{ display: "none" }} />
      {/* Hidden video element for desktop camera (needed when camera active) */}
      {isDesktopCamera && <video ref={videoRef} autoPlay playsInline style={{ display: "none" }} />}
    </div>
  );
};

export default ScanDocs;
