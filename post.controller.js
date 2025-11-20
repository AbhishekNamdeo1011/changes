// controllers/post.controller.js
import postModel from "../models/post.model.js";
import { generateImageCaption, generateDocumentCaption } from "../services/ai.service.js";
import uploadfile from "../services/storage.service.js";
import { v4 as uuidv4 } from "uuid";
import fs from "fs/promises";
import path from "path";
import rimraf from "rimraf";

/**
 * Supported languages list that frontend can use.
 * Add/remove languages as you want. The language strings are passed
 * directly to Gemini in "Respond in <targetLang>."
 */
const SUPPORTED_LANGUAGES = [
  "English",
  "Hindi",
  "Marathi",
  "Gujarati",
  "Bengali",
  "Tamil",
  "Telugu",
  "Kannada",
  "Urdu",
  // add more if needed
];

/**
 * GET /api/post/languages
 * Returns supported languages.
 */
export const getSupportedLanguages = async (req, res) => {
  return res.json({ languages: SUPPORTED_LANGUAGES });
};

/**
 * createPostController
 * - Accepts file upload in req.file (multer memory storage) and targetLang in req.body
 * - If PDF is small enough, send inline base64 to Gemini for OCR+summary
 * - If PDF is large, upload to storage and pass the public URL to Gemini (if your model supports URL),
 *   or upload & then process summarization via another flow (we attempt URL first).
 *
 * Note:
 * - uploadfile(file, id) must return { url } for the uploaded file (S3/GCS).
 * - req.user must be populated by auth middleware.
 */
export const createPostController = async (req, res) => {
  const file = req.file;
  const targetLang = req.body?.targetLang || "English";

  if (!file) {
    return res.status(400).json({ message: "No file uploaded. Field name should be `image`." });
  }

  // validate targetLang
  if (!SUPPORTED_LANGUAGES.includes(targetLang)) {
    // not fatal — we can still proceed, but inform the client
    console.warn(`Unsupported targetLang "${targetLang}", defaulting to English.`);
  }

  // helper: buffer -> base64
  const bufferToBase64 = (buffer) => Buffer.from(buffer).toString("base64");

  // create a small tmp dir for safety (we won't write heavy files here)
  const tmpDir = path.join("tmp", `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  await fs.mkdir(tmpDir, { recursive: true });

  try {
    const mimeType = file.mimetype;
    let caption = "";

    // If PDF: try to send inline base64 to Gemini (cloud OCR). If PDF > threshold, upload to storage first.
    if (mimeType === "application/pdf") {
      // size in bytes
      const sizeBytes = file.size || (file.buffer && file.buffer.length) || 0;

      // threshold: 3.5 MB (tweak as needed). If larger, upload to storage to avoid request-size/rejection.
      const INLINE_THRESHOLD = 3.5 * 1024 * 1024;

      if (sizeBytes <= INLINE_THRESHOLD) {
        const pdfBase64 = bufferToBase64(file.buffer);
        // send inline pdf to generateDocumentCaption
        caption = await generateDocumentCaption({ pdfBase64 }, targetLang);
      } else {
        // Large PDF: upload to storage and pass public URL.
        // uploadfile must return { url }.
        const uploadResult = await uploadfile(file, `${uuidv4()}`);
        const publicUrl = uploadResult?.url;
        if (!publicUrl) {
          throw new Error("Failed to upload large PDF to storage for processing.");
        }

        // Try to send the public URL to Gemini as content text + instruction.
        // Some providers accept URLs in inlineData or in content text. We fallback to asking Gemini to read the URL.
        // We'll call generateContent to request reading the URL; generateDocumentCaption expects inlineData, so we prepare a small content object:
        try {
          // Try calling generateDocumentCaption with pagesArray undefined by using generateContent directly.
          // We build prompt instructing the assistant to fetch and read the file at the URL.
          const promptContents = [
            {
              text: `A user uploaded a PDF at the following URL: ${publicUrl}\n\nPlease fetch the document at this URL, read it fully and then produce:
1) 6 concise bullet points summarizing key facts and required actions for students,
2) followed by a 2-3 sentence short summary.
Respond in ${targetLang}. If you cannot fetch the URL, say so clearly.`
            }
          ];

          // generateContent is in ai.service.js
          const resp = await (await import("../services/ai.service.js")).generateContent(promptContents);
          caption = resp;
        } catch (err) {
          // If direct fetch by Gemini fails or provider disallows remote fetch, fallback:
          // We'll still return the uploaded file URL and tell the client we couldn't auto-summarize, so they can retry.
          console.error("Remote fetch by model failed:", err);
          // Save post with "Please open file at url" message
          caption = `Uploaded. The PDF is large and was uploaded to storage. Please open ${publicUrl} to view. Automatic summary failed: ${err.message || String(err)}`;
        }
      }
    } else if (mimeType.startsWith("image/")) {
      // Image -> base64 -> generateImageCaption
      const base64ImageFile = bufferToBase64(file.buffer);
      caption = await generateImageCaption(base64ImageFile, mimeType, targetLang);
    } else {
      return res.status(400).json({ message: "Unsupported file type. Upload an image or PDF." });
    }

    // Upload original file (preserve it as a post asset)
    const result = await uploadfile(file, `${uuidv4()}`);
    if (!result || !result.url) {
      throw new Error("File upload failed (uploadfile returned invalid result).");
    }

    // Save post to DB (your schema)
    const post = await postModel.create({
      userId: req.user._id,
      image: result.url,
      caption: caption,
    });

    return res.status(201).json({
      message: "Post created successfully",
      post: {
        _id: post._id,
        image: post.image,
        caption: post.caption,
        userId: post.userId,
        createdAt: post.createdAt,
      },
    });
  } catch (error) {
    console.error("createPostController error:", error);
    const details = error?.message || String(error);
    return res.status(500).json({ message: "Server error", details });
  } finally {
    // cleanup
    try { rimraf.sync(tmpDir); } catch (e) {}
  }
};
